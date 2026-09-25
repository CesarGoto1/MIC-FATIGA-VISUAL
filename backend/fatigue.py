"""Clasificación del nivel de fatiga visual a partir de métricas oculares agregadas.

Los umbrales son reglas explícitas y trazables (no un modelo entrenado), de modo que
cada decisión del sistema pueda justificarse con la literatura revisada en el OE1.
Cualquier cambio de umbral debe reflejarse en la tabla de criterios de la tesis.
"""

from backend.models.schemas import NivelFatiga

# PERCLOS P80: porcentaje del tiempo con el párpado cerrado al 80 % o más.
# Referencia de uso habitual: Dinges y Grace (1998), FHWA-MCRT-98-006.
PERCLOS_LEVE = 15.0
PERCLOS_MODERADA = 30.0

# Frecuencia de parpadeo espontáneo (SEBR). En reposo ronda 15-20 parpadeos/min y
# frente a pantallas cae hasta un tercio (Tsubota y Nakamori 1993; Chidi-Egboka et al. 2023).
PARPADEOS_MIN_BAJO = 8.0


def clasificar_fatiga(perclos: float, parpadeos_min: float) -> NivelFatiga:
    if perclos >= PERCLOS_MODERADA:
        return "moderada"
    if perclos >= PERCLOS_LEVE or parpadeos_min < PARPADEOS_MIN_BAJO:
        return "leve"
    return "sin_fatiga"
