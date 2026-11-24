def todos_los_elementos(cliente, ruta: str, **opciones) -> list[dict]:
    elementos, pagina = [], 1
    while True:
        params = {**opciones.pop("params", {}), "pagina": pagina, "por_pagina": 100}
        respuesta = cliente.get(ruta, params=params, **opciones)
        assert respuesta.status_code == 200, respuesta.text
        cuerpo = respuesta.json()
        elementos += cuerpo["elementos"]
        if pagina >= cuerpo["paginas"]:
            return elementos
        opciones["params"] = params
        pagina += 1


MEDICION_BASE = {
    "ear": 0.28,
    "perclos": 5.0,
    "parpadeos_min": 15.0,
    "tiempo_cierre": 150.0,
    "velocidad_ocular": 0.4,
    "cierres_prolongados": 0,
    "parpadeos_incompletos_pct": 10.0,
}


def parpadeo(tipo: str, inicio_ms: int) -> dict:
    return {
        "tipo": tipo,
        "inicio_ms": inicio_ms,
        "duracion_ms": 650 if tipo == "prolongado" else 180,
        "ocurrido_en": "2026-11-21T15:00:00.250Z",
        "ear_minimo": 0.08,
        "umbral_p80": 0.12,
        "ear_base": 0.3,
    }
