from tests.datos import MEDICION_BASE


def test_rutas_sin_version_no_existen(cliente):
    respuesta = cliente.get("http://testserver/sesiones")
    assert respuesta.status_code == 404
    assert respuesta.json() == {"error": {"codigo": "no_encontrado", "mensaje": "El recurso solicitado no existe."}}
    assert cliente.delete("/salud").json()["error"]["codigo"] == "metodo_no_permitido"


def test_errores_tienen_formato_uniforme(cliente, cabeceras):
    no_autenticado = cliente.get("/usuarios/yo")
    assert no_autenticado.status_code == 401
    assert no_autenticado.headers["www-authenticate"] == "Bearer"
    assert no_autenticado.json()["error"]["codigo"] == "no_autenticado"

    invalido = cliente.post("/sesiones", json={"actividad": "otra"}, headers=cabeceras)
    assert invalido.status_code == 422
    error = invalido.json()["error"]
    assert error["codigo"] == "datos_invalidos"
    assert error["mensaje"] == "Los datos enviados no son válidos."
    assert {d["campo"] for d in error["detalles"]} == {"actividad", "momento", "kss_inicial"}
    assert all(d["ubicacion"] == "cuerpo" for d in error["detalles"])

    inexistente = cliente.get("/sesiones/999999999", headers=cabeceras)
    assert inexistente.json() == {
        "error": {"codigo": "no_encontrado", "mensaje": "La sesión no existe o no pertenece a este usuario."}
    }


def test_crear_sesion_devuelve_location(cliente, cabeceras):
    cuerpo = {"actividad": "lectura", "momento": "pre", "kss_inicial": 3}
    respuesta = cliente.post("/sesiones", json=cuerpo, headers=cabeceras)
    assert respuesta.status_code == 201
    ubicacion = respuesta.headers["location"]
    assert ubicacion.endswith(f"/api/v1/sesiones/{respuesta.json()['id']}")

    sesion = cliente.get(ubicacion, headers=cabeceras)
    assert sesion.status_code == 200
    assert sesion.json()["id"] == respuesta.json()["id"]
    assert sesion.json()["mediciones"] == []


def test_finalizar_exige_marca_de_finalizada(cliente, cabeceras, crear_sesion):
    sesion_id = crear_sesion(cabeceras)
    sin_marca = cliente.patch(f"/sesiones/{sesion_id}", json={"kss_final": 5}, headers=cabeceras)
    assert sin_marca.status_code == 422


def test_historial_paginado(cliente, cabeceras, crear_sesion):
    creadas = [crear_sesion(cabeceras) for _ in range(5)]

    primera = cliente.get("/usuarios/yo/sesiones", params={"por_pagina": 2}, headers=cabeceras).json()
    assert (primera["total"], primera["pagina"], primera["por_pagina"], primera["paginas"]) == (5, 1, 2, 3)
    assert [s["id"] for s in primera["elementos"]] == creadas[::-1][:2]

    ultima = cliente.get("/usuarios/yo/sesiones", params={"pagina": 3, "por_pagina": 2}, headers=cabeceras).json()
    assert [s["id"] for s in ultima["elementos"]] == [creadas[0]]

    vacia = cliente.get("/usuarios/yo/sesiones", params={"pagina": 9, "por_pagina": 2}, headers=cabeceras).json()
    assert vacia["elementos"] == []
    assert vacia["total"] == 5

    for invalidos in ({"pagina": 0}, {"por_pagina": 0}, {"por_pagina": 101}):
        respuesta = cliente.get("/usuarios/yo/sesiones", params=invalidos, headers=cabeceras)
        assert respuesta.status_code == 422
        assert respuesta.json()["error"]["detalles"][0]["ubicacion"] == "consulta"


def test_resumen_del_usuario(cliente, cabeceras, crear_sesion, sesion_finalizada, analisis_solicitados):
    vacio = cliente.get("/usuarios/yo/resumen", headers=cabeceras).json()
    assert vacio == {
        "total_sesiones": 0,
        "sesiones_semana": 0,
        "sesiones_con_fatiga": 0,
        "ultima_sesion": None,
        "pre": None,
        "post": None,
    }

    sesion_finalizada(cabeceras, momento="pre", kss_inicial=2)
    sesion_finalizada(cabeceras, momento="pre", kss_inicial=4)
    post = crear_sesion(cabeceras, momento="post", kss_inicial=7)
    cliente.post(
        f"/sesiones/{post}/mediciones",
        json={**MEDICION_BASE, "parpadeos_min": 5.0, "parpadeos_incompletos_pct": 50.0},
        headers=cabeceras,
    )
    crear_sesion(cabeceras, momento="post", kss_inicial=9)

    resumen = cliente.get("/usuarios/yo/resumen", headers=cabeceras).json()
    assert resumen["total_sesiones"] == 4
    assert resumen["sesiones_semana"] == 4
    assert resumen["sesiones_con_fatiga"] == 1
    assert resumen["ultima_sesion"] is not None
    assert resumen["pre"] == {
        "sesiones": 2,
        "kss": 3.0,
        "parpadeos_min": 15.0,
        "parpadeos_incompletos_pct": 10.0,
        "tiempo_cierre": 150.0,
    }
    assert resumen["post"]["sesiones"] == 1
    assert resumen["post"]["kss"] == 7.0
    assert resumen["post"]["parpadeos_min"] == 5.0


def test_listados_admin_paginados(cliente, cabeceras_admin, registrar, sesion_finalizada, analisis_solicitados):
    cabeceras, datos = registrar()
    for _ in range(3):
        sesion_finalizada(cabeceras)

    pagina = cliente.get(
        "/admin/sesiones",
        params={"participante": datos["codigo_participante"], "por_pagina": 2},
        headers=cabeceras_admin,
    ).json()
    assert (pagina["total"], pagina["paginas"], len(pagina["elementos"])) == (3, 2, 2)

    participantes = cliente.get("/admin/participantes", params={"por_pagina": 1}, headers=cabeceras_admin).json()
    assert len(participantes["elementos"]) == 1
    assert participantes["total"] >= 2
