from backend.models.schemas import NivelFatiga

PARPADEOS_MIN_BAJO = 8.0
INCOMPLETOS_PCT_ALTO = 40.0

PERCLOS_SOMNOLENCIA = 15.0
CIERRES_PROLONGADOS_SOMNOLENCIA = 2

NIVEL_ETIQUETA: dict[NivelFatiga, str] = {
    "sin_fatiga": "Sin fatiga",
    "leve": "Leve",
    "moderada": "Moderada",
}


def clasificar_fatiga(parpadeos_min: float, parpadeos_incompletos_pct: float | None) -> NivelFatiga:
    signos = 0
    if parpadeos_min < PARPADEOS_MIN_BAJO:
        signos += 1
    if parpadeos_incompletos_pct is not None and parpadeos_incompletos_pct >= INCOMPLETOS_PCT_ALTO:
        signos += 1
    return ("sin_fatiga", "leve", "moderada")[signos]


def detectar_somnolencia(perclos: float | None, cierres_prolongados: float | None) -> bool:
    return (perclos or 0) >= PERCLOS_SOMNOLENCIA or (
        cierres_prolongados or 0
    ) >= CIERRES_PROLONGADOS_SOMNOLENCIA


def clasificar_tramo(promedios: dict) -> NivelFatiga | None:
    parpadeos_min = promedios.get("parpadeos_min")
    if parpadeos_min is None:
        return None
    return clasificar_fatiga(parpadeos_min, promedios.get("parpadeos_incompletos_pct"))
