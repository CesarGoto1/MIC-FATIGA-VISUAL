from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.base_datos import obtener_bd
from backend.dependencias import exigir_admin
from backend.modelos.esquemas import (
    GrabacionSalida,
    MedicionSalida,
    MomentoJornada,
    ParpadeoSalida,
    ParticipanteCambioEntrada,
    ParticipanteSalida,
    SesionAdminDetalleSalida,
    SesionAdminSalida,
)
from backend.modelos.orm import Sesion, Usuario
from backend.paginacion import Pagina, Paginacion, crear_pagina, paginar, parametros_paginacion
from backend.servicios import admin as servicio
from backend.servicios.exportacion import (
    COLUMNAS_MEDICIONES,
    COLUMNAS_PARPADEOS,
    COLUMNAS_SESIONES,
    filas_mediciones,
    filas_parpadeos,
    filas_sesiones,
    respuesta_csv,
)
from backend.servicios.grabaciones import archivo_para_ver, borrar_grabacion, ruta_archivo
from backend.servicios.sesiones import diagnostico_salida, mediciones_ordenadas

router = APIRouter(prefix="/admin", tags=["administración"], dependencies=[Depends(exigir_admin)])


def _usuario_id(codigo: str) -> int:
    try:
        return servicio.usuario_id_de_codigo(codigo)
    except servicio.CodigoInvalido:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Código de participante inválido. Usa el formato P001.",
        )


def _filtros(
    participante: str | None = Query(default=None, description="Código anónimo, p. ej. P001"),
    momento: MomentoJornada | None = None,
    desde: date | None = None,
    hasta: date | None = None,
) -> servicio.FiltrosSesiones:
    if participante:
        _usuario_id(participante)
    return servicio.FiltrosSesiones(participante, momento, desde, hasta)


def _sesion_o_404(bd: Session, sesion_id: int) -> Sesion:
    sesion = servicio.sesion_completa(bd, sesion_id)
    if sesion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="La sesión no existe.")
    return sesion


@router.get("/participantes", response_model=Pagina[ParticipanteSalida])
def listar_participantes(
    paginacion: Paginacion = Depends(parametros_paginacion), bd: Session = Depends(obtener_bd)
):
    participantes, total = servicio.pagina_participantes(bd, paginacion.por_pagina, paginacion.desplazamiento)
    return crear_pagina(participantes, total, paginacion)


@router.patch("/participantes/{codigo}", response_model=ParticipanteSalida)
def cambiar_participante(
    codigo: str, datos: ParticipanteCambioEntrada, bd: Session = Depends(obtener_bd)
):
    usuario = bd.get(Usuario, _usuario_id(codigo))
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="El participante no existe.")
    usuario.grabacion_habilitada = datos.grabacion_habilitada
    bd.flush()
    return servicio.participante(bd, usuario.id)


@router.get("/sesiones", response_model=Pagina[SesionAdminSalida])
def listar_sesiones(
    filtros: servicio.FiltrosSesiones = Depends(_filtros),
    paginacion: Paginacion = Depends(parametros_paginacion),
    bd: Session = Depends(obtener_bd),
):
    sesiones, total = paginar(bd, servicio.consulta_sesiones(filtros), paginacion)
    return crear_pagina(servicio.resumenes_sesiones(bd, sesiones), total, paginacion)


@router.get("/sesiones/{sesion_id}", response_model=SesionAdminDetalleSalida)
def detalle_sesion(sesion_id: int, bd: Session = Depends(obtener_bd)):
    sesion = _sesion_o_404(bd, sesion_id)
    resumen = servicio.resumenes_sesiones(bd, [sesion])[0]
    ultimo = max(sesion.diagnosticos, key=lambda d: d.generado_en, default=None)
    return SesionAdminDetalleSalida(
        **resumen.model_dump(),
        mediciones=[MedicionSalida.model_validate(m) for m in mediciones_ordenadas(sesion)],
        diagnostico=diagnostico_salida(ultimo),
        grabacion=GrabacionSalida.model_validate(sesion.grabacion) if sesion.grabacion else None,
    )


@router.get("/sesiones/{sesion_id}/parpadeos", response_model=Pagina[ParpadeoSalida])
def parpadeos_de_sesion(
    sesion_id: int,
    paginacion: Paginacion = Depends(parametros_paginacion),
    bd: Session = Depends(obtener_bd),
):
    _sesion_o_404(bd, sesion_id)
    parpadeos, total = paginar(bd, servicio.consulta_parpadeos([sesion_id]), paginacion)
    return crear_pagina(parpadeos, total, paginacion)


@router.get("/sesiones/{sesion_id}/grabacion")
def descargar_grabacion(sesion_id: int, bd: Session = Depends(obtener_bd)):
    grabacion = _sesion_o_404(bd, sesion_id).grabacion
    if grabacion is None or not ruta_archivo(grabacion).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="La sesión no tiene grabación.")
    ruta, tipo_mime = archivo_para_ver(grabacion)
    return FileResponse(ruta, media_type=tipo_mime, filename=f"sesion_{sesion_id}{ruta.suffix}")


@router.delete("/sesiones/{sesion_id}/grabacion", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_grabacion(sesion_id: int, bd: Session = Depends(obtener_bd)):
    if not borrar_grabacion(bd, _sesion_o_404(bd, sesion_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="La sesión no tiene grabación.")


@router.get("/exportaciones/sesiones.csv")
def exportar_sesiones(
    filtros: servicio.FiltrosSesiones = Depends(_filtros), bd: Session = Depends(obtener_bd)
):
    resumenes = servicio.resumenes_sesiones(bd, servicio.sesiones_filtradas(bd, filtros))
    return respuesta_csv("sesiones.csv", COLUMNAS_SESIONES, filas_sesiones(resumenes))


@router.get("/exportaciones/mediciones.csv")
def exportar_mediciones(
    filtros: servicio.FiltrosSesiones = Depends(_filtros), bd: Session = Depends(obtener_bd)
):
    sesiones = servicio.sesiones_filtradas(bd, filtros)
    return respuesta_csv("mediciones.csv", COLUMNAS_MEDICIONES, filas_mediciones(sesiones))


@router.get("/exportaciones/parpadeos.csv")
def exportar_parpadeos(
    filtros: servicio.FiltrosSesiones = Depends(_filtros),
    sesion_id: int | None = None,
    bd: Session = Depends(obtener_bd),
):
    if sesion_id is not None:
        sesiones = [_sesion_o_404(bd, sesion_id)]
        nombre = f"parpadeos_sesion_{sesion_id}.csv"
    else:
        sesiones = servicio.sesiones_filtradas(bd, filtros)
        nombre = "parpadeos.csv"
    usuario_de_sesion = {s.id: s.usuario_id for s in sesiones}
    parpadeos = servicio.parpadeos_de_sesiones(bd, list(usuario_de_sesion))
    return respuesta_csv(nombre, COLUMNAS_PARPADEOS, filas_parpadeos(parpadeos, usuario_de_sesion))
