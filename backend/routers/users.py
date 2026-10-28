from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import desc
from sqlalchemy.orm import Session, selectinload

from backend.database import get_db
from backend.dependencies import get_current_user_id
from backend.models.orm import Medicion, Sesion, Usuario
from backend.models.schemas import MedicionOut, PerfilOut, SesionOut
from backend.fatigue import clasificar_tramo
from backend.routers.sessions import MIN_MEDICIONES_PARA_ANALISIS, cerrar_sesiones_abandonadas, tramo_final_de

router = APIRouter(prefix="/users", tags=["users"])


def estado_analisis(sesion: Sesion) -> str:
    if any(d.disponible for d in sesion.diagnosticos):
        return "disponible"
    if sesion.finalizada_en is None or len(sesion.mediciones) < MIN_MEDICIONES_PARA_ANALISIS:
        return "sin_datos"
    if sesion.diagnosticos:
        return "no_disponible"
    return "pendiente"


def medicion_out(m: Medicion) -> MedicionOut:
    return MedicionOut(
        id=m.id,
        actividad=m.actividad,
        ear=m.ear,
        perclos=m.perclos,
        parpadeos_min=m.parpadeos_min,
        tiempo_cierre=m.tiempo_cierre,
        velocidad_ocular=m.velocidad_ocular,
        cierres_prolongados=m.cierres_prolongados,
        parpadeos_incompletos_pct=m.parpadeos_incompletos_pct,
        nivel_fatiga=m.nivel_fatiga,
        somnolencia=m.somnolencia,
        registrado_en=m.registrado_en.isoformat(),
    )


@router.get("/me", response_model=PerfilOut)
def get_me(usuario_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="El usuario no existe.")
    return PerfilOut(
        usuario_id=usuario.id,
        nombre=usuario.nombre,
        codigo_participante=usuario.codigo,
        es_admin=usuario.es_admin,
    )


@router.get("/me/history", response_model=list[SesionOut])
def get_history(
    background_tasks: BackgroundTasks,
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    cerrar_sesiones_abandonadas(db, usuario_id, background_tasks)
    sesiones = (
        db.query(Sesion)
        .filter(Sesion.usuario_id == usuario_id)
        .options(selectinload(Sesion.mediciones), selectinload(Sesion.diagnosticos))
        .order_by(desc(Sesion.iniciada_en))
        .all()
    )

    resultado = []
    for sesion in sesiones:
        ordenadas = sorted(sesion.mediciones, key=lambda m: m.registrado_en)
        mediciones = [medicion_out(m) for m in ordenadas]

        resultado.append(
            SesionOut(
                id=sesion.id,
                actividad=sesion.actividad,
                momento=sesion.momento,
                kss_inicial=sesion.kss_inicial,
                kss_final=sesion.kss_final,
                iniciada_en=sesion.iniciada_en.isoformat(),
                finalizada_en=sesion.finalizada_en.isoformat() if sesion.finalizada_en else None,
                estado_analisis=estado_analisis(sesion),
                nivel_fatiga=clasificar_tramo(tramo_final_de(ordenadas)) if ordenadas else None,
                mediciones=mediciones,
            )
        )

    return resultado
