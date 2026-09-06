from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from backend.database import get_connection
from backend.dependencies import get_current_user_id
from backend.diagnosis import generar_diagnostico
from backend.fatigue import clasificar_fatiga
from backend.models.schemas import (
    DiagnosticoOut,
    MetricsInRequest,
    MetricsSavedResponse,
    SessionCreateRequest,
    SessionCreateResponse,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionCreateResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    data: SessionCreateRequest,
    usuario_id: int = Depends(get_current_user_id),
):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sesiones (usuario_id, actividad, momento)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (usuario_id, data.actividad, data.momento),
            )
            sesion_id = cur.fetchone()[0]

    return SessionCreateResponse(sesion_id=sesion_id, actividad=data.actividad, momento=data.momento)


@router.post("/{sesion_id}/metrics", response_model=MetricsSavedResponse)
def save_metrics(
    sesion_id: int,
    data: MetricsInRequest,
    background_tasks: BackgroundTasks,
    usuario_id: int = Depends(get_current_user_id),
):
    nivel_fatiga = clasificar_fatiga(data.perclos, data.parpadeos_min)

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Verifica que la sesión exista y pertenezca a quien hace la
            # petición (nunca confiar en un usuario_id del body/cliente).
            cur.execute(
                "SELECT id FROM sesiones WHERE id = %s AND usuario_id = %s",
                (sesion_id, usuario_id),
            )
            if cur.fetchone() is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="La sesión no existe o no pertenece a este usuario.",
                )

            cur.execute(
                """
                INSERT INTO mediciones
                    (sesion_id, actividad, ear, perclos, parpadeos_min, nivel_fatiga)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    sesion_id,
                    data.actividad,
                    data.ear,
                    data.perclos,
                    data.parpadeos_min,
                    nivel_fatiga,
                ),
            )
            medicion_id = cur.fetchone()[0]

    # RF09 / RNF05: el diagnóstico narrativo de IA se dispara aparte y de
    # forma asíncrona, solo cuando hay señal de fatiga (evita golpear el
    # webhook de n8n/Gemini en cada intervalo de "sin_fatiga"). Nunca está
    # disponible en esta misma respuesta; se consulta con el GET de abajo.
    if nivel_fatiga != "sin_fatiga":
        background_tasks.add_task(
            generar_diagnostico,
            sesion_id,
            {
                "actividad": data.actividad,
                "ear": data.ear,
                "perclos": data.perclos,
                "parpadeos_min": data.parpadeos_min,
                "nivel_fatiga": nivel_fatiga,
            },
        )

    return MetricsSavedResponse(
        medicion_id=medicion_id,
        nivel_fatiga=nivel_fatiga,
        diagnostico_disponible=False,
    )


@router.get("/{sesion_id}/diagnosis", response_model=DiagnosticoOut)
def get_diagnosis(
    sesion_id: int,
    usuario_id: int = Depends(get_current_user_id),
):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM sesiones WHERE id = %s AND usuario_id = %s",
                (sesion_id, usuario_id),
            )
            if cur.fetchone() is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="La sesión no existe o no pertenece a este usuario.",
                )

            cur.execute(
                """
                SELECT texto, disponible, generado_en
                FROM diagnosticos
                WHERE sesion_id = %s
                ORDER BY generado_en DESC
                LIMIT 1
                """,
                (sesion_id,),
            )
            row = cur.fetchone()

    if row is None:
        # Todavía no se ha disparado ningún intento de diagnóstico para
        # esta sesión (p. ej. nunca hubo fatiga leve/moderada).
        return DiagnosticoOut(disponible=False, texto=None, generado_en=None)

    texto, disponible, generado_en = row
    return DiagnosticoOut(
        disponible=disponible,
        texto=texto,
        generado_en=generado_en.isoformat(),
    )


@router.put("/{sesion_id}/finish", status_code=status.HTTP_204_NO_CONTENT)
def finish_session(
    sesion_id: int,
    usuario_id: int = Depends(get_current_user_id),
):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sesiones
                SET finalizada_en = now()
                WHERE id = %s AND usuario_id = %s
                """,
                (sesion_id, usuario_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="La sesión no existe o no pertenece a este usuario.",
                )
