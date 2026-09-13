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
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


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


@router.post("", response_model=SessionCreateResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    data: SessionCreateRequest,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Inserta un registro nuevo en sesiones para el usuario autenticado."""
    sesion = Sesion(usuario_id=usuario_id, actividad=data.actividad, momento=data.momento)
    db.add(sesion)
    db.flush()

    return SessionCreateResponse(sesion_id=sesion.id, actividad=sesion.actividad, momento=sesion.momento)


@router.post("/{sesion_id}/metrics", response_model=MetricsSavedResponse)
def save_metrics(
    sesion_id: int,
    data: MetricsInRequest,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Inserta un registro nuevo en mediciones asociado a una sesión existente."""
    _obtener_sesion_del_usuario(db, sesion_id, usuario_id)

    nivel_fatiga = clasificar_fatiga(data.perclos, data.parpadeos_min)

    medicion = Medicion(
        sesion_id=sesion_id,
        actividad=data.actividad,
        ear=data.ear,
        perclos=data.perclos,
        parpadeos_min=data.parpadeos_min,
        tiempo_cierre=data.tiempo_cierre,
        velocidad_ocular=data.velocidad_ocular,
        nivel_subjetivo=data.nivel_subjetivo,
        nivel_fatiga=nivel_fatiga,
    )
    db.add(medicion)
    db.flush()

    return MetricsSavedResponse(
        medicion_id=medicion.id,
        nivel_fatiga=nivel_fatiga,
        diagnostico_disponible=False,
    )


@router.get("/{sesion_id}/diagnosis", response_model=DiagnosticoOut)
def get_diagnosis(
    sesion_id: int,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Consulta el diagnóstico más reciente generado para una sesión."""
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


def _medicion_a_dict(medicion: Medicion) -> dict:
    return {
        "perclos": medicion.perclos,
        "sebr": medicion.parpadeos_min,
        "tiempo_cierre": medicion.tiempo_cierre,
        "velocidad_ocular": medicion.velocidad_ocular,
        "nivel_subjetivo": medicion.nivel_subjetivo,
    }


@router.put("/{sesion_id}/finish", status_code=status.HTTP_204_NO_CONTENT)
def finish_session(
    sesion_id: int,
    background_tasks: BackgroundTasks,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Marca una sesión como finalizada y, si hubo fatiga, agenda el diagnóstico narrativo."""
    sesion = _obtener_sesion_del_usuario(db, sesion_id, usuario_id)
    sesion.finalizada_en = func.now()

    mediciones_con_fatiga = (
        db.query(Medicion)
        .filter(Medicion.sesion_id == sesion_id, Medicion.nivel_fatiga != "sin_fatiga")
        .count()
    )
    hubo_fatiga = mediciones_con_fatiga > 0

    if hubo_fatiga:
        medicion_inicial = (
            db.query(Medicion)
            .filter(Medicion.sesion_id == sesion_id)
            .order_by(asc(Medicion.registrado_en))
            .first()
        )
        medicion_final = (
            db.query(Medicion)
            .filter(Medicion.sesion_id == sesion_id)
            .order_by(desc(Medicion.registrado_en))
            .first()
        )

        background_tasks.add_task(
            generar_diagnostico,
            sesion_id,
            {"usuario_id": usuario_id, **_medicion_a_dict(medicion_inicial)},
            _medicion_a_dict(medicion_final),
        )
