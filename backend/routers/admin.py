import csv
import io
import re
from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import case, desc, func
from sqlalchemy.orm import Session, selectinload

from backend.database import get_db
from backend.dependencies import require_admin
from backend.fatigue import clasificar_tramo, detectar_somnolencia
from backend.models.orm import Diagnostico, Medicion, Sesion, Usuario, codigo_participante
from backend.models.schemas import (
    AdminParticipanteOut,
    AdminSesionDetalleOut,
    AdminSesionOut,
    DiagnosticoOut,
    MomentoJornada,
)
from backend.routers.sessions import tramo_final_de
from backend.routers.users import estado_analisis, medicion_out

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

CODIGO_PATRON = re.compile(r"^P?0*(\d+)$", re.IGNORECASE)

COLUMNAS_SESIONES = [
    "participante",
    "sesion_id",
    "actividad",
    "momento",
    "kss_inicial",
    "kss_final",
    "iniciada_en",
    "finalizada_en",
    "duracion_min",
    "num_mediciones",
    "nivel_fatiga_tramo_final",
    "mediciones_con_somnolencia",
    "somnolencia_tramo_final",
    "estado_analisis",
]

COLUMNAS_MEDICIONES = [
    "participante",
    "sesion_id",
    "momento",
    "actividad",
    "minuto",
    "registrado_en",
    "ear",
    "perclos",
    "parpadeos_min",
    "tiempo_cierre",
    "velocidad_ocular",
    "cierres_prolongados",
    "parpadeos_incompletos_pct",
    "nivel_fatiga",
    "somnolencia",
]


def _usuario_id_de_codigo(codigo: str) -> int:
    coincidencia = CODIGO_PATRON.match(codigo.strip())
    if coincidencia is None:
        raise HTTPException(
            status_code=422,
            detail="Código de participante inválido. Usa el formato P001.",
        )
    return int(coincidencia.group(1))


def _sesiones_filtradas(
    db: Session,
    participante: Optional[str],
    momento: Optional[MomentoJornada],
    desde: Optional[date],
    hasta: Optional[date],
) -> list[Sesion]:
    consulta = db.query(Sesion).options(
        selectinload(Sesion.mediciones), selectinload(Sesion.diagnosticos)
    )
    if participante:
        consulta = consulta.filter(Sesion.usuario_id == _usuario_id_de_codigo(participante))
    if momento:
        consulta = consulta.filter(Sesion.momento == momento)
    if desde:
        consulta = consulta.filter(Sesion.iniciada_en >= datetime.combine(desde, time.min).astimezone())
    if hasta:
        limite = datetime.combine(hasta + timedelta(days=1), time.min).astimezone()
        consulta = consulta.filter(Sesion.iniciada_en < limite)
    return consulta.order_by(desc(Sesion.iniciada_en)).all()


def _filtros(
    participante: Optional[str] = Query(default=None, description="Código anónimo, p. ej. P001"),
    momento: Optional[MomentoJornada] = None,
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
) -> dict:
    return {"participante": participante, "momento": momento, "desde": desde, "hasta": hasta}


def _ordenadas(sesion: Sesion) -> list[Medicion]:
    return sorted(sesion.mediciones, key=lambda m: m.registrado_en)


def _resumen_sesion(sesion: Sesion) -> AdminSesionOut:
    mediciones = _ordenadas(sesion)
    tramo_final = tramo_final_de(mediciones) if mediciones else None
    duracion_min = None
    if sesion.finalizada_en is not None:
        duracion_min = round((sesion.finalizada_en - sesion.iniciada_en).total_seconds() / 60, 1)

    return AdminSesionOut(
        id=sesion.id,
        participante=codigo_participante(sesion.usuario_id),
        actividad=sesion.actividad,
        momento=sesion.momento,
        kss_inicial=sesion.kss_inicial,
        kss_final=sesion.kss_final,
        iniciada_en=sesion.iniciada_en.isoformat(),
        finalizada_en=sesion.finalizada_en.isoformat() if sesion.finalizada_en else None,
        duracion_min=duracion_min,
        num_mediciones=len(mediciones),
        nivel_fatiga_tramo_final=clasificar_tramo(tramo_final) if tramo_final else None,
        mediciones_con_somnolencia=sum(1 for m in mediciones if m.somnolencia),
        somnolencia_tramo_final=(
            detectar_somnolencia(tramo_final["perclos"], tramo_final["cierres_prolongados"])
            if tramo_final
            else None
        ),
        estado_analisis=estado_analisis(sesion),
    )


