import json
from datetime import timedelta

from sqlalchemy import select

from backend.base_datos import crear_sesion_bd
from backend.modelos.orm import Diagnostico, Medicion, Sesion
from backend.servicios.sesiones import INACTIVIDAD_MAXIMA
from tests.datos import MEDICION_BASE


def _estado(cliente, cabeceras: dict, sesion_id: int) -> str:
    historial = cliente.get("/usuarios/yo/sesiones", headers=cabeceras).json()["elementos"]
    return next(s for s in historial if s["id"] == sesion_id)["estado_analisis"]


def _registrar_intento(sesion_id: int, disponible: bool) -> None:
    with crear_sesion_bd() as bd:
        texto = "Resumen" if disponible else None
        bd.add(Diagnostico(sesion_id=sesion_id, texto=texto, detalle=None, disponible=disponible))
        bd.commit()


def _envejecer_sesion(sesion_id: int, minutos: int) -> None:
    desfase = timedelta(minutes=minutos)
    with crear_sesion_bd() as bd:
        sesion = bd.get(Sesion, sesion_id)
        sesion.iniciada_en -= desfase
        for medicion in bd.scalars(select(Medicion).where(Medicion.sesion_id == sesion_id)):
            medicion.registrado_en -= desfase
        bd.commit()


def test_crear_sesion_exige_momento_y_kss(cliente, cabeceras):
    assert cliente.post("/sesiones", json={"actividad": "lectura"}, headers=cabeceras).status_code == 422
    fuera_de_rango = {"actividad": "lectura", "momento": "pre", "kss_inicial": 10}
    assert cliente.post("/sesiones", json=fuera_de_rango, headers=cabeceras).status_code == 422


def test_flujo_completo_de_sesion(cliente, cabeceras, crear_sesion, analisis_solicitados):
    sesion_id = crear_sesion(cabeceras, actividad="video", kss_inicial=2)

    for perclos, parpadeos in [(3.0, 16.0), (4.0, 12.0), (18.0, 6.0), (20.0, 5.0)]:
        respuesta = cliente.post(
            f"/sesiones/{sesion_id}/mediciones",
            json={**MEDICION_BASE, "perclos": perclos, "parpadeos_min": parpadeos},
            headers=cabeceras,
        )
        assert respuesta.status_code == 201
    assert respuesta.json()["nivel_fatiga"] == "leve"

    fin = cliente.patch(f"/sesiones/{sesion_id}", json={"finalizada": True, "kss_final": 6}, headers=cabeceras)
    assert fin.status_code == 204

    assert len(analisis_solicitados) == 1
    _, enviado = analisis_solicitados[0]
    assert "usuario" not in json.dumps(enviado)
    assert enviado["kss"] == {"inicial": 2, "final": 6}
    assert enviado["tramo_inicial"]["perclos"] == 3.0
    assert enviado["tramo_final"]["perclos"] == 20.0
    assert enviado["sesion"]["actividad"] == "video"
    assert enviado["nivel_fatiga_sistema"] == "leve"
    assert enviado["control_somnolencia"] == {"mediciones_con_somnolencia": 2, "tramo_final": True}

    historial = cliente.get("/usuarios/yo/sesiones", headers=cabeceras).json()["elementos"]
    assert historial[0]["kss_inicial"] == 2
    assert historial[0]["kss_final"] == 6
    assert len(historial[0]["mediciones"]) == 4
    assert historial[0]["mediciones"][0]["actividad"] == "video"


def test_no_se_aceptan_mediciones_en_sesion_finalizada(cliente, cabeceras, crear_sesion):
    sesion_id = crear_sesion(cabeceras)
    cliente.patch(f"/sesiones/{sesion_id}", json={"finalizada": True, "kss_final": 4}, headers=cabeceras)

    respuesta = cliente.post(f"/sesiones/{sesion_id}/mediciones", json=MEDICION_BASE, headers=cabeceras)
    assert respuesta.status_code == 409
    otra_vez = cliente.patch(f"/sesiones/{sesion_id}", json={"finalizada": True, "kss_final": 4}, headers=cabeceras)
    assert otra_vez.status_code == 409


def test_sesion_de_otro_usuario_devuelve_404(cliente, registrar, crear_sesion):
    sesion_id = crear_sesion(registrar()[0])
    respuesta = cliente.post(f"/sesiones/{sesion_id}/mediciones", json=MEDICION_BASE, headers=registrar()[0])
    assert respuesta.status_code == 404


