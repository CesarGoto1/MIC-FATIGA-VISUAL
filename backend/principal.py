from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from backend.errores import registrar_manejadores
from backend.rutas import acceso, admin, sesiones, usuarios

PREFIJO_API = "/api/v1"
DIRECTORIO_FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SIN_CACHE = {"Cache-Control": "no-cache"}


class EstaticosRevalidados(StaticFiles):
    async def get_response(self, path: str, scope: Scope):
        respuesta = await super().get_response(path, scope)
        respuesta.headers.update(SIN_CACHE)
        return respuesta


aplicacion = FastAPI(
    title="Sistema inteligente de monitoreo visual para el control de la fatiga ocular",
    version="1.0.0",
    openapi_url=f"{PREFIJO_API}/openapi.json",
    docs_url=f"{PREFIJO_API}/docs",
    redoc_url=None,
)
registrar_manejadores(aplicacion)

api = APIRouter(prefix=PREFIJO_API)
for modulo in (acceso, usuarios, sesiones, admin):
    api.include_router(modulo.router)


@api.get("/salud", tags=["salud"])
def salud():
    return {"estado": "ok"}


aplicacion.include_router(api)

aplicacion.mount(
    "/estaticos",
    EstaticosRevalidados(directory=DIRECTORIO_FRONTEND / "static"),
    name="estaticos",
)


@aplicacion.get("/", include_in_schema=False)
def inicio():
    return FileResponse(DIRECTORIO_FRONTEND / "templates" / "index.html", headers=SIN_CACHE)
