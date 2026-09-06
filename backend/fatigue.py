"""Clasificación del nivel de fatiga a partir de las métricas oculares.

Los umbrales de abajo son un punto de partida razonable tomado de la
literatura revisada en la RSL (Abdulkader et al., 2023), pero DEBEN
calibrarse con los datos del propio grupo focal (Objetivo específico 4
del perfil aprobado) antes de considerarse definitivos. Idealmente,
PERCLOS/parpadeo deberían compararse contra la línea base personalizada
de EAR del usuario (AEAR, Gupta et al. 2023) en lugar de un umbral fijo
igual para todos — este módulo es el lugar natural para esa mejora.
"""

from backend.models.schemas import NivelFatiga

PERCLOS_LEVE = 15.0       # % de tiempo con el ojo cerrado
PERCLOS_MODERADA = 30.0

PARPADEOS_MIN_BAJO = 8.0  # parpadeos/min por debajo de lo normal en pantalla


def clasificar_fatiga(perclos: float, parpadeos_min: float) -> NivelFatiga:
    if perclos >= PERCLOS_MODERADA:
        return "moderada"
    if perclos >= PERCLOS_LEVE or parpadeos_min < PARPADEOS_MIN_BAJO:
        return "leve"
    return "sin_fatiga"
