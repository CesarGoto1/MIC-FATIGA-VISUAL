from fastapi import APIRouter, Depends

from backend.database import get_connection
from backend.dependencies import get_current_user_id
from backend.models.schemas import MedicionOut, SesionOut

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me/history", response_model=list[SesionOut])
def get_history(usuario_id: int = Depends(get_current_user_id)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, actividad, momento, iniciada_en, finalizada_en
                FROM sesiones
                WHERE usuario_id = %s
                ORDER BY iniciada_en DESC
                """,
                (usuario_id,),
            )
            sesiones = cur.fetchall()

            resultado = []
            for sesion_id, actividad, momento, iniciada_en, finalizada_en in sesiones:
                cur.execute(
                    """
                    SELECT id, actividad, ear, perclos, parpadeos_min,
                           nivel_fatiga, registrado_en
                    FROM mediciones
                    WHERE sesion_id = %s
                    ORDER BY registrado_en ASC
                    """,
                    (sesion_id,),
                )
                mediciones = [
                    MedicionOut(
                        id=m[0],
                        actividad=m[1],
                        ear=m[2],
                        perclos=m[3],
                        parpadeos_min=m[4],
                        nivel_fatiga=m[5],
                        registrado_en=m[6].isoformat(),
                    )
                    for m in cur.fetchall()
                ]

                resultado.append(
                    SesionOut(
                        id=sesion_id,
                        actividad=actividad,
                        momento=momento,
                        iniciada_en=iniciada_en.isoformat(),
                        finalizada_en=finalizada_en.isoformat() if finalizada_en else None,
                        mediciones=mediciones,
                    )
                )

    return resultado
