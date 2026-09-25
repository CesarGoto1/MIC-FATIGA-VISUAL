import json
import uuid

from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import sessions as sessions_router

client = TestClient(app)

METRICAS_BASE = {
    "ear": 0.28,
    "perclos": 5.0,
    "parpadeos_min": 15.0,
    "tiempo_cierre": 150.0,
    "velocidad_ocular": 0.4,
    "cierres_prolongados": 0,
}


def _headers() -> dict:
    email = f"test-{uuid.uuid4().hex[:8]}@example.com"
    response = client.post(
        "/auth/register",
        json={"nombre": "Participante", "email": email, "password": "clave-larga-123"},
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _crear_sesion(headers: dict, **extra) -> int:
    body = {"actividad": "lectura", "momento": "pre", "kss_inicial": 3, **extra}
    response = client.post("/sessions", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["sesion_id"]


def test_crear_sesion_exige_momento_y_kss():
    headers = _headers()
    assert client.post("/sessions", json={"actividad": "lectura"}, headers=headers).status_code == 422
    fuera_de_rango = {"actividad": "lectura", "momento": "pre", "kss_inicial": 10}
    assert client.post("/sessions", json=fuera_de_rango, headers=headers).status_code == 422


def test_flujo_completo_de_sesion(monkeypatch):
    payloads = []

    async def falso_diagnostico(sesion_id, payload):
        payloads.append(payload)

    monkeypatch.setattr(sessions_router, "generar_diagnostico", falso_diagnostico)

    headers = _headers()
    sesion_id = _crear_sesion(headers, actividad="video", kss_inicial=2)

    for perclos, parpadeos in [(3.0, 16.0), (4.0, 12.0), (18.0, 6.0), (20.0, 5.0)]:
        response = client.post(
            f"/sessions/{sesion_id}/metrics",
            json={**METRICAS_BASE, "perclos": perclos, "parpadeos_min": parpadeos},
            headers=headers,
        )
        assert response.status_code == 200
    assert response.json()["nivel_fatiga"] == "leve"

    finish = client.put(f"/sessions/{sesion_id}/finish", json={"kss_final": 6}, headers=headers)
    assert finish.status_code == 204

    # El payload hacia la IA debe ser serializable a JSON y no incluir datos del usuario.
    assert len(payloads) == 1
    serializado = json.dumps(payloads[0])
    assert "usuario" not in serializado
    assert payloads[0]["kss"] == {"inicial": 2, "final": 6}
    assert payloads[0]["tramo_inicial"]["perclos"] == 3.0
    assert payloads[0]["tramo_final"]["perclos"] == 20.0
    assert payloads[0]["sesion"]["actividad"] == "video"

    historial = client.get("/users/me/history", headers=headers).json()
    assert historial[0]["kss_inicial"] == 2
    assert historial[0]["kss_final"] == 6
    assert len(historial[0]["mediciones"]) == 4
    assert historial[0]["mediciones"][0]["actividad"] == "video"


def test_no_se_aceptan_metricas_en_sesion_finalizada(monkeypatch):
    headers = _headers()
    sesion_id = _crear_sesion(headers)
    client.put(f"/sessions/{sesion_id}/finish", json={"kss_final": 4}, headers=headers)

    response = client.post(f"/sessions/{sesion_id}/metrics", json=METRICAS_BASE, headers=headers)
    assert response.status_code == 409
    again = client.put(f"/sessions/{sesion_id}/finish", json={"kss_final": 4}, headers=headers)
    assert again.status_code == 409


def test_sesion_de_otro_usuario_devuelve_404():
    sesion_id = _crear_sesion(_headers())
    response = client.post(f"/sessions/{sesion_id}/metrics", json=METRICAS_BASE, headers=_headers())
    assert response.status_code == 404


def _sesion_finalizada_con_mediciones(headers: dict, n_mediciones: int = 2) -> int:
    sesion_id = _crear_sesion(headers)
    for _ in range(n_mediciones):
        client.post(f"/sessions/{sesion_id}/metrics", json=METRICAS_BASE, headers=headers)
    client.put(f"/sessions/{sesion_id}/finish", json={"kss_final": 5}, headers=headers)
    return sesion_id


def _estado(headers: dict, sesion_id: int) -> str:
    historial = client.get("/users/me/history", headers=headers).json()
    return next(s for s in historial if s["id"] == sesion_id)["estado_analisis"]


def _registrar_intento(sesion_id: int, disponible: bool) -> None:
    from backend.database import SessionLocal
    from backend.models.orm import Diagnostico

    db = SessionLocal()
    try:
        texto = "Resumen" if disponible else None
        db.add(Diagnostico(sesion_id=sesion_id, texto=texto, detalle=None, disponible=disponible))
        db.commit()
    finally:
        db.close()


def test_estados_del_analisis(monkeypatch):
    async def sin_respuesta(sesion_id, payload):
        pass

    monkeypatch.setattr(sessions_router, "generar_diagnostico", sin_respuesta)
    headers = _headers()

    abierta = _crear_sesion(headers)
    assert _estado(headers, abierta) == "sin_datos"

    corta = _sesion_finalizada_con_mediciones(headers, n_mediciones=1)
    assert _estado(headers, corta) == "sin_datos"

    sesion_id = _sesion_finalizada_con_mediciones(headers)
    assert _estado(headers, sesion_id) == "pendiente"

    _registrar_intento(sesion_id, disponible=False)
    assert _estado(headers, sesion_id) == "no_disponible"

    _registrar_intento(sesion_id, disponible=True)
    assert _estado(headers, sesion_id) == "disponible"


def test_reintentar_analisis_fallido(monkeypatch):
    payloads = []

    async def falso_diagnostico(sesion_id, payload):
        payloads.append((sesion_id, payload))

    monkeypatch.setattr(sessions_router, "generar_diagnostico", falso_diagnostico)
    headers = _headers()
    sesion_id = _sesion_finalizada_con_mediciones(headers)
    _registrar_intento(sesion_id, disponible=False)
    payloads.clear()

    response = client.post(f"/sessions/{sesion_id}/diagnosis/retry", headers=headers)
    assert response.status_code == 202
    assert len(payloads) == 1
    assert payloads[0][0] == sesion_id
    assert payloads[0][1]["kss"] == {"inicial": 3, "final": 5}


def test_reintento_rechazado_cuando_no_corresponde(monkeypatch):
    async def sin_respuesta(sesion_id, payload):
        pass

    monkeypatch.setattr(sessions_router, "generar_diagnostico", sin_respuesta)
    headers = _headers()

    abierta = _crear_sesion(headers)
    assert client.post(f"/sessions/{abierta}/diagnosis/retry", headers=headers).status_code == 409

    corta = _sesion_finalizada_con_mediciones(headers, n_mediciones=1)
    assert client.post(f"/sessions/{corta}/diagnosis/retry", headers=headers).status_code == 409

    con_analisis = _sesion_finalizada_con_mediciones(headers)
    _registrar_intento(con_analisis, disponible=True)
    assert client.post(f"/sessions/{con_analisis}/diagnosis/retry", headers=headers).status_code == 409

    ajena = _sesion_finalizada_con_mediciones(headers)
    assert client.post(f"/sessions/{ajena}/diagnosis/retry", headers=_headers()).status_code == 404
