import logging
from http import HTTPStatus

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

bitacora = logging.getLogger(__name__)

CODIGOS_ERROR = {
    status.HTTP_400_BAD_REQUEST: "solicitud_invalida",
    status.HTTP_401_UNAUTHORIZED: "no_autenticado",
    status.HTTP_403_FORBIDDEN: "prohibido",
    status.HTTP_404_NOT_FOUND: "no_encontrado",
    status.HTTP_405_METHOD_NOT_ALLOWED: "metodo_no_permitido",
    status.HTTP_409_CONFLICT: "conflicto",
    status.HTTP_413_CONTENT_TOO_LARGE: "contenido_demasiado_grande",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "tipo_no_admitido",
    status.HTTP_422_UNPROCESSABLE_CONTENT: "datos_invalidos",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "error_interno",
}
MENSAJES_GENERICOS = {
    status.HTTP_404_NOT_FOUND: "El recurso solicitado no existe.",
    status.HTTP_405_METHOD_NOT_ALLOWED: "El método no está permitido para este recurso.",
}
UBICACIONES = {"body": "cuerpo", "query": "consulta", "path": "ruta", "header": "cabecera"}



def respuesta_error(
    estado: int, mensaje: str, detalles: list | None = None, cabeceras: dict | None = None
) -> JSONResponse:
    error = {"codigo": CODIGOS_ERROR.get(estado, "error"), "mensaje": mensaje}
    if detalles:
        error["detalles"] = detalles
    return JSONResponse({"error": jsonable_encoder(error)}, status_code=estado, headers=cabeceras)


def _detalle_validacion(error: dict) -> dict:
    ubicacion, *campo = error.get("loc", ("",))
    mensaje = error.get("msg", "")
    if mensaje.startswith("Value error, "):
        mensaje = mensaje.removeprefix("Value error, ")
    return {
        "ubicacion": UBICACIONES.get(ubicacion, ubicacion),
        "campo": ".".join(str(parte) for parte in campo),
        "mensaje": mensaje,
    }


async def _error_http(_: Request, error: StarletteHTTPException) -> JSONResponse:
    generico = HTTPStatus(error.status_code).phrase
    if not isinstance(error.detail, str) or error.detail == generico:
        mensaje = MENSAJES_GENERICOS.get(error.status_code, "Error en la solicitud.")
    else:
        mensaje = error.detail
    return respuesta_error(error.status_code, mensaje, cabeceras=getattr(error, "headers", None))


async def _error_validacion(_: Request, error: RequestValidationError) -> JSONResponse:
    return respuesta_error(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "Los datos enviados no son válidos.",
        [_detalle_validacion(e) for e in error.errors()],
    )


async def _error_inesperado(_: Request, error: Exception) -> JSONResponse:
    bitacora.exception("Error no controlado", exc_info=error)
    return respuesta_error(status.HTTP_500_INTERNAL_SERVER_ERROR, "Ocurrió un error interno en el servidor.")


def registrar_manejadores(aplicacion: FastAPI) -> None:
    aplicacion.add_exception_handler(StarletteHTTPException, _error_http)
    aplicacion.add_exception_handler(RequestValidationError, _error_validacion)
    aplicacion.add_exception_handler(Exception, _error_inesperado)
