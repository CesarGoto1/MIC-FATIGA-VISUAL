import math

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import asc, desc, func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.dependencies import get_current_user_id
from backend.diagnosis import generar_diagnostico
from backend.fatigue import clasificar_fatiga
from backend.models.orm import Diagnostico, Medicion, Sesion
from backend.models.schemas import (
    DiagnosticoOut,
    MetricsInRequest,
    MetricsSavedResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    SessionFinishRequest,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])

MIN_MEDICIONES_PARA_ANALISIS = 2
METRICAS_ANALISIS = ("perclos", "parpadeos_min", "tiempo_cierre", "velocidad_ocular", "cierres_prolongados")


def _obtener_sesion_del_usuario(db: Session, sesion_id: int, usuario_id: int) -> Sesion:
    """Busca una sesión propia del usuario o lanza 404 si no existe."""
    sesion = (
        db.query(Sesion)
        .filter(Sesion.id == sesion_id, Sesion.usuario_id == usuario_id)
        .first()
    )
    if sesion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La sesión no existe o no pertenece a este usuario.",
        )
    return sesion


def _exigir_sesion_abierta(sesion: Sesion) -> None:
    if sesion.finalizada_en is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La sesión ya fue finalizada.",
        )


@router.post("", response_model=SessionCreateResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    data: SessionCreateRequest,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Inserta un registro nuevo en sesiones para el usuario autenticado."""
    sesion = Sesion(
        usuario_id=usuario_id,
        actividad=data.actividad,
        momento=data.momento,
        kss_inicial=data.kss_inicial,
    )
    db.add(sesion)
    db.flush()

    return SessionCreateResponse(
        sesion_id=sesion.id,
        actividad=sesion.actividad,
        momento=sesion.momento,
        kss_inicial=sesion.kss_inicial,
    )


@router.post("/{sesion_id}/metrics", response_model=MetricsSavedResponse)
def save_metrics(
    sesion_id: int,
    data: MetricsInRequest,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Inserta un registro nuevo en mediciones asociado a una sesión abierta."""
    sesion = _obtener_sesion_del_usuario(db, sesion_id, usuario_id)
    _exigir_sesion_abierta(sesion)

    nivel_fatiga = clasificar_fatiga(data.perclos, data.parpadeos_min)

    medicion = Medicion(
        sesion_id=sesion_id,
        actividad=sesion.actividad,
        ear=data.ear,
        perclos=data.perclos,
        parpadeos_min=data.parpadeos_min,
        tiempo_cierre=data.tiempo_cierre,
        velocidad_ocular=data.velocidad_ocular,
        cierres_prolongados=data.cierres_prolongados,
        nivel_fatiga=nivel_fatiga,
    )
    db.add(medicion)
    db.flush()

    return MetricsSavedResponse(medicion_id=medicion.id, nivel_fatiga=nivel_fatiga)


@router.get("/{sesion_id}/diagnosis", response_model=DiagnosticoOut)
def get_diagnosis(
    sesion_id: int,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Consulta el análisis interpretativo más reciente generado para una sesión."""
    _obtener_sesion_del_usuario(db, sesion_id, usuario_id)

    diagnostico = (
        db.query(Diagnostico)
        .filter(Diagnostico.sesion_id == sesion_id)
        .order_by(desc(Diagnostico.generado_en))
        .first()
    )

    if diagnostico is None:
        return DiagnosticoOut(disponible=False, texto=None, detalle=None, generado_en=None)

    return DiagnosticoOut(
        disponible=diagnostico.disponible,
        texto=diagnostico.texto,
        detalle=diagnostico.detalle,
        generado_en=diagnostico.generado_en.isoformat(),
    )


def _promedio_tramo(mediciones: list[Medicion]) -> dict:
    """Promedia cada métrica en un tramo de mediciones, ignorando valores nulos."""
    resultado = {}
    for clave in METRICAS_ANALISIS:
        valores = [float(getattr(m, clave)) for m in mediciones if getattr(m, clave) is not None]
        resultado[clave] = round(sum(valores) / len(valores), 3) if valores else None
    return resultado


def construir_payload_analisis(sesion: Sesion, mediciones: list[Medicion]) -> dict:
    """Arma el payload para n8n comparando el primer y el último cuarto de la sesión.

    Solo contiene métricas numéricas agregadas y el contexto de la sesión: ningún
    identificador del usuario sale hacia el servicio de IA (privacidad por diseño).
    """
    tramo = max(1, math.ceil(len(mediciones) / 4))
    duracion_min = None
    if sesion.finalizada_en is not None and sesion.iniciada_en is not None:
        duracion_min = round((sesion.finalizada_en - sesion.iniciada_en).total_seconds() / 60, 1)

    return {
        "sesion": {
            "actividad": sesion.actividad,
            "momento": sesion.momento,
            "duracion_min": duracion_min,
            "num_mediciones": len(mediciones),
        },
        "kss": {"inicial": sesion.kss_inicial, "final": sesion.kss_final},
        "tramo_inicial": _promedio_tramo(mediciones[:tramo]),
        "tramo_final": _promedio_tramo(mediciones[-tramo:]),
    }


@router.put("/{sesion_id}/finish", status_code=status.HTTP_204_NO_CONTENT)
def finish_session(
    sesion_id: int,
    data: SessionFinishRequest,
    background_tasks: BackgroundTasks,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Cierra la sesión, registra la KSS final y agenda el análisis interpretativo."""
    sesion = _obtener_sesion_del_usuario(db, sesion_id, usuario_id)
    _exigir_sesion_abierta(sesion)

    sesion.kss_final = data.kss_final
    sesion.finalizada_en = func.now()
    db.flush()
    db.refresh(sesion)

    _programar_analisis(db, sesion, background_tasks)


def _programar_analisis(db: Session, sesion: Sesion, background_tasks: BackgroundTasks) -> bool:
    """Agenda el análisis en segundo plano si la sesión tiene datos suficientes."""
    mediciones = (
        db.query(Medicion)
        .filter(Medicion.sesion_id == sesion.id)
        .order_by(asc(Medicion.registrado_en))
        .all()
    )
    if len(mediciones) < MIN_MEDICIONES_PARA_ANALISIS:
        return False

    background_tasks.add_task(
        generar_diagnostico, sesion.id, construir_payload_analisis(sesion, mediciones)
    )
    return True


@router.post("/{sesion_id}/diagnosis/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_diagnosis(
    sesion_id: int,
    background_tasks: BackgroundTasks,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Vuelve a solicitar el análisis de una sesión finalizada cuyo intento anterior falló."""
    sesion = _obtener_sesion_del_usuario(db, sesion_id, usuario_id)
    if sesion.finalizada_en is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La sesión aún no ha finalizado.",
        )

    ya_disponible = (
        db.query(Diagnostico)
        .filter(Diagnostico.sesion_id == sesion_id, Diagnostico.disponible.is_(True))
        .first()
    )
    if ya_disponible is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La sesión ya tiene un análisis disponible.",
        )

    if not _programar_analisis(db, sesion, background_tasks):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La sesión no tiene mediciones suficientes para generar un análisis.",
        )
    return {"detail": "Análisis solicitado."}
