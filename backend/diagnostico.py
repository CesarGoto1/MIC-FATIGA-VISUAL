import logging

import httpx

from backend.base_datos import crear_sesion_bd
from backend.configuracion import URL_WEBHOOK_N8N
from backend.fatiga import NIVEL_ETIQUETA
from backend.modelos.orm import Diagnostico

TIEMPO_ESPERA_S = 30.0

bitacora = logging.getLogger(__name__)


def _guardar_diagnostico(
    sesion_id: int, texto: str | None, detalle: dict | None, disponible: bool
) -> None:
    with crear_sesion_bd() as bd:
        bd.add(Diagnostico(sesion_id=sesion_id, texto=texto, detalle=detalle, disponible=disponible))
        bd.commit()


def es_analisis_valido(analisis: object) -> bool:
    return (
        isinstance(analisis, dict)
        and isinstance(analisis.get("resumen_general"), str)
        and analisis["resumen_general"].strip() != ""
        and isinstance(analisis.get("evaluacion_parametros"), dict)
        and len(analisis["evaluacion_parametros"]) > 0
    )


async def _solicitar_analisis(datos_sesion: dict) -> object:
    async with httpx.AsyncClient(timeout=TIEMPO_ESPERA_S) as cliente:
        respuesta = await cliente.post(URL_WEBHOOK_N8N, json=datos_sesion)
        respuesta.raise_for_status()
        return respuesta.json()


async def generar_diagnostico(sesion_id: int, datos_sesion: dict) -> None:
    if not URL_WEBHOOK_N8N:
        bitacora.warning("N8N_WEBHOOK_URL no está configurada; no se generó el análisis.")
        _guardar_diagnostico(sesion_id, texto=None, detalle=None, disponible=False)
        return

    try:
        analisis = await _solicitar_analisis(datos_sesion)
    except (httpx.HTTPError, ValueError):
        bitacora.exception("No se pudo generar el análisis de la sesión %s", sesion_id)
        _guardar_diagnostico(sesion_id, texto=None, detalle=None, disponible=False)
        return

    if not es_analisis_valido(analisis):
        bitacora.warning("El análisis de la sesión %s no tiene el formato esperado.", sesion_id)
        _guardar_diagnostico(sesion_id, texto=None, detalle=analisis, disponible=False)
        return

    nivel = datos_sesion.get("nivel_fatiga_sistema")
    if nivel in NIVEL_ETIQUETA:
        analisis["nivel_fatiga_final"] = NIVEL_ETIQUETA[nivel]
    _guardar_diagnostico(sesion_id, texto=analisis["resumen_general"], detalle=analisis, disponible=True)
