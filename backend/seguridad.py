from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from backend.configuracion import ALGORITMO_JWT, MINUTOS_EXPIRACION_JWT, SECRETO_JWT

MAX_BYTES_CLAVE = 72


def generar_hash_clave(clave: str) -> str:
    return bcrypt.hashpw(clave.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verificar_clave(clave: str, clave_hash: str) -> bool:
    return bcrypt.checkpw(clave.encode("utf-8"), clave_hash.encode("utf-8"))


def crear_token_acceso(usuario_id: int) -> str:
    expiracion = datetime.now(timezone.utc) + timedelta(minutes=MINUTOS_EXPIRACION_JWT)
    return jwt.encode({"sub": str(usuario_id), "exp": expiracion}, SECRETO_JWT, algorithm=ALGORITMO_JWT)


def leer_token_acceso(token: str) -> int:
    contenido = jwt.decode(token, SECRETO_JWT, algorithms=[ALGORITMO_JWT])
    return int(contenido["sub"])
