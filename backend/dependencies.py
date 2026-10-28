import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.orm import Usuario
from backend.security import decode_access_token

_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> int:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No se proporcionó un token de autenticación.",
        )
    try:
        return decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La sesión expiró. Vuelve a iniciar sesión.",
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticación inválido.",
        )


def require_admin(
    usuario_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> int:
    usuario = db.get(Usuario, usuario_id)
    if usuario is None or not usuario.es_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo los administradores pueden acceder a esta sección.",
        )
    return usuario_id
