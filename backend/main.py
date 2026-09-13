from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from backend.routers import auth, sessions, users

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


class RevalidateStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response

app = FastAPI(
    title="Sistema inteligente de monitoreo visual para el control de la fatiga ocular",
    version="0.1.0",
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(users.router)

app.mount("/static", RevalidateStaticFiles(directory=FRONTEND_DIR / "static"), name="static")


@app.get("/")
def serve_index():
    return FileResponse(FRONTEND_DIR / "templates" / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/health")
def health():
    return {"status": "ok"}
