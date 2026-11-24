import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.base_datos import obtener_bd
from backend.modelos.orm import Usuario
from backend.seguridad import leer_token_acceso

_esquema_bearer = HTTPBearer(auto_error=False)
CABECERA_BEARER = {"WWW-Authenticate": "Bearer"}


def usuario_actual_id(
    credenciales: HTTPAuthorizationCredentials | None = Depends(_esquema_bearer),
) -> int:
    if credenciales is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers=CABECERA_BEARER,
            detail="No se proporcionó un token de autenticación.",
        )
    try:
        return leer_token_acceso(credenciales.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers=CABECERA_BEARER,
            detail="La sesión expiró. Vuelve a iniciar sesión.",
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers=CABECERA_BEARER,
            detail="Token de autenticación inválido.",
        )


def usuario_actual(
    usuario_id: int = Depends(usuario_actual_id),
    bd: Session = Depends(obtener_bd),
) -> Usuario:
    usuario = bd.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="El usuario no existe.", headers=CABECERA_BEARER
        )
    return usuario


def exigir_admin(usuario: Usuario = Depends(usuario_actual)) -> Usuario:
    if not usuario.es_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo los administradores pueden acceder a esta sección.",
        )
    return usuario
