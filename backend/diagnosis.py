import logging

import httpx

from backend.config import N8N_WEBHOOK_URL
from backend.database import SessionLocal
from backend.fatigue import NIVEL_ETIQUETA
from backend.models.orm import Diagnostico

TIMEOUT_SECONDS = 30.0

logger = logging.getLogger(__name__)


def _guardar_diagnostico(
    sesion_id: int, texto: str | None, detalle: dict | None, disponible: bool
) -> None:
    db = SessionLocal()
    try:
        db.add(
            Diagnostico(sesion_id=sesion_id, texto=texto, detalle=detalle, disponible=disponible)
        )
        db.commit()
    finally:
        db.close()


async def generar_diagnostico(sesion_id: int, payload: dict) -> None:
    if not N8N_WEBHOOK_URL:
        logger.warning("N8N_WEBHOOK_URL no está configurada; no se generó el análisis.")
        _guardar_diagnostico(sesion_id, texto=None, detalle=None, disponible=False)
        return

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(N8N_WEBHOOK_URL, json=payload)
            response.raise_for_status()
            data = response.json()
    except Exception:
        logger.exception("No se pudo generar el análisis de la sesión %s", sesion_id)
        _guardar_diagnostico(sesion_id, texto=None, detalle=None, disponible=False)
        return

    if not es_analisis_valido(data):
        logger.warning("El análisis de la sesión %s no tiene el formato esperado.", sesion_id)
        _guardar_diagnostico(sesion_id, texto=None, detalle=data, disponible=False)
        return

    nivel = payload.get("nivel_fatiga_sistema")
    if nivel in NIVEL_ETIQUETA:
        data["nivel_fatiga_final"] = NIVEL_ETIQUETA[nivel]
    _guardar_diagnostico(sesion_id, texto=data["resumen_general"], detalle=data, disponible=True)


def es_analisis_valido(data: object) -> bool:
    return (
        isinstance(data, dict)
        and isinstance(data.get("resumen_general"), str)
        and data["resumen_general"].strip() != ""
        and isinstance(data.get("evaluacion_parametros"), dict)
        and len(data["evaluacion_parametros"]) > 0
    )
