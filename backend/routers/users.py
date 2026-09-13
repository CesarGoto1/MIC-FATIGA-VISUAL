from fastapi import APIRouter, Depends
from sqlalchemy import desc
from sqlalchemy.orm import Session, selectinload

from backend.database import get_db
from backend.dependencies import get_current_user_id
from backend.models.orm import Sesion
from backend.models.schemas import MedicionOut, SesionOut

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me/history", response_model=list[SesionOut])
def get_history(usuario_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    """Lista las sesiones del usuario junto con todas sus mediciones en una sola consulta."""
    sesiones = (
        db.query(Sesion)
        .filter(Sesion.usuario_id == usuario_id)
        .options(selectinload(Sesion.mediciones))
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
                nivel_subjetivo=m.nivel_subjetivo,
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
                iniciada_en=sesion.iniciada_en.isoformat(),
                finalizada_en=sesion.finalizada_en.isoformat() if sesion.finalizada_en else None,
                mediciones=mediciones,
            )
        )

    return resultado
