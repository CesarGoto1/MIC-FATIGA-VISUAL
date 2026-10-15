import asyncio

import pytest

from backend import diagnosis

PAYLOAD = {"nivel_fatiga_sistema": "leve", "tramo_final": {"perclos": 16.0, "parpadeos_min": 12.0}}

ANALISIS_VALIDO = {
    "resumen_general": "Tus indicadores empeoraron hacia el final de la sesión.",
    "evaluacion_parametros": {"perclos": {"valor_inicial": 3, "valor_final": 16}},
    "nivel_fatiga_final": "Alta",
}


class _RespuestaFalsa:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


def _simular_n8n(monkeypatch, data) -> list[dict]:
    guardados = []

    class _ClienteFalso:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json):
            return _RespuestaFalsa(data)

    monkeypatch.setattr(diagnosis, "N8N_WEBHOOK_URL", "http://n8n.test/webhook")
    monkeypatch.setattr(diagnosis.httpx, "AsyncClient", _ClienteFalso)
    monkeypatch.setattr(
        diagnosis,
        "_guardar_diagnostico",
        lambda sesion_id, texto, detalle, disponible: guardados.append(
            {"texto": texto, "detalle": detalle, "disponible": disponible}
        ),
    )
    return guardados


@pytest.mark.parametrize(
    "data",
    [
        None,
        [],
        {},
        {"resumen_general": "   ", "evaluacion_parametros": {"perclos": {}}},
        {"resumen_general": "Texto", "evaluacion_parametros": {}},
        {"error": "La respuesta de la IA no es JSON valido", "respuesta_cruda": "Hola"},
    ],
)
def test_respuesta_sin_formato_no_es_valida(data):
    assert not diagnosis.es_analisis_valido(data)


def test_respuesta_invalida_se_guarda_como_no_disponible(monkeypatch):
    respuesta = {"error": "La respuesta de la IA no es JSON valido", "respuesta_cruda": "Hola"}
    guardados = _simular_n8n(monkeypatch, respuesta)

    asyncio.run(diagnosis.generar_diagnostico(1, PAYLOAD))

    assert guardados == [{"texto": None, "detalle": respuesta, "disponible": False}]


def test_nivel_final_es_el_del_sistema(monkeypatch):
    guardados = _simular_n8n(monkeypatch, dict(ANALISIS_VALIDO))

    asyncio.run(diagnosis.generar_diagnostico(1, PAYLOAD))

    assert guardados[0]["disponible"] is True
    assert guardados[0]["texto"] == ANALISIS_VALIDO["resumen_general"]
    assert guardados[0]["detalle"]["nivel_fatiga_final"] == "Leve"
