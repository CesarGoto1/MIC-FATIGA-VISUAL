import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _obligatoria(nombre: str) -> str:
    valor = os.getenv(nombre)
    if not valor:
        raise RuntimeError(
            f"Falta la variable de entorno '{nombre}'. "
            f"Copia .env.example a .env y complétala."
        )
    return valor


URL_BASE_DATOS = _obligatoria("DATABASE_URL")
SECRETO_JWT = _obligatoria("JWT_SECRET")
ALGORITMO_JWT = os.getenv("JWT_ALGORITHM", "HS256")
MINUTOS_EXPIRACION_JWT = int(os.getenv("JWT_EXPIRE_MINUTES", "120"))
URL_WEBHOOK_N8N = os.getenv("N8N_WEBHOOK_URL")
DIRECTORIO_GRABACIONES = Path(
    os.getenv("GRABACIONES_DIR", Path(__file__).resolve().parent.parent / "grabaciones")
)
