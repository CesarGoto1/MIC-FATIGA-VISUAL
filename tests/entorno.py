import os
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

RAIZ = Path(__file__).resolve().parent.parent


def _url_pruebas() -> str:
    entorno = {**dotenv_values(RAIZ / ".env"), **os.environ}
    if entorno.get("TEST_DATABASE_URL"):
        return entorno["TEST_DATABASE_URL"]
    url = make_url(entorno["DATABASE_URL"])
    return url.set(database=f"{url.database}_pruebas").render_as_string(hide_password=False)


def _crear_base_si_no_existe(url: str) -> None:
    destino = make_url(url)
    motor = create_engine(destino.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with motor.connect() as conexion:
        existe = conexion.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :nombre"), {"nombre": destino.database}
        )
        if not existe:
            conexion.execute(text(f'CREATE DATABASE "{destino.database}"'))
    motor.dispose()


URL_PRUEBAS = _url_pruebas()
os.environ["DATABASE_URL"] = URL_PRUEBAS
os.environ["N8N_WEBHOOK_URL"] = ""
os.environ.setdefault("JWT_SECRET", "secreto-de-pruebas-con-longitud-suficiente-32")
_crear_base_si_no_existe(URL_PRUEBAS)
