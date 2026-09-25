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
