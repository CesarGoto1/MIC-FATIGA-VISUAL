from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.base_datos import obtener_bd
from backend.modelos.esquemas import IngresoEntrada, TokenSalida
from backend.seguridad import verificar_clave
from backend.servicios.acceso import buscar_por_correo, token_salida

router = APIRouter(prefix="/tokens", tags=["acceso"])


@router.post("", response_model=TokenSalida, status_code=status.HTTP_201_CREATED)
def crear_token(datos: IngresoEntrada, bd: Session = Depends(obtener_bd)):
    usuario = buscar_por_correo(bd, datos.correo)
    if usuario is None or not verificar_clave(datos.clave, usuario.clave_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos.",
        )
    return token_salida(usuario)
