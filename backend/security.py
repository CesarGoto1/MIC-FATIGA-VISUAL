from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from backend.config import JWT_ALGORITHM, JWT_EXPIRE_MINUTES, JWT_SECRET

# --- Contraseñas (RNF04: bcrypt, nunca SHA-256 ni texto plano) ---


def hash_password(plain_password: str) -> str:
    hashed = bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))


# --- Tokens de sesión (RF08: el backend verifica la identidad, no confía
# en un usuario_id que el cliente envíe en el body) ---


def create_access_token(usuario_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": str(usuario_id), "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> int:
    """Devuelve el usuario_id codificado en el token, o lanza jwt.PyJWTError
    si el token es inválido o expiró. El llamador (dependencies.py) se
    encarga de convertir eso en un 401."""
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    return int(payload["sub"])
