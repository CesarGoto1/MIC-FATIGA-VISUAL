from backend.models.schemas import NivelFatiga

PERCLOS_LEVE = 15.0
PERCLOS_MODERADA = 30.0

PARPADEOS_MIN_BAJO = 8.0


def clasificar_fatiga(perclos: float, parpadeos_min: float) -> NivelFatiga:
    if perclos >= PERCLOS_MODERADA:
        return "moderada"
    if perclos >= PERCLOS_LEVE or parpadeos_min < PARPADEOS_MIN_BAJO:
        return "leve"
    return "sin_fatiga"