def _csv_response(nombre_archivo: str, columnas: list[str], filas: list[dict]) -> Response:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columnas, extrasaction="ignore", lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(filas)
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )


def _fecha_csv(valor: Optional[datetime]) -> str:
    return valor.isoformat(timespec="seconds") if valor else ""


@router.get("/participantes", response_model=list[AdminParticipanteOut])
def listar_participantes(db: Session = Depends(get_db)):
    filas = (
        db.query(
            Usuario.id,
            func.count(Sesion.id),
            func.count(case((Sesion.momento == "pre", 1))),
            func.count(case((Sesion.momento == "post", 1))),
            func.max(Sesion.iniciada_en),
        )
        .outerjoin(Sesion, Sesion.usuario_id == Usuario.id)
        .group_by(Usuario.id)
        .order_by(Usuario.id)
        .all()
    )
    return [
        AdminParticipanteOut(
            codigo=codigo_participante(usuario_id),
            sesiones=total,
            sesiones_pre=pre,
            sesiones_post=post,
            ultima_sesion=ultima.isoformat() if ultima else None,
        )
        for usuario_id, total, pre, post, ultima in filas
    ]


@router.get("/sesiones", response_model=list[AdminSesionOut])
def listar_sesiones(filtros: dict = Depends(_filtros), db: Session = Depends(get_db)):
    return [_resumen_sesion(s) for s in _sesiones_filtradas(db, **filtros)]


@router.get("/sesiones/{sesion_id}", response_model=AdminSesionDetalleOut)
def detalle_sesion(sesion_id: int, db: Session = Depends(get_db)):
    sesion = (
        db.query(Sesion)
        .options(selectinload(Sesion.mediciones), selectinload(Sesion.diagnosticos))
        .filter(Sesion.id == sesion_id)
        .first()
    )
    if sesion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="La sesión no existe.")

    diagnostico: Optional[Diagnostico] = max(
        sesion.diagnosticos, key=lambda d: d.generado_en, default=None
    )
    return AdminSesionDetalleOut(
        **_resumen_sesion(sesion).model_dump(),
        mediciones=[medicion_out(m) for m in _ordenadas(sesion)],
        diagnostico=DiagnosticoOut(
            disponible=diagnostico.disponible if diagnostico else False,
            texto=diagnostico.texto if diagnostico else None,
            detalle=diagnostico.detalle if diagnostico else None,
            generado_en=diagnostico.generado_en.isoformat() if diagnostico else None,
        ),
    )


@router.get("/export/sesiones.csv")
def exportar_sesiones(filtros: dict = Depends(_filtros), db: Session = Depends(get_db)):
    filas = []
    for sesion in _sesiones_filtradas(db, **filtros):
        resumen = _resumen_sesion(sesion).model_dump()
        filas.append(
            {
                **resumen,
                "sesion_id": sesion.id,
                "iniciada_en": _fecha_csv(sesion.iniciada_en),
                "finalizada_en": _fecha_csv(sesion.finalizada_en),
            }
        )
    return _csv_response("sesiones.csv", COLUMNAS_SESIONES, filas)


@router.get("/export/mediciones.csv")
def exportar_mediciones(filtros: dict = Depends(_filtros), db: Session = Depends(get_db)):
    filas = []
    for sesion in _sesiones_filtradas(db, **filtros):
        for minuto, m in enumerate(_ordenadas(sesion), start=1):
            filas.append(
                {
                    "participante": codigo_participante(sesion.usuario_id),
                    "sesion_id": sesion.id,
                    "momento": sesion.momento,
                    "actividad": m.actividad,
                    "minuto": minuto,
                    "registrado_en": _fecha_csv(m.registrado_en),
                    "ear": m.ear,
                    "perclos": m.perclos,
                    "parpadeos_min": m.parpadeos_min,
                    "tiempo_cierre": m.tiempo_cierre,
                    "velocidad_ocular": m.velocidad_ocular,
                    "cierres_prolongados": m.cierres_prolongados,
                    "parpadeos_incompletos_pct": m.parpadeos_incompletos_pct,
                    "nivel_fatiga": m.nivel_fatiga,
                    "somnolencia": m.somnolencia,
                }
            )
    return _csv_response("mediciones.csv", COLUMNAS_MEDICIONES, filas)
