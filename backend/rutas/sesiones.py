from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Path, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.base_datos import obtener_bd
from backend.dependencias import usuario_actual, usuario_actual_id
from backend.fatiga import clasificar_fatiga, detectar_somnolencia
from backend.modelos.esquemas import (
    DiagnosticoSalida,
    GrabacionParteSalida,
    MedicionEntrada,
    MedicionGuardadaSalida,
    SesionCambioEntrada,
    SesionNuevaEntrada,
    SesionNuevaSalida,
    SesionSalida,
    SolicitudAnalisisSalida,
)
from backend.modelos.orm import Diagnostico, Medicion, Parpadeo, Sesion, Usuario
from backend.servicios.grabaciones import (
    MAX_BYTES_PARTE,
    ParteFueraDeOrden,
    agregar_parte,
    tipo_mime_base,
)
from backend.servicios.sesiones import (
    cerrar_sesiones_abandonadas,
    consulta_sesiones_usuario,
    diagnostico_salida,
    programar_analisis,
    sesion_salida,
)

router = APIRouter(prefix="/sesiones", tags=["sesiones"])


def _sesion_del_usuario(bd: Session, sesion_id: int, usuario_id: int) -> Sesion:
    sesion = bd.scalar(select(Sesion).where(Sesion.id == sesion_id, Sesion.usuario_id == usuario_id))
    if sesion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La sesión no existe o no pertenece a este usuario.",
        )
    return sesion


def _exigir_sesion_abierta(sesion: Sesion) -> None:
    if sesion.finalizada_en is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La sesión ya fue finalizada.")


def _ultimo_diagnostico(bd: Session, sesion_id: int) -> Diagnostico | None:
    return bd.scalar(
        select(Diagnostico)
        .where(Diagnostico.sesion_id == sesion_id)
        .order_by(Diagnostico.generado_en.desc())
        .limit(1)
    )


@router.post("", response_model=SesionNuevaSalida, status_code=status.HTTP_201_CREATED)
def crear_sesion(
    datos: SesionNuevaEntrada,
    tareas: BackgroundTasks,
    solicitud: Request,
    respuesta: Response,
    usuario: Usuario = Depends(usuario_actual),
    bd: Session = Depends(obtener_bd),
):
    cerrar_sesiones_abandonadas(bd, usuario.id, tareas)
    sesion = Sesion(
        usuario_id=usuario.id,
        grabacion_consentida=datos.grabar if usuario.grabacion_habilitada else None,
        **datos.model_dump(exclude={"grabar"}),
    )
    bd.add(sesion)
    bd.flush()
    respuesta.headers["Location"] = str(solicitud.url_for("obtener_sesion", sesion_id=sesion.id))
    return SesionNuevaSalida(
        id=sesion.id,
        actividad=sesion.actividad,
        momento=sesion.momento,
        kss_inicial=sesion.kss_inicial,
        grabar=bool(sesion.grabacion_consentida),
    )


@router.get("/{sesion_id}", response_model=SesionSalida)
def obtener_sesion(
    sesion_id: int,
    usuario_id: int = Depends(usuario_actual_id),
    bd: Session = Depends(obtener_bd),
):
    sesion = bd.scalar(consulta_sesiones_usuario(usuario_id).where(Sesion.id == sesion_id))
    if sesion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La sesión no existe o no pertenece a este usuario.",
        )
    return sesion_salida(sesion)


@router.patch("/{sesion_id}", status_code=status.HTTP_204_NO_CONTENT)
def finalizar_sesion(
    sesion_id: int,
    datos: SesionCambioEntrada,
    tareas: BackgroundTasks,
    usuario_id: int = Depends(usuario_actual_id),
    bd: Session = Depends(obtener_bd),
):
    sesion = _sesion_del_usuario(bd, sesion_id, usuario_id)
    _exigir_sesion_abierta(sesion)
    sesion.kss_final = datos.kss_final
    sesion.finalizada_en = func.now()
    bd.commit()
    bd.refresh(sesion)
    programar_analisis(bd, sesion, tareas)


