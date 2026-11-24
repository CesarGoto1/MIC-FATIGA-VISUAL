import math
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from backend.diagnostico import generar_diagnostico
from backend.fatiga import clasificar_tramo, detectar_somnolencia
from backend.modelos.orm import Diagnostico, Medicion, Sesion
from backend.modelos.esquemas import (
    DiagnosticoSalida,
    EstadoAnalisis,
    MedicionSalida,
    MomentoJornada,
    PromediosMomento,
    ResumenSalida,
    SesionSalida,
)
from backend.servicios.grabaciones import eliminar_archivo

MIN_MEDICIONES_PARA_ANALISIS = 2
INACTIVIDAD_MAXIMA = timedelta(minutes=15)
UNA_SEMANA = timedelta(days=7)
NIVELES_CON_FATIGA = ("leve", "moderada")
METRICAS_ANALISIS = (
    "parpadeos_min",
    "parpadeos_incompletos_pct",
    "tiempo_cierre",
    "velocidad_ocular",
    "perclos",
    "cierres_prolongados",
)


def mediciones_ordenadas(sesion: Sesion) -> list[Medicion]:
    return sorted(sesion.mediciones, key=lambda m: m.registrado_en)


def duracion_min(sesion: Sesion) -> float | None:
    if sesion.finalizada_en is None or sesion.iniciada_en is None:
        return None
    return round((sesion.finalizada_en - sesion.iniciada_en).total_seconds() / 60, 1)


def _tamano_tramo(mediciones: list[Medicion]) -> int:
    return max(1, math.ceil(len(mediciones) / 4))


def _promedio_tramo(mediciones: list[Medicion]) -> dict:
    resultado = {}
    for clave in METRICAS_ANALISIS:
        valores = [float(getattr(m, clave)) for m in mediciones if getattr(m, clave) is not None]
        resultado[clave] = round(sum(valores) / len(valores), 3) if valores else None
    return resultado


def tramo_final_de(mediciones: list[Medicion]) -> dict:
    return _promedio_tramo(mediciones[-_tamano_tramo(mediciones):])


def somnolencia_de_tramo(tramo: dict) -> bool:
    return detectar_somnolencia(tramo["perclos"], tramo["cierres_prolongados"])


def estado_analisis(sesion: Sesion) -> EstadoAnalisis:
    if any(d.disponible for d in sesion.diagnosticos):
        return "disponible"
    if sesion.finalizada_en is None or len(sesion.mediciones) < MIN_MEDICIONES_PARA_ANALISIS:
        return "sin_datos"
    if sesion.diagnosticos:
        return "no_disponible"
    return "pendiente"


def diagnostico_salida(diagnostico: Diagnostico | None) -> DiagnosticoSalida:
    if diagnostico is None:
        return DiagnosticoSalida(disponible=False, texto=None, detalle=None, generado_en=None)
    return DiagnosticoSalida.model_validate(diagnostico)


def construir_payload_analisis(sesion: Sesion, mediciones: list[Medicion]) -> dict:
    tramo_final = tramo_final_de(mediciones)
    return {
        "sesion": {
            "actividad": sesion.actividad,
            "momento": sesion.momento,
            "duracion_min": duracion_min(sesion),
            "num_mediciones": len(mediciones),
        },
        "kss": {"inicial": sesion.kss_inicial, "final": sesion.kss_final},
        "tramo_inicial": _promedio_tramo(mediciones[:_tamano_tramo(mediciones)]),
        "tramo_final": tramo_final,
        "nivel_fatiga_sistema": clasificar_tramo(tramo_final),
        "control_somnolencia": {
            "mediciones_con_somnolencia": sum(1 for m in mediciones if m.somnolencia),
            "tramo_final": somnolencia_de_tramo(tramo_final),
        },
    }


def programar_analisis(bd: Session, sesion: Sesion, tareas: BackgroundTasks) -> bool:
    mediciones = list(
        bd.scalars(
            select(Medicion)
            .where(Medicion.sesion_id == sesion.id)
            .order_by(Medicion.registrado_en)
        )
    )
    if len(mediciones) < MIN_MEDICIONES_PARA_ANALISIS:
        return False

    tareas.add_task(
        generar_diagnostico, sesion.id, construir_payload_analisis(sesion, mediciones)
    )
    return True


