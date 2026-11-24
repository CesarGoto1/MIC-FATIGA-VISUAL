import csv
import io
from collections.abc import Iterable
from datetime import datetime

from fastapi.responses import Response

from backend.modelos.esquemas import SesionAdminSalida
from backend.modelos.orm import Parpadeo, Sesion, codigo_participante
from backend.servicios.sesiones import mediciones_ordenadas

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
    "parpadeos_completos",
    "parpadeos_incompletos",
    "cierres_prolongados_total",
    "grabacion_consentida",
    "tiene_grabacion",
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

COLUMNAS_PARPADEOS = [
    "participante",
    "sesion_id",
    "medicion_id",
    "n",
    "tipo",
    "inicio_ms",
    "inicio_s",
    "duracion_ms",
    "ocurrido_en",
    "ear_minimo",
    "umbral_p80",
    "ear_base",
]


def _fecha(valor: datetime | None, precision: str = "seconds") -> str:
    return valor.isoformat(timespec=precision) if valor else ""


def respuesta_csv(nombre_archivo: str, columnas: list[str], filas: Iterable[dict]) -> Response:
    contenido = io.StringIO()
    escritor = csv.DictWriter(contenido, fieldnames=columnas, extrasaction="ignore", lineterminator="\r\n")
    escritor.writeheader()
    escritor.writerows(filas)
    return Response(
        content="﻿" + contenido.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )


def filas_sesiones(resumenes: list[SesionAdminSalida]) -> list[dict]:
    return [
        {
            **resumen.model_dump(),
            "sesion_id": resumen.id,
            "iniciada_en": _fecha(resumen.iniciada_en),
            "finalizada_en": _fecha(resumen.finalizada_en),
        }
        for resumen in resumenes
    ]


def filas_mediciones(sesiones: list[Sesion]) -> list[dict]:
    return [
        {
            "participante": codigo_participante(sesion.usuario_id),
            "sesion_id": sesion.id,
            "momento": sesion.momento,
            "actividad": medicion.actividad,
            "minuto": minuto,
            "registrado_en": _fecha(medicion.registrado_en),
            "ear": medicion.ear,
            "perclos": medicion.perclos,
            "parpadeos_min": medicion.parpadeos_min,
            "tiempo_cierre": medicion.tiempo_cierre,
            "velocidad_ocular": medicion.velocidad_ocular,
            "cierres_prolongados": medicion.cierres_prolongados,
            "parpadeos_incompletos_pct": medicion.parpadeos_incompletos_pct,
            "nivel_fatiga": medicion.nivel_fatiga,
            "somnolencia": medicion.somnolencia,
        }
        for sesion in sesiones
        for minuto, medicion in enumerate(mediciones_ordenadas(sesion), start=1)
    ]


def filas_parpadeos(parpadeos: list[Parpadeo], usuario_de_sesion: dict[int, int]) -> list[dict]:
    filas = []
    numero: dict[int, int] = {}
    for parpadeo in parpadeos:
        numero[parpadeo.sesion_id] = numero.get(parpadeo.sesion_id, 0) + 1
        filas.append(
            {
                "participante": codigo_participante(usuario_de_sesion[parpadeo.sesion_id]),
                "sesion_id": parpadeo.sesion_id,
                "medicion_id": parpadeo.medicion_id,
                "n": numero[parpadeo.sesion_id],
                "tipo": parpadeo.tipo,
                "inicio_ms": parpadeo.inicio_ms,
                "inicio_s": round(parpadeo.inicio_ms / 1000, 3),
                "duracion_ms": parpadeo.duracion_ms,
                "ocurrido_en": _fecha(parpadeo.ocurrido_en, "milliseconds"),
                "ear_minimo": parpadeo.ear_minimo,
                "umbral_p80": parpadeo.umbral_p80,
                "ear_base": parpadeo.ear_base,
            }
        )
    return filas