def test_estados_del_analisis(cliente, cabeceras, crear_sesion, sesion_finalizada, analisis_solicitados):
    abierta = crear_sesion(cabeceras)
    assert _estado(cliente, cabeceras, abierta) == "sin_datos"

    corta = sesion_finalizada(cabeceras, mediciones=1)
    assert _estado(cliente, cabeceras, corta) == "sin_datos"

    sesion_id = sesion_finalizada(cabeceras)
    assert _estado(cliente, cabeceras, sesion_id) == "pendiente"

    _registrar_intento(sesion_id, disponible=False)
    assert _estado(cliente, cabeceras, sesion_id) == "no_disponible"

    _registrar_intento(sesion_id, disponible=True)
    assert _estado(cliente, cabeceras, sesion_id) == "disponible"


def test_reintentar_analisis_fallido(cliente, cabeceras, sesion_finalizada, analisis_solicitados):
    sesion_id = sesion_finalizada(cabeceras)
    _registrar_intento(sesion_id, disponible=False)
    analisis_solicitados.clear()

    respuesta = cliente.post(f"/sesiones/{sesion_id}/diagnostico", headers=cabeceras)
    assert respuesta.status_code == 202
    assert len(analisis_solicitados) == 1
    assert analisis_solicitados[0][0] == sesion_id
    assert analisis_solicitados[0][1]["kss"] == {"inicial": 3, "final": 5}


def test_reintento_rechazado_cuando_no_corresponde(
    cliente, registrar, crear_sesion, sesion_finalizada, analisis_solicitados
):
    cabeceras = registrar()[0]
    def reintentar(sesion_id: int, cab: dict = cabeceras) -> int:
        return cliente.post(f"/sesiones/{sesion_id}/diagnostico", headers=cab).status_code

    assert reintentar(crear_sesion(cabeceras)) == 409
    assert reintentar(sesion_finalizada(cabeceras, mediciones=1)) == 409

    con_analisis = sesion_finalizada(cabeceras)
    _registrar_intento(con_analisis, disponible=True)
    assert reintentar(con_analisis) == 409

    assert reintentar(sesion_finalizada(cabeceras), registrar()[0]) == 404


def test_sesiones_abandonadas_se_cierran_o_descartan(cliente, cabeceras, crear_sesion, analisis_solicitados):
    vacia = crear_sesion(cabeceras)
    con_datos = crear_sesion(cabeceras)
    for _ in range(2):
        cliente.post(f"/sesiones/{con_datos}/mediciones", json=MEDICION_BASE, headers=cabeceras)
    reciente = crear_sesion(cabeceras)

    minutos = int(INACTIVIDAD_MAXIMA.total_seconds() // 60) + 5
    _envejecer_sesion(vacia, minutos)
    _envejecer_sesion(con_datos, minutos)

    historial = {s["id"]: s for s in cliente.get("/usuarios/yo/sesiones", headers=cabeceras).json()["elementos"]}

    assert vacia not in historial
    assert historial[con_datos]["finalizada_en"] is not None
    assert historial[con_datos]["kss_final"] is None
    assert [sesion_id for sesion_id, _ in analisis_solicitados] == [con_datos]
    assert historial[reciente]["finalizada_en"] is None

    respuesta = cliente.post(f"/sesiones/{con_datos}/mediciones", json=MEDICION_BASE, headers=cabeceras)
    assert respuesta.status_code == 409


def test_parpadeo_con_tipo_invalido_rechaza_la_medicion(cliente, cabeceras, crear_sesion):
    sesion_id = crear_sesion(cabeceras)
    evento = {"tipo": "otro", "inicio_ms": 100, "duracion_ms": 150, "ocurrido_en": "2026-11-21T15:00:00Z"}
    respuesta = cliente.post(
        f"/sesiones/{sesion_id}/mediciones", json={**MEDICION_BASE, "parpadeos": [evento]}, headers=cabeceras
    )
    assert respuesta.status_code == 422


def test_medicion_sin_parpadeos_sigue_siendo_valida(cliente, cabeceras, crear_sesion):
    sesion_id = crear_sesion(cabeceras)
    respuesta = cliente.post(f"/sesiones/{sesion_id}/mediciones", json=MEDICION_BASE, headers=cabeceras)
    assert respuesta.status_code == 201
