import pytest

from backend.fatigue import (
    PARPADEOS_MIN_BAJO,
    PERCLOS_LEVE,
    PERCLOS_MODERADA,
    clasificar_fatiga,
)


@pytest.mark.parametrize(
    ("perclos", "parpadeos_min", "esperado"),
    [
        (2.0, 16.0, "sin_fatiga"),
        (PERCLOS_LEVE - 0.01, PARPADEOS_MIN_BAJO, "sin_fatiga"),
        (PERCLOS_LEVE, 16.0, "leve"),
        (5.0, PARPADEOS_MIN_BAJO - 0.01, "leve"),
        (PERCLOS_MODERADA - 0.01, 16.0, "leve"),
        (PERCLOS_MODERADA, 16.0, "moderada"),
        (PERCLOS_MODERADA, 3.0, "moderada"),
    ],
)
def test_clasificar_fatiga_respeta_umbrales(perclos, parpadeos_min, esperado):
    assert clasificar_fatiga(perclos, parpadeos_min) == esperado
