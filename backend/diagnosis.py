import httpx

from backend.config import N8N_WEBHOOK_URL
from backend.database import SessionLocal
from backend.models.orm import Diagnostico

TIMEOUT_SECONDS = 10.0


def _guardar_diagnostico(
    sesion_id: int, texto: str | None, detalle: dict | None, disponible: bool
) -> None:
    """Inserta un registro nuevo en diagnosticos para la sesión indicada."""
    db = SessionLocal()
    try:
        db.add(
            Diagnostico(sesion_id=sesion_id, texto=texto, detalle=detalle, disponible=disponible)
        )
        db.commit()
    finally:
        db.close()


async def generar_diagnostico(
    sesion_id: int, medicion_inicial: dict, medicion_final: dict
) -> None:
    if not N8N_WEBHOOK_URL:
        return

    payload = {"medicion_inicial": medicion_inicial, "medicion_final": medicion_final}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(N8N_WEBHOOK_URL, json=payload)
            response.raise_for_status()
            data = response.json()
            texto = data.get("diagnostico_general")
    except (httpx.HTTPError, ValueError):
        _guardar_diagnostico(sesion_id, texto=None, detalle=None, disponible=False)
        return

    _guardar_diagnostico(sesion_id, texto=texto, detalle=data, disponible=bool(texto))
