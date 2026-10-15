import pytest

from backend.fatigue import (
    CIERRES_PROLONGADOS_SOMNOLENCIA,
    INCOMPLETOS_PCT_ALTO,
    PARPADEOS_MIN_BAJO,
    PERCLOS_SOMNOLENCIA,
    clasificar_fatiga,
    clasificar_tramo,
    detectar_somnolencia,
)


@pytest.mark.parametrize(
    ("parpadeos_min", "incompletos_pct", "esperado"),
    [
        (16.0, 10.0, "sin_fatiga"),
        (PARPADEOS_MIN_BAJO, INCOMPLETOS_PCT_ALTO - 0.01, "sin_fatiga"),
        (PARPADEOS_MIN_BAJO - 0.01, 10.0, "leve"),
        (16.0, INCOMPLETOS_PCT_ALTO, "leve"),
        (PARPADEOS_MIN_BAJO - 0.01, INCOMPLETOS_PCT_ALTO, "moderada"),
        (0.0, None, "leve"),
        (16.0, None, "sin_fatiga"),
    ],
)
def test_clasificar_fatiga_usa_signos_de_cvs(parpadeos_min, incompletos_pct, esperado):
    assert clasificar_fatiga(parpadeos_min, incompletos_pct) == esperado


@pytest.mark.parametrize(
    ("perclos", "cierres", "esperado"),
    [
        (5.0, 0, False),
        (PERCLOS_SOMNOLENCIA, 0, True),
        (5.0, CIERRES_PROLONGADOS_SOMNOLENCIA, True),
        (None, None, False),
    ],
)
def test_somnolencia_es_un_control_aparte(perclos, cierres, esperado):
    assert detectar_somnolencia(perclos, cierres) is esperado


def test_perclos_alto_no_cambia_el_nivel_de_fatiga_visual():
    promedios = {"perclos": 40.0, "cierres_prolongados": 5, "parpadeos_min": 16.0, "parpadeos_incompletos_pct": 10.0}
    assert clasificar_tramo(promedios) == "sin_fatiga"


def test_clasificar_tramo_usa_la_misma_regla():
    assert clasificar_tramo({"parpadeos_min": 5.0, "parpadeos_incompletos_pct": 50.0}) == "moderada"
    assert clasificar_tramo({"parpadeos_min": None, "parpadeos_incompletos_pct": 50.0}) is None
