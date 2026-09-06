import os
from dotenv import load_dotenv

# Carga variables desde .env si existe. En producción (Render u otro)
# esto no tiene efecto: las variables de entorno reales ya existen y
# load_dotenv() nunca las sobrescribe (override=False por defecto).
load_dotenv()


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Falta la variable de entorno '{name}'. "
            f"Copia .env.example a .env y complétala."
        )
    return value


DATABASE_URL = _require("DATABASE_URL")
JWT_SECRET = _require("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "120"))
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL")  # opcional: RF09 puede no estar activo aún