@router.post(
    "/{sesion_id}/mediciones",
    response_model=MedicionGuardadaSalida,
    status_code=status.HTTP_201_CREATED,
)
def guardar_medicion(
    sesion_id: int,
    datos: MedicionEntrada,
    usuario_id: int = Depends(usuario_actual_id),
    bd: Session = Depends(obtener_bd),
):
    sesion = _sesion_del_usuario(bd, sesion_id, usuario_id)
    _exigir_sesion_abierta(sesion)

    nivel_fatiga = clasificar_fatiga(datos.parpadeos_min, datos.parpadeos_incompletos_pct)
    somnolencia = detectar_somnolencia(datos.perclos, datos.cierres_prolongados)
    medicion = Medicion(
        sesion_id=sesion_id,
        actividad=sesion.actividad,
        nivel_fatiga=nivel_fatiga,
        somnolencia=somnolencia,
        **datos.model_dump(exclude={"parpadeos"}),
    )
    bd.add(medicion)
    bd.flush()
    bd.add_all(
        Parpadeo(sesion_id=sesion_id, medicion_id=medicion.id, **parpadeo.model_dump())
        for parpadeo in datos.parpadeos
    )
    bd.flush()
    return MedicionGuardadaSalida(id=medicion.id, nivel_fatiga=nivel_fatiga, somnolencia=somnolencia)


@router.get("/{sesion_id}/diagnostico", response_model=DiagnosticoSalida)
def obtener_diagnostico(
    sesion_id: int,
    usuario_id: int = Depends(usuario_actual_id),
    bd: Session = Depends(obtener_bd),
):
    _sesion_del_usuario(bd, sesion_id, usuario_id)
    return diagnostico_salida(_ultimo_diagnostico(bd, sesion_id))


@router.post(
    "/{sesion_id}/diagnostico",
    response_model=SolicitudAnalisisSalida,
    status_code=status.HTTP_202_ACCEPTED,
)
def solicitar_diagnostico(
    sesion_id: int,
    tareas: BackgroundTasks,
    usuario_id: int = Depends(usuario_actual_id),
    bd: Session = Depends(obtener_bd),
):
    sesion = _sesion_del_usuario(bd, sesion_id, usuario_id)
    if sesion.finalizada_en is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La sesión aún no ha finalizado.")

    ya_disponible = bd.scalar(
        select(Diagnostico.id).where(Diagnostico.sesion_id == sesion_id, Diagnostico.disponible.is_(True))
    )
    if ya_disponible is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La sesión ya tiene un análisis disponible.",
        )
    if not programar_analisis(bd, sesion, tareas):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La sesión no tiene mediciones suficientes para generar un análisis.",
        )
    return SolicitudAnalisisSalida(estado_analisis="pendiente")


@router.put("/{sesion_id}/grabacion/partes/{parte}", response_model=GrabacionParteSalida)
def subir_parte_grabacion(
    sesion_id: int,
    parte: int = Path(ge=0),
    contenido: bytes = Body(media_type="application/octet-stream"),
    desfase_ms: int = Query(ge=0),
    tipo_mime: str = Query(max_length=80),
    usuario: Usuario = Depends(usuario_actual),
    bd: Session = Depends(obtener_bd),
):
    sesion = _sesion_del_usuario(bd, sesion_id, usuario.id)
    _exigir_sesion_abierta(sesion)
    if not sesion.grabacion_consentida or not usuario.grabacion_habilitada:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La grabación no está habilitada para esta sesión.",
        )
    tipo = tipo_mime_base(tipo_mime)
    if tipo is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Formato de video no admitido.")
    if not contenido:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="La parte de video está vacía.")
    if len(contenido) > MAX_BYTES_PARTE:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="La parte de video es demasiado grande.")

    try:
        grabacion = agregar_parte(bd, sesion, parte, tipo, desfase_ms, contenido)
    except ParteFueraDeOrden:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Parte de video fuera de orden.")
    return GrabacionParteSalida(partes=grabacion.partes, bytes=grabacion.bytes)
