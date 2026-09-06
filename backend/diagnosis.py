"""Integración con n8n/Gemini para el diagnóstico narrativo (RF09).

Se llama desde sessions.py con BackgroundTasks (nunca de forma síncrona):
su fallo o demora nunca deben bloquear el guardado de una métrica (RNF05).

El workflow de n8n (no vive en este repo, se configura en la UI de n8n)
debe exponer un Webhook en N8N_WEBHOOK_URL que reciba este JSON:
    {"sesion_id": int, "actividad": str, "ear": float,
     "perclos": float, "parpadeos_min": float, "nivel_fatiga": str}
y responda con {"texto": "<diagnóstico narrativo generado por Gemini>"}.
"""

import httpx

from backend.config import N8N_WEBHOOK_URL
from backend.database import get_connection

TIMEOUT_SECONDS = 10.0


def _guardar_diagnostico(sesion_id: int, texto: str | None, disponible: bool) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO diagnosticos (sesion_id, texto, disponible)
                VALUES (%s, %s, %s)
                """,
                (sesion_id, texto, disponible),
            )


async def generar_diagnostico(sesion_id: int, metrics: dict) -> None:
    if not N8N_WEBHOOK_URL:
        return  # RF09 es opcional: si no está configurado, no se intenta.

    payload = {"sesion_id": sesion_id, **metrics}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(N8N_WEBHOOK_URL, json=payload)
            response.raise_for_status()
            texto = response.json().get("texto")
    except (httpx.HTTPError, ValueError):
        # RNF05: si n8n/Gemini falla o expira, se registra como no
        # disponible en vez de perder el intento o bloquear nada.
        _guardar_diagnostico(sesion_id, texto=None, disponible=False)
        return

    _guardar_diagnostico(sesion_id, texto=texto, disponible=bool(texto))
