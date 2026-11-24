import uuid

import pytest

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from tests.entorno import RAIZ
from backend import configuracion
from backend.principal import PREFIJO_API, aplicacion
from backend.scripts.crear_admin import promover
from backend.servicios import sesiones as servicio_sesiones
from tests.datos import MEDICION_BASE

CLAVE = "clave-larga-123"


@pytest.fixture(scope="session", autouse=True)
def _esquema_actualizado():
    command.upgrade(Config(str(RAIZ / "alembic.ini")), "head")


@pytest.fixture(autouse=True)
def _grabaciones_temporales(monkeypatch, tmp_path):
    monkeypatch.setattr(configuracion, "DIRECTORIO_GRABACIONES", tmp_path)


@pytest.fixture(scope="session")
def cliente() -> TestClient:
    return TestClient(aplicacion, base_url=f"http://testserver{PREFIJO_API}")


@pytest.fixture
def analisis_solicitados(monkeypatch) -> list[tuple[int, dict]]:
    solicitados = []

    async def falso_diagnostico(sesion_id, datos_sesion):
        solicitados.append((sesion_id, datos_sesion))

    monkeypatch.setattr(servicio_sesiones, "generar_diagnostico", falso_diagnostico)
    return solicitados


@pytest.fixture
def registrar(cliente):
    def _registrar(nombre: str = "Participante") -> tuple[dict, dict]:
        correo = f"prueba-{uuid.uuid4().hex[:8]}@example.com"
        respuesta = cliente.post("/usuarios", json={"nombre": nombre, "correo": correo, "clave": CLAVE})
        assert respuesta.status_code == 201, respuesta.text
        datos = respuesta.json()
        return {"Authorization": f"Bearer {datos['token_acceso']}"}, {**datos, "correo": correo}

    return _registrar


@pytest.fixture
def cabeceras(registrar) -> dict:
    return registrar()[0]


@pytest.fixture
def cabeceras_admin(registrar) -> dict:
    cabeceras, datos = registrar("Administrador")
    assert promover(datos["correo"])
    return cabeceras


@pytest.fixture
def crear_sesion(cliente):
    def _crear(cabeceras: dict, **extra) -> int:
        cuerpo = {"actividad": "lectura", "momento": "pre", "kss_inicial": 3, **extra}
        respuesta = cliente.post("/sesiones", json=cuerpo, headers=cabeceras)
        assert respuesta.status_code == 201, respuesta.text
        return respuesta.json()["id"]

    return _crear


@pytest.fixture
def sesion_finalizada(cliente, crear_sesion):
    def _sesion(cabeceras: dict, mediciones: int = 2, kss_final: int = 5, **extra) -> int:
        sesion_id = crear_sesion(cabeceras, **extra)
        for _ in range(mediciones):
            cliente.post(f"/sesiones/{sesion_id}/mediciones", json=MEDICION_BASE, headers=cabeceras)
        cliente.patch(f"/sesiones/{sesion_id}", json={"finalizada": True, "kss_final": kss_final}, headers=cabeceras)
        return sesion_id

    return _sesion
