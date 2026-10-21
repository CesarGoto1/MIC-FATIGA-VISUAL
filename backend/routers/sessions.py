import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import asc, desc, func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.dependencies import get_current_user_id
from backend.diagnosis import generar_diagnostico
from backend.fatigue import clasificar_fatiga, clasificar_tramo, detectar_somnolencia
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
INACTIVIDAD_MAXIMA = timedelta(minutes=15)
METRICAS_ANALISIS = (
    "parpadeos_min",
    "parpadeos_incompletos_pct",
    "tiempo_cierre",
    "velocidad_ocular",
    "perclos",
    "cierres_prolongados",
)


def _obtener_sesion_del_usuario(db: Session, sesion_id: int, usuario_id: int) -> Sesion:
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


def cerrar_sesiones_abandonadas(
    db: Session, usuario_id: int, background_tasks: BackgroundTasks
) -> None:
    limite = datetime.now(timezone.utc) - INACTIVIDAD_MAXIMA
    abiertas = (
        db.query(Sesion)
        .filter(Sesion.usuario_id == usuario_id, Sesion.finalizada_en.is_(None))
        .all()
    )
    for sesion in abiertas:
        ultima_medicion = (
            db.query(func.max(Medicion.registrado_en))
            .filter(Medicion.sesion_id == sesion.id)
            .scalar()
        )
        if (ultima_medicion or sesion.iniciada_en) >= limite:
            continue
        if ultima_medicion is None:
            db.delete(sesion)
            continue
        sesion.finalizada_en = ultima_medicion
        db.flush()
        _programar_analisis(db, sesion, background_tasks)
    db.flush()


@router.post("", response_model=SessionCreateResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    data: SessionCreateRequest,
    background_tasks: BackgroundTasks,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    cerrar_sesiones_abandonadas(db, usuario_id, background_tasks)
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
    sesion = _obtener_sesion_del_usuario(db, sesion_id, usuario_id)
    _exigir_sesion_abierta(sesion)

    nivel_fatiga = clasificar_fatiga(data.parpadeos_min, data.parpadeos_incompletos_pct)
    somnolencia = detectar_somnolencia(data.perclos, data.cierres_prolongados)

    medicion = Medicion(
        sesion_id=sesion_id,
        actividad=sesion.actividad,
        ear=data.ear,
        perclos=data.perclos,
        parpadeos_min=data.parpadeos_min,
        tiempo_cierre=data.tiempo_cierre,
        velocidad_ocular=data.velocidad_ocular,
        cierres_prolongados=data.cierres_prolongados,
        parpadeos_incompletos_pct=data.parpadeos_incompletos_pct,
        nivel_fatiga=nivel_fatiga,
        somnolencia=somnolencia,
    )
    db.add(medicion)
    db.flush()

    return MetricsSavedResponse(
        medicion_id=medicion.id, nivel_fatiga=nivel_fatiga, somnolencia=somnolencia
    )


@router.get("/{sesion_id}/diagnosis", response_model=DiagnosticoOut)
def get_diagnosis(
    sesion_id: int,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
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
    resultado = {}
    for clave in METRICAS_ANALISIS:
        valores = [float(getattr(m, clave)) for m in mediciones if getattr(m, clave) is not None]
        resultado[clave] = round(sum(valores) / len(valores), 3) if valores else None
    return resultado


def tramo_final_de(mediciones: list[Medicion]) -> dict:
    tramo = max(1, math.ceil(len(mediciones) / 4))
    return _promedio_tramo(mediciones[-tramo:])


def construir_payload_analisis(sesion: Sesion, mediciones: list[Medicion]) -> dict:
    tramo = max(1, math.ceil(len(mediciones) / 4))
    duracion_min = None
    if sesion.finalizada_en is not None and sesion.iniciada_en is not None:
        duracion_min = round((sesion.finalizada_en - sesion.iniciada_en).total_seconds() / 60, 1)

    tramo_final = tramo_final_de(mediciones)
    return {
        "sesion": {
            "actividad": sesion.actividad,
            "momento": sesion.momento,
            "duracion_min": duracion_min,
            "num_mediciones": len(mediciones),
        },
        "kss": {"inicial": sesion.kss_inicial, "final": sesion.kss_final},
        "tramo_inicial": _promedio_tramo(mediciones[:tramo]),
        "tramo_final": tramo_final,
        "nivel_fatiga_sistema": clasificar_tramo(tramo_final),
        "control_somnolencia": {
            "mediciones_con_somnolencia": sum(1 for m in mediciones if m.somnolencia),
            "tramo_final": detectar_somnolencia(
                tramo_final["perclos"], tramo_final["cierres_prolongados"]
            ),
        },
    }


@router.put("/{sesion_id}/finish", status_code=status.HTTP_204_NO_CONTENT)
def finish_session(
    sesion_id: int,
    data: SessionFinishRequest,
    background_tasks: BackgroundTasks,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    sesion = _obtener_sesion_del_usuario(db, sesion_id, usuario_id)
    _exigir_sesion_abierta(sesion)

    sesion.kss_final = data.kss_final
    sesion.finalizada_en = func.now()
    db.commit()
    db.refresh(sesion)

    _programar_analisis(db, sesion, background_tasks)


def _programar_analisis(db: Session, sesion: Sesion, background_tasks: BackgroundTasks) -> bool:
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
