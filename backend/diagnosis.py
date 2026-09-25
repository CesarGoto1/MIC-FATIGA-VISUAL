import logging

import httpx

from backend.config import N8N_WEBHOOK_URL
from backend.database import SessionLocal
from backend.models.orm import Diagnostico

TIMEOUT_SECONDS = 30.0

logger = logging.getLogger(__name__)


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


async def generar_diagnostico(sesion_id: int, payload: dict) -> None:
    """Envía las métricas agregadas (sin datos personales) al flujo de n8n y guarda el análisis."""
    if not N8N_WEBHOOK_URL:
        # Sin n8n configurado se deja constancia del fallo para poder reintentarlo luego.
        logger.warning("N8N_WEBHOOK_URL no está configurada; no se generó el análisis.")
        _guardar_diagnostico(sesion_id, texto=None, detalle=None, disponible=False)
        return

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(N8N_WEBHOOK_URL, json=payload)
            response.raise_for_status()
            data = response.json()
            texto = data.get("resumen_general")
    except Exception:
        # Cualquier fallo (red, JSON, serialización) deja constancia en la BD en lugar de
        # perderse silenciosamente dentro de la tarea en segundo plano.
        logger.exception("No se pudo generar el análisis de la sesión %s", sesion_id)
        _guardar_diagnostico(sesion_id, texto=None, detalle=None, disponible=False)
        return

    _guardar_diagnostico(sesion_id, texto=texto, detalle=data, disponible=bool(texto))
