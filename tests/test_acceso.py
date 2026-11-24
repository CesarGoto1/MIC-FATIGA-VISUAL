import uuid


def test_salud(cliente):
    respuesta = cliente.get("/salud")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "ok"}


def test_registro_e_ingreso(cliente):
    correo = f"Ana.{uuid.uuid4().hex[:8]}@Example.com"
    datos = {"nombre": "Usuario de prueba", "correo": correo, "clave": "una-contrasena-larga"}

    registro = cliente.post("/usuarios", json=datos)
    assert registro.status_code == 201
    assert "token_acceso" in registro.json()

    ingreso = cliente.post("/tokens", json={"correo": correo.lower(), "clave": datos["clave"]})
    assert ingreso.status_code == 201
    assert ingreso.json()["nombre"] == "Usuario de prueba"


def test_correo_no_distingue_mayusculas(cliente, registrar):
    _, datos = registrar()
    duplicado = cliente.post(
        "/usuarios",
        json={"nombre": "Otro", "correo": datos["correo"].upper(), "clave": "otra-clave-larga"},
    )
    assert duplicado.status_code == 409


def test_clave_incorrecta_devuelve_401(cliente, registrar):
    _, datos = registrar()
    respuesta = cliente.post("/tokens", json={"correo": datos["correo"], "clave": "clave-incorrecta"})
    assert respuesta.status_code == 401


def test_clave_de_mas_de_72_bytes_se_rechaza_sin_error_500(cliente):
    larga = "ñ" * 40
    registro = cliente.post(
        "/usuarios", json={"nombre": "Larga", "correo": "larga@example.com", "clave": larga}
    )
    assert registro.status_code == 422
    ingreso = cliente.post("/tokens", json={"correo": "larga@example.com", "clave": larga})
    assert ingreso.status_code == 422


def test_ruta_protegida_exige_token(cliente):
    assert cliente.get("/usuarios/yo/sesiones").status_code == 401


def test_nombre_y_correo_respetan_largo_maximo(cliente):
    largo = cliente.post(
        "/usuarios", json={"nombre": "N" * 101, "correo": "nombre@example.com", "clave": "clave-segura-1"}
    )
    assert largo.status_code == 422
    correo = "c" * 140 + "@example.com"
    assert cliente.post(
        "/usuarios", json={"nombre": "Correo", "correo": correo, "clave": "clave-segura-1"}
    ).status_code == 422
