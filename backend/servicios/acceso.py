from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.modelos.esquemas import TokenSalida
from backend.modelos.orm import Usuario
from backend.seguridad import crear_token_acceso


def buscar_por_correo(bd: Session, correo: str) -> Usuario | None:
    return bd.scalar(select(Usuario).where(func.lower(Usuario.correo) == correo))


def token_salida(usuario: Usuario) -> TokenSalida:
    return TokenSalida(
        token_acceso=crear_token_acceso(usuario.id),
        usuario_id=usuario.id,
        nombre=usuario.nombre,
        codigo_participante=usuario.codigo,
        es_admin=usuario.es_admin,
    )
