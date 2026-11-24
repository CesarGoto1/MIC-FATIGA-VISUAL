from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from backend.base_datos import obtener_bd
from backend.dependencias import usuario_actual, usuario_actual_id
from backend.modelos.esquemas import PerfilSalida, RegistroEntrada, ResumenSalida, SesionSalida, TokenSalida
from backend.modelos.orm import Usuario
from backend.paginacion import Pagina, Paginacion, crear_pagina, paginar, parametros_paginacion
from backend.seguridad import generar_hash_clave
from backend.servicios.acceso import buscar_por_correo, token_salida
from backend.servicios.sesiones import (
    cerrar_sesiones_abandonadas,
    consulta_sesiones_usuario,
    resumen_usuario,
    sesion_salida,
)

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


@router.post("", response_model=TokenSalida, status_code=status.HTTP_201_CREATED)
def registrar(
    datos: RegistroEntrada, solicitud: Request, respuesta: Response, bd: Session = Depends(obtener_bd)
):
    if buscar_por_correo(bd, datos.correo) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una cuenta registrada con ese correo.",
        )
    usuario = Usuario(
        nombre=datos.nombre,
        correo=datos.correo,
        clave_hash=generar_hash_clave(datos.clave),
    )
    bd.add(usuario)
    bd.flush()
    respuesta.headers["Location"] = str(solicitud.url_for("perfil"))
    return token_salida(usuario)


@router.get("/yo", response_model=PerfilSalida)
def perfil(usuario: Usuario = Depends(usuario_actual)):
    return PerfilSalida(
        usuario_id=usuario.id,
        nombre=usuario.nombre,
        codigo_participante=usuario.codigo,
        es_admin=usuario.es_admin,
        grabacion_habilitada=usuario.grabacion_habilitada,
    )


@router.get("/yo/sesiones", response_model=Pagina[SesionSalida])
def mis_sesiones(
    tareas: BackgroundTasks,
    paginacion: Paginacion = Depends(parametros_paginacion),
    usuario_id: int = Depends(usuario_actual_id),
    bd: Session = Depends(obtener_bd),
):
    cerrar_sesiones_abandonadas(bd, usuario_id, tareas)
    sesiones, total = paginar(bd, consulta_sesiones_usuario(usuario_id), paginacion)
    return crear_pagina([sesion_salida(s) for s in sesiones], total, paginacion)


@router.get("/yo/resumen", response_model=ResumenSalida)
def mi_resumen(usuario_id: int = Depends(usuario_actual_id), bd: Session = Depends(obtener_bd)):
    return resumen_usuario(bd, usuario_id)
