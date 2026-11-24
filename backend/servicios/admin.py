import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session, selectinload

from backend.fatiga import clasificar_tramo
from backend.modelos.esquemas import MomentoJornada, ParticipanteSalida, SesionAdminSalida
from backend.modelos.orm import Parpadeo, Sesion, Usuario, codigo_participante
from backend.servicios.sesiones import (
    duracion_min,
    estado_analisis,
    mediciones_ordenadas,
    somnolencia_de_tramo,
    tramo_final_de,
)

PATRON_CODIGO = re.compile(r"^P?0*(\d+)$", re.IGNORECASE)

CAMPO_CONTEO = {
    "completo": "parpadeos_completos",
    "incompleto": "parpadeos_incompletos",
    "prolongado": "cierres_prolongados_total",
}


class CodigoInvalido(ValueError):
    pass


@dataclass(frozen=True)
class FiltrosSesiones:
    participante: str | None = None
    momento: MomentoJornada | None = None
    desde: date | None = None
    hasta: date | None = None


def usuario_id_de_codigo(codigo: str) -> int:
    coincidencia = PATRON_CODIGO.match(codigo.strip())
    if coincidencia is None:
        raise CodigoInvalido(codigo)
    return int(coincidencia.group(1))


def _con_relaciones(consulta):
    return consulta.options(
        selectinload(Sesion.mediciones),
        selectinload(Sesion.diagnosticos),
        selectinload(Sesion.grabacion),
    )


def sesion_completa(bd: Session, sesion_id: int) -> Sesion | None:
    return bd.scalar(_con_relaciones(select(Sesion)).where(Sesion.id == sesion_id))


def consulta_sesiones(filtros: FiltrosSesiones) -> Select:
    consulta = _con_relaciones(select(Sesion))
    if filtros.participante:
        consulta = consulta.where(Sesion.usuario_id == usuario_id_de_codigo(filtros.participante))
    if filtros.momento:
        consulta = consulta.where(Sesion.momento == filtros.momento)
    if filtros.desde:
        inicio = datetime.combine(filtros.desde, time.min).astimezone()
        consulta = consulta.where(Sesion.iniciada_en >= inicio)
    if filtros.hasta:
        limite = datetime.combine(filtros.hasta + timedelta(days=1), time.min).astimezone()
        consulta = consulta.where(Sesion.iniciada_en < limite)
    return consulta.order_by(Sesion.iniciada_en.desc(), Sesion.id.desc())


def sesiones_filtradas(bd: Session, filtros: FiltrosSesiones) -> list[Sesion]:
    return list(bd.scalars(consulta_sesiones(filtros)))


def conteos_parpadeos(bd: Session, sesion_ids: list[int]) -> dict[int, dict]:
    if not sesion_ids:
        return {}
    filas = bd.execute(
        select(Parpadeo.sesion_id, Parpadeo.tipo, func.count())
        .where(Parpadeo.sesion_id.in_(sesion_ids))
        .group_by(Parpadeo.sesion_id, Parpadeo.tipo)
    ).all()
    conteos: dict[int, dict] = {}
    for sesion_id, tipo, total in filas:
        conteos.setdefault(sesion_id, {})[CAMPO_CONTEO[tipo]] = total
    return conteos


def resumen_sesion(sesion: Sesion, conteos: dict | None = None) -> SesionAdminSalida:
    mediciones = mediciones_ordenadas(sesion)
    tramo_final = tramo_final_de(mediciones) if mediciones else None
    return SesionAdminSalida(
        id=sesion.id,
        participante=codigo_participante(sesion.usuario_id),
        actividad=sesion.actividad,
        momento=sesion.momento,
        kss_inicial=sesion.kss_inicial,
        kss_final=sesion.kss_final,
        iniciada_en=sesion.iniciada_en,
        finalizada_en=sesion.finalizada_en,
        estado_analisis=estado_analisis(sesion),
        duracion_min=duracion_min(sesion),
        num_mediciones=len(mediciones),
        nivel_fatiga_tramo_final=clasificar_tramo(tramo_final) if tramo_final else None,
        mediciones_con_somnolencia=sum(1 for m in mediciones if m.somnolencia),
        somnolencia_tramo_final=somnolencia_de_tramo(tramo_final) if tramo_final else None,
        grabacion_consentida=sesion.grabacion_consentida,
        tiene_grabacion=sesion.grabacion is not None,
        **(conteos or {}),
    )


def resumenes_sesiones(bd: Session, sesiones: list[Sesion]) -> list[SesionAdminSalida]:
    conteos = conteos_parpadeos(bd, [s.id for s in sesiones])
    return [resumen_sesion(s, conteos.get(s.id)) for s in sesiones]


def _fila_participante(fila) -> ParticipanteSalida:
    uid, total, pre, post, ultima, grabacion = fila
    return ParticipanteSalida(
        codigo=codigo_participante(uid),
        sesiones=total,
        sesiones_pre=pre,
        sesiones_post=post,
        ultima_sesion=ultima,
        grabacion_habilitada=grabacion,
    )


def _consulta_participantes() -> Select:
    return (
        select(
            Usuario.id,
            func.count(Sesion.id),
            func.count(case((Sesion.momento == "pre", 1))),
            func.count(case((Sesion.momento == "post", 1))),
            func.max(Sesion.iniciada_en),
            Usuario.grabacion_habilitada,
        )
        .outerjoin(Sesion, Sesion.usuario_id == Usuario.id)
        .group_by(Usuario.id)
        .order_by(Usuario.id)
    )


def pagina_participantes(bd: Session, limite: int, desplazamiento: int) -> tuple[list[ParticipanteSalida], int]:
    total = bd.scalar(select(func.count()).select_from(Usuario))
    filas = bd.execute(_consulta_participantes().limit(limite).offset(desplazamiento)).all()
    return [_fila_participante(fila) for fila in filas], total


def participante(bd: Session, usuario_id: int) -> ParticipanteSalida:
    fila = bd.execute(_consulta_participantes().where(Usuario.id == usuario_id)).one()
    return _fila_participante(fila)


def consulta_parpadeos(sesion_ids: list[int]) -> Select:
    return (
        select(Parpadeo)
        .where(Parpadeo.sesion_id.in_(sesion_ids))
        .order_by(Parpadeo.sesion_id, Parpadeo.inicio_ms, Parpadeo.id)
    )


def parpadeos_de_sesiones(bd: Session, sesion_ids: list[int]) -> list[Parpadeo]:
    return list(bd.scalars(consulta_parpadeos(sesion_ids)))