def cerrar_sesiones_abandonadas(bd: Session, usuario_id: int, tareas: BackgroundTasks) -> None:
    limite = datetime.now(timezone.utc) - INACTIVIDAD_MAXIMA
    ultima_medicion = (
        select(Medicion.sesion_id, func.max(Medicion.registrado_en).label("ultima"))
        .group_by(Medicion.sesion_id)
        .subquery()
    )
    abiertas = bd.execute(
        select(Sesion, ultima_medicion.c.ultima)
        .outerjoin(ultima_medicion, ultima_medicion.c.sesion_id == Sesion.id)
        .where(Sesion.usuario_id == usuario_id, Sesion.finalizada_en.is_(None))
    ).all()

    for sesion, ultima in abiertas:
        if (ultima or sesion.iniciada_en) >= limite:
            continue
        if ultima is None:
            if sesion.grabacion is not None:
                eliminar_archivo(sesion.grabacion)
            bd.delete(sesion)
            continue
        sesion.finalizada_en = ultima
        bd.flush()
        programar_analisis(bd, sesion, tareas)
    bd.flush()


def sesion_salida(sesion: Sesion) -> SesionSalida:
    mediciones = mediciones_ordenadas(sesion)
    return SesionSalida(
        id=sesion.id,
        actividad=sesion.actividad,
        momento=sesion.momento,
        kss_inicial=sesion.kss_inicial,
        kss_final=sesion.kss_final,
        iniciada_en=sesion.iniciada_en,
        finalizada_en=sesion.finalizada_en,
        estado_analisis=estado_analisis(sesion),
        nivel_fatiga=clasificar_tramo(tramo_final_de(mediciones)) if mediciones else None,
        mediciones=[MedicionSalida.model_validate(m) for m in mediciones],
    )


def consulta_sesiones_usuario(usuario_id: int) -> Select:
    return (
        select(Sesion)
        .where(Sesion.usuario_id == usuario_id)
        .options(selectinload(Sesion.mediciones), selectinload(Sesion.diagnosticos))
        .order_by(Sesion.iniciada_en.desc(), Sesion.id.desc())
    )


def _numero(valor) -> float | None:
    return None if valor is None else float(valor)


def _promedios_momento(bd: Session, usuario_id: int, momento: MomentoJornada) -> PromediosMomento | None:
    del_momento = (Sesion.usuario_id == usuario_id, Sesion.momento == momento)
    sesiones, kss = bd.execute(
        select(func.count(), func.avg(Sesion.kss_inicial)).where(
            *del_momento, Sesion.id.in_(select(Medicion.sesion_id))
        )
    ).one()
    if not sesiones:
        return None
    parpadeos, incompletos, cierre = bd.execute(
        select(
            func.avg(Medicion.parpadeos_min),
            func.avg(Medicion.parpadeos_incompletos_pct),
            func.avg(Medicion.tiempo_cierre),
        )
        .join(Sesion, Sesion.id == Medicion.sesion_id)
        .where(*del_momento)
    ).one()
    return PromediosMomento(
        sesiones=sesiones,
        kss=_numero(kss),
        parpadeos_min=_numero(parpadeos),
        parpadeos_incompletos_pct=_numero(incompletos),
        tiempo_cierre=_numero(cierre),
    )


def resumen_usuario(bd: Session, usuario_id: int) -> ResumenSalida:
    hace_una_semana = datetime.now(timezone.utc) - UNA_SEMANA
    total, semana, ultima = bd.execute(
        select(
            func.count(),
            func.count().filter(Sesion.iniciada_en >= hace_una_semana),
            func.max(Sesion.iniciada_en),
        ).where(Sesion.usuario_id == usuario_id)
    ).one()
    con_fatiga = bd.scalar(
        select(func.count(func.distinct(Medicion.sesion_id)))
        .join(Sesion, Sesion.id == Medicion.sesion_id)
        .where(Sesion.usuario_id == usuario_id, Medicion.nivel_fatiga.in_(NIVELES_CON_FATIGA))
    )
    return ResumenSalida(
        total_sesiones=total,
        sesiones_semana=semana,
        sesiones_con_fatiga=con_fatiga,
        ultima_sesion=ultima,
        pre=_promedios_momento(bd, usuario_id, "pre"),
        post=_promedios_momento(bd, usuario_id, "post"),
    )
