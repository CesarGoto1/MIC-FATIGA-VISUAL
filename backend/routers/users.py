from fastapi import APIRouter, Depends
from sqlalchemy import desc
from sqlalchemy.orm import Session, selectinload

from backend.database import get_db
from backend.dependencies import get_current_user_id
from backend.models.orm import Sesion
from backend.models.schemas import MedicionOut, SesionOut
from backend.routers.sessions import MIN_MEDICIONES_PARA_ANALISIS

router = APIRouter(prefix="/users", tags=["users"])


def _estado_analisis(sesion: Sesion) -> str:
    if any(d.disponible for d in sesion.diagnosticos):
        return "disponible"
    if sesion.finalizada_en is None or len(sesion.mediciones) < MIN_MEDICIONES_PARA_ANALISIS:
        return "sin_datos"
    if sesion.diagnosticos:
        return "no_disponible"
    # Finalizada con datos y sin ningún intento registrado: la tarea aún está en curso.
    return "pendiente"


@router.get("/me/history", response_model=list[SesionOut])
def get_history(usuario_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    """Lista las sesiones del usuario junto con todas sus mediciones en una sola consulta."""
    sesiones = (
        db.query(Sesion)
        .filter(Sesion.usuario_id == usuario_id)
        .options(selectinload(Sesion.mediciones), selectinload(Sesion.diagnosticos))
        .order_by(desc(Sesion.iniciada_en))
        .all()
    )

    resultado = []
    for sesion in sesiones:
        mediciones = [
            MedicionOut(
                id=m.id,
                actividad=m.actividad,
                ear=m.ear,
                perclos=m.perclos,
                parpadeos_min=m.parpadeos_min,
                tiempo_cierre=m.tiempo_cierre,
                velocidad_ocular=m.velocidad_ocular,
                cierres_prolongados=m.cierres_prolongados,
                nivel_fatiga=m.nivel_fatiga,
                registrado_en=m.registrado_en.isoformat(),
            )
            for m in sorted(sesion.mediciones, key=lambda m: m.registrado_en)
        ]

        resultado.append(
            SesionOut(
                id=sesion.id,
                actividad=sesion.actividad,
                momento=sesion.momento,
                kss_inicial=sesion.kss_inicial,
                kss_final=sesion.kss_final,
                iniciada_en=sesion.iniciada_en.isoformat(),
                finalizada_en=sesion.finalizada_en.isoformat() if sesion.finalizada_en else None,
                estado_analisis=_estado_analisis(sesion),
                mediciones=mediciones,
            )
        )

    return resultado
