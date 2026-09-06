"""Pruebas básicas de los endpoints de autenticación.

Requieren una base de datos de pruebas disponible (por ejemplo, la misma
levantada con `docker compose up -d db`) y las variables de entorno de
.env cargadas. Ejecutar con:

    pytest
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _random_email() -> str:
    return f"test-{uuid.uuid4().hex[:8]}@example.com"


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_register_and_login():
    email = _random_email()
    password = "una-contrasena-larga"

    register_response = client.post(
        "/auth/register",
        json={"nombre": "Usuario de prueba", "email": email, "password": password},
    )
    assert register_response.status_code == 201
    assert "access_token" in register_response.json()

    login_response = client.post("/auth/login", json={"email": email, "password": password})
    assert login_response.status_code == 200
    assert login_response.json()["nombre"] == "Usuario de prueba"


def test_login_wrong_password_returns_401():
    email = _random_email()
    client.post(
        "/auth/register",
        json={"nombre": "Otro usuario", "email": email, "password": "clave-correcta-larga"},
    )

    response = client.post("/auth/login", json={"email": email, "password": "clave-incorrecta"})
    assert response.status_code == 401


def test_protected_endpoint_requires_token():
    response = client.get("/users/me/history")
    assert response.status_code == 401


def test_full_session_flow():
    email = _random_email()
    register_response = client.post(
        "/auth/register",
        json={"nombre": "Flujo completo", "email": email, "password": "clave-larga-123"},
    )
    token = register_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    session_response = client.post("/sessions", json={"actividad": "lectura"}, headers=headers)
    assert session_response.status_code == 201
    sesion_id = session_response.json()["sesion_id"]

    metrics_response = client.post(
        f"/sessions/{sesion_id}/metrics",
        json={"actividad": "lectura", "ear": 0.28, "perclos": 5.0, "parpadeos_min": 15.0},
        headers=headers,
    )
    assert metrics_response.status_code == 200
    assert metrics_response.json()["nivel_fatiga"] == "sin_fatiga"

    finish_response = client.put(f"/sessions/{sesion_id}/finish", headers=headers)
    assert finish_response.status_code == 204

    history_response = client.get("/users/me/history", headers=headers)
    assert history_response.status_code == 200
    assert len(history_response.json()) == 1
    assert len(history_response.json()[0]["mediciones"]) == 1
