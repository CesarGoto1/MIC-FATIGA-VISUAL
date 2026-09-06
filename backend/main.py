from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from backend.routers import auth, sessions, users

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


class RevalidateStaticFiles(StaticFiles):
    """StaticFiles que fuerza a los navegadores a revalidar en cada carga
    (en vez de servir del caché local sin preguntar). El frontend se sirve
    con nombres de archivo fijos (sin hash de contenido en la URL), así que
    sin esto un cambio en un .js/.css puede tardar en verse reflejado en el
    navegador aunque el servidor ya tenga el archivo nuevo."""

    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response

app = FastAPI(
    title="Sistema inteligente de monitoreo visual para el control de la fatiga ocular",
    version="0.1.0",
)

# CORS deliberadamente NO está habilitado: el frontend se sirve desde este
# mismo backend (mismo origen), así que no hace falta abrirlo. Si en algún
# momento el frontend se despliega en otro dominio, agrega aquí
# CORSMiddleware restringido a ESE dominio exacto — nunca allow_origins=["*"]
# junto con allow_credentials=True.

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(users.router)

app.mount("/static", RevalidateStaticFiles(directory=FRONTEND_DIR / "static"), name="static")


@app.get("/")
def serve_index():
    return FileResponse(FRONTEND_DIR / "templates" / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/health")
def health():
    """Endpoint simple para verificar que el backend está vivo (útil para
    docker-compose healthchecks o para el propio despliegue en Render)."""
    return {"status": "ok"}
