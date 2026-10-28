import csv
import io
import uuid

from fastapi.testclient import TestClient

from backend.database import SessionLocal
from backend.main import app
from backend.models.orm import Usuario
from backend.routers import sessions as sessions_router
from backend.scripts.crear_admin import promover

client = TestClient(app)

METRICAS_BASE = {
    "ear": 0.28,
    "perclos": 5.0,
    "parpadeos_min": 15.0,
    "tiempo_cierre": 150.0,
    "velocidad_ocular": 0.4,
    "cierres_prolongados": 0,
    "parpadeos_incompletos_pct": 10.0,
}


def _registrar(nombre: str = "Participante Secreto") -> tuple[dict, dict]:
    email = f"test-{uuid.uuid4().hex[:8]}@example.com"
    response = client.post(
        "/auth/register",
        json={"nombre": nombre, "email": email, "password": "clave-larga-123"},
    )
    assert response.status_code == 201, response.text
    data = response.json()
    return {"Authorization": f"Bearer {data['access_token']}"}, {**data, "email": email}


def _admin_headers() -> dict:
    headers, datos = _registrar("Administrador")
    assert promover(datos["email"])
    return headers


def _sesion_con_mediciones(headers: dict, momento: str, n: int = 2) -> int:
    response = client.post(
        "/sessions", json={"actividad": "lectura", "momento": momento, "kss_inicial": 3}, headers=headers
    )
    sesion_id = response.json()["sesion_id"]
    for _ in range(n):
        client.post(f"/sessions/{sesion_id}/metrics", json=METRICAS_BASE, headers=headers)
    client.put(f"/sessions/{sesion_id}/finish", json={"kss_final": 6}, headers=headers)
    return sesion_id


def _sin_diagnostico(monkeypatch):
    async def sin_respuesta(sesion_id, payload):
        pass

    monkeypatch.setattr(sessions_router, "generar_diagnostico", sin_respuesta)


def test_no_admin_recibe_403():
    headers, _ = _registrar()
    for ruta in (
        "/admin/participantes",
        "/admin/sesiones",
        "/admin/sesiones/1",
        "/admin/export/sesiones.csv",
        "/admin/export/mediciones.csv",
    ):
        assert client.get(ruta, headers=headers).status_code == 403
    assert client.get("/admin/participantes").status_code == 401


def test_login_y_perfil_incluyen_rol_y_codigo():
    headers, datos = _registrar()
    assert datos["es_admin"] is False
    assert datos["codigo_participante"] == f"P{datos['usuario_id']:03d}"

    promover(datos["email"])
    login = client.post("/auth/login", json={"email": datos["email"], "password": "clave-larga-123"})
    assert login.json()["es_admin"] is True

    perfil = client.get("/users/me", headers=headers).json()
    assert perfil["es_admin"] is True
    assert perfil["codigo_participante"] == datos["codigo_participante"]


def test_promover_correo_inexistente():
    assert promover(f"nadie-{uuid.uuid4().hex[:8]}@example.com") is False


def test_listado_de_participantes(monkeypatch):
    _sin_diagnostico(monkeypatch)
    admin = _admin_headers()
    headers, datos = _registrar()
    _sesion_con_mediciones(headers, "pre")
    _sesion_con_mediciones(headers, "pre")
    _sesion_con_mediciones(headers, "post")

    participantes = client.get("/admin/participantes", headers=admin).json()
    fila = next(p for p in participantes if p["codigo"] == datos["codigo_participante"])
    assert fila["sesiones"] == 3
    assert fila["sesiones_pre"] == 2
    assert fila["sesiones_post"] == 1
    assert fila["ultima_sesion"] is not None
    assert all(set(p) == {"codigo", "sesiones", "sesiones_pre", "sesiones_post", "ultima_sesion"} for p in participantes)


def test_filtros_y_detalle_de_sesiones(monkeypatch):
    _sin_diagnostico(monkeypatch)
    admin = _admin_headers()
    headers, datos = _registrar()
    codigo = datos["codigo_participante"]
    pre = _sesion_con_mediciones(headers, "pre", n=3)
    post = _sesion_con_mediciones(headers, "post")

    todas = client.get("/admin/sesiones", params={"participante": codigo}, headers=admin).json()
    assert {s["id"] for s in todas} == {pre, post}

    solo_post = client.get(
        "/admin/sesiones", params={"participante": codigo, "momento": "post"}, headers=admin
    ).json()
    assert [s["id"] for s in solo_post] == [post]
    assert solo_post[0]["participante"] == codigo
    assert solo_post[0]["kss_final"] == 6
    assert solo_post[0]["nivel_fatiga_tramo_final"] == "sin_fatiga"
    assert solo_post[0]["estado_analisis"] == "pendiente"

    futuro = client.get(
        "/admin/sesiones", params={"participante": codigo, "desde": "2999-01-01"}, headers=admin
    ).json()
    assert futuro == []
    pasado = client.get(
        "/admin/sesiones", params={"participante": codigo, "hasta": "2000-01-01"}, headers=admin
    ).json()
    assert pasado == []

    invalido = client.get("/admin/sesiones", params={"participante": "XYZ"}, headers=admin)
    assert invalido.status_code == 422

    detalle = client.get(f"/admin/sesiones/{pre}", headers=admin).json()
    assert detalle["num_mediciones"] == 3
    assert len(detalle["mediciones"]) == 3
    assert detalle["diagnostico"]["disponible"] is False
    assert client.get("/admin/sesiones/999999999", headers=admin).status_code == 404


def test_csv_sin_datos_personales(monkeypatch):
    _sin_diagnostico(monkeypatch)
    admin = _admin_headers()
    nombre = f"Nombre-{uuid.uuid4().hex[:6]}"
    headers, datos = _registrar(nombre)
    codigo = datos["codigo_participante"]
    sesion_id = _sesion_con_mediciones(headers, "pre", n=2)

    for ruta, filas_esperadas in (("/admin/export/sesiones.csv", 1), ("/admin/export/mediciones.csv", 2)):
        response = client.get(ruta, params={"participante": codigo}, headers=admin)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert response.content.startswith(b"\xef\xbb\xbf")
        texto = response.content.decode("utf-8-sig")
        assert datos["email"] not in texto
        assert "@" not in texto
        assert nombre not in texto

        filas = list(csv.DictReader(io.StringIO(texto)))
        assert len(filas) == filas_esperadas
        assert all(f["participante"] == codigo for f in filas)
        assert all(f["sesion_id"] == str(sesion_id) for f in filas)

    completo = client.get("/admin/export/sesiones.csv", headers=admin).content.decode("utf-8-sig")
    assert "@" not in completo


def test_rol_admin_por_defecto_es_falso():
    _, datos = _registrar()
    db = SessionLocal()
    try:
        assert db.get(Usuario, datos["usuario_id"]).es_admin is False
    finally:
        db.close()
