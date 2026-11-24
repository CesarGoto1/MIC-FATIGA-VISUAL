import csv
import io
import subprocess
import uuid

import pytest

from backend.base_datos import crear_sesion_bd
from backend.modelos.orm import Usuario
from backend.scripts.crear_admin import promover
from tests.conftest import CLAVE
from tests.datos import MEDICION_BASE, parpadeo, todos_los_elementos


def _filas_csv(respuesta) -> list[dict]:
    return list(csv.DictReader(io.StringIO(respuesta.content.decode("utf-8-sig"))))


def test_no_admin_recibe_403(cliente, cabeceras):
    for ruta in (
        "/admin/participantes",
        "/admin/sesiones",
        "/admin/sesiones/1",
        "/admin/exportaciones/sesiones.csv",
        "/admin/exportaciones/mediciones.csv",
        "/admin/exportaciones/parpadeos.csv",
        "/admin/sesiones/1/parpadeos",
        "/admin/sesiones/1/grabacion",
    ):
        assert cliente.get(ruta, headers=cabeceras).status_code == 403
    assert cliente.get("/admin/participantes").status_code == 401


def test_ingreso_y_perfil_incluyen_rol_y_codigo(cliente, registrar):
    cabeceras, datos = registrar()
    assert datos["es_admin"] is False
    assert datos["codigo_participante"] == f"P{datos['usuario_id']:03d}"

    promover(datos["correo"])
    ingreso = cliente.post("/tokens", json={"correo": datos["correo"], "clave": CLAVE})
    assert ingreso.json()["es_admin"] is True

    perfil = cliente.get("/usuarios/yo", headers=cabeceras).json()
    assert perfil["es_admin"] is True
    assert perfil["codigo_participante"] == datos["codigo_participante"]


def test_promover_correo_inexistente():
    assert promover(f"nadie-{uuid.uuid4().hex[:8]}@example.com") is False


def test_rol_admin_por_defecto_es_falso(registrar):
    _, datos = registrar()
    with crear_sesion_bd() as bd:
        assert bd.get(Usuario, datos["usuario_id"]).es_admin is False


def test_listado_de_participantes(cliente, analisis_solicitados, cabeceras_admin, registrar, sesion_finalizada):
    cabeceras, datos = registrar()
    for momento in ("pre", "pre", "post"):
        sesion_finalizada(cabeceras, momento=momento)

    participantes = todos_los_elementos(cliente, "/admin/participantes", headers=cabeceras_admin)
    fila = next(p for p in participantes if p["codigo"] == datos["codigo_participante"])
    assert (fila["sesiones"], fila["sesiones_pre"], fila["sesiones_post"]) == (3, 2, 1)
    assert fila["ultima_sesion"] is not None
    claves = {"codigo", "sesiones", "sesiones_pre", "sesiones_post", "ultima_sesion", "grabacion_habilitada"}
    assert all(set(p) == claves for p in participantes)


def test_filtros_y_detalle_de_sesiones(cliente, analisis_solicitados, cabeceras_admin, registrar, sesion_finalizada):
    cabeceras, datos = registrar()
    codigo = datos["codigo_participante"]
    pre = sesion_finalizada(cabeceras, mediciones=3, kss_final=6, momento="pre")
    post = sesion_finalizada(cabeceras, kss_final=6, momento="post")

    def sesiones(**filtros):
        return cliente.get("/admin/sesiones", params={"participante": codigo, **filtros}, headers=cabeceras_admin)

    assert {s["id"] for s in sesiones().json()["elementos"]} == {pre, post}
    solo_post = sesiones(momento="post").json()["elementos"]
    assert [s["id"] for s in solo_post] == [post]
    assert solo_post[0]["participante"] == codigo
    assert solo_post[0]["kss_final"] == 6
    assert solo_post[0]["nivel_fatiga_tramo_final"] == "sin_fatiga"
    assert solo_post[0]["estado_analisis"] == "pendiente"
    assert sesiones(desde="2999-01-01").json()["elementos"] == []
    assert sesiones(hasta="2000-01-01").json()["elementos"] == []
    assert sesiones(participante="XYZ").status_code == 422

    detalle = cliente.get(f"/admin/sesiones/{pre}", headers=cabeceras_admin).json()
    assert detalle["num_mediciones"] == 3
    assert len(detalle["mediciones"]) == 3
    assert detalle["diagnostico"]["disponible"] is False
    assert cliente.get("/admin/sesiones/999999999", headers=cabeceras_admin).status_code == 404


def test_csv_sin_datos_personales(cliente, analisis_solicitados, cabeceras_admin, registrar, sesion_finalizada):
    nombre = f"Nombre-{uuid.uuid4().hex[:6]}"
    cabeceras, datos = registrar(nombre)
    codigo = datos["codigo_participante"]
    sesion_id = sesion_finalizada(cabeceras)

    for ruta, filas_esperadas in (("/admin/exportaciones/sesiones.csv", 1), ("/admin/exportaciones/mediciones.csv", 2)):
        respuesta = cliente.get(ruta, params={"participante": codigo}, headers=cabeceras_admin)
        assert respuesta.status_code == 200
        assert respuesta.headers["content-type"].startswith("text/csv")
        assert respuesta.content.startswith(b"\xef\xbb\xbf")
        texto = respuesta.content.decode("utf-8-sig")
        assert "@" not in texto
        assert nombre not in texto

        filas = _filas_csv(respuesta)
        assert len(filas) == filas_esperadas
        assert all(f["participante"] == codigo for f in filas)
        assert all(f["sesion_id"] == str(sesion_id) for f in filas)

    completo = cliente.get("/admin/exportaciones/sesiones.csv", headers=cabeceras_admin)
    assert "@" not in completo.content.decode("utf-8-sig")


def test_conteo_y_exportacion_de_parpadeos(
    cliente, analisis_solicitados, cabeceras_admin, registrar, crear_sesion, sesion_finalizada
):
    cabeceras, datos = registrar()
    codigo = datos["codigo_participante"]
    sesion_id = crear_sesion(cabeceras)
    minutos = [
        [parpadeo("completo", 61_000), parpadeo("incompleto", 1_500), parpadeo("completo", 30_000)],
        [parpadeo("prolongado", 90_000), parpadeo("incompleto", 75_000)],
    ]
    for eventos in minutos:
        respuesta = cliente.post(
            f"/sesiones/{sesion_id}/mediciones", json={**MEDICION_BASE, "parpadeos": eventos}, headers=cabeceras
        )
        assert respuesta.status_code == 201, respuesta.text
    cliente.patch(f"/sesiones/{sesion_id}", json={"finalizada": True, "kss_final": 6}, headers=cabeceras)
    otra = sesion_finalizada(cabeceras, momento="post")

    listado = cliente.get("/admin/sesiones", params={"participante": codigo}, headers=cabeceras_admin).json()["elementos"]
    fila = next(s for s in listado if s["id"] == sesion_id)
    conteos = (fila["parpadeos_completos"], fila["parpadeos_incompletos"], fila["cierres_prolongados_total"])
    assert conteos == (2, 2, 1)
    assert next(s for s in listado if s["id"] == otra)["parpadeos_completos"] == 0

    detalle = cliente.get(f"/admin/sesiones/{sesion_id}", headers=cabeceras_admin).json()
    assert detalle["parpadeos_incompletos"] == 2

    sesiones_csv = cliente.get("/admin/exportaciones/sesiones.csv", params={"participante": codigo}, headers=cabeceras_admin)
    filas_sesion = {f["sesion_id"]: f for f in _filas_csv(sesiones_csv)}
    assert filas_sesion[str(sesion_id)]["parpadeos_completos"] == "2"

    respuesta = cliente.get("/admin/exportaciones/parpadeos.csv", params={"sesion_id": sesion_id}, headers=cabeceras_admin)
    assert respuesta.status_code == 200
    assert 'filename="parpadeos_sesion_' in respuesta.headers["content-disposition"]
    filas = _filas_csv(respuesta)
    assert [f["inicio_ms"] for f in filas] == ["1500", "30000", "61000", "75000", "90000"]
    assert [f["n"] for f in filas] == ["1", "2", "3", "4", "5"]
    assert [f["tipo"] for f in filas] == ["incompleto", "completo", "completo", "incompleto", "prolongado"]
    assert filas[0]["inicio_s"] == "1.5"
    assert filas[0]["participante"] == codigo
    assert ".250" in filas[0]["ocurrido_en"]

    por_participante = cliente.get(
        "/admin/exportaciones/parpadeos.csv", params={"participante": codigo}, headers=cabeceras_admin
    )
    assert len(_filas_csv(por_participante)) == 5
    inexistente = cliente.get("/admin/exportaciones/parpadeos.csv", params={"sesion_id": 999999999}, headers=cabeceras_admin)
    assert inexistente.status_code == 404


def test_lista_de_parpadeos_de_una_sesion(cliente, analisis_solicitados, cabeceras_admin, cabeceras, crear_sesion):
    sesion_id = crear_sesion(cabeceras)
    eventos = [parpadeo("incompleto", 9_000), parpadeo("completo", 2_000)]
    cliente.post(f"/sesiones/{sesion_id}/mediciones", json={**MEDICION_BASE, "parpadeos": eventos}, headers=cabeceras)

    lista = cliente.get(f"/admin/sesiones/{sesion_id}/parpadeos", headers=cabeceras_admin).json()["elementos"]
    assert [p["inicio_ms"] for p in lista] == [2_000, 9_000]
    assert lista[0]["tipo"] == "completo"
    assert cliente.get("/admin/sesiones/999999999/parpadeos", headers=cabeceras_admin).status_code == 404


@pytest.fixture
def subir_parte(cliente):
    def _subir(cabeceras: dict, sesion_id: int, parte: int, datos: bytes, tipo_mime: str = "video/webm;codecs=vp9"):
        return cliente.put(
            f"/sesiones/{sesion_id}/grabacion/partes/{parte}",
            params={"desfase_ms": 40, "tipo_mime": tipo_mime},
            content=datos,
            headers={**cabeceras, "Content-Type": "application/octet-stream"},
        )

    return _subir


def test_grabacion_habilitada_desde_admin(
    cliente, analisis_solicitados, cabeceras_admin, registrar, crear_sesion, subir_parte, tmp_path
):
    cabeceras, datos = registrar()
    codigo = datos["codigo_participante"]
    nueva = {"actividad": "lectura", "momento": "pre", "kss_inicial": 3, "grabar": True}

    sin_permiso = cliente.post("/sesiones", json=nueva, headers=cabeceras).json()
    assert sin_permiso["grabar"] is False
    assert subir_parte(cabeceras, sin_permiso["id"], 0, b"x").status_code == 403

    ruta_permiso = f"/admin/participantes/{codigo}"
    cambio = cliente.patch(ruta_permiso, json={"grabacion_habilitada": True}, headers=cabeceras_admin)
    assert cambio.status_code == 200
    assert cambio.json()["grabacion_habilitada"] is True
    assert cliente.get("/usuarios/yo", headers=cabeceras).json()["grabacion_habilitada"] is True
    assert cliente.patch(ruta_permiso, json={"grabacion_habilitada": True}, headers=cabeceras).status_code == 403

    rechazada = cliente.post("/sesiones", json={**nueva, "grabar": False}, headers=cabeceras).json()
    assert rechazada["grabar"] is False
    assert subir_parte(cabeceras, rechazada["id"], 0, b"x").status_code == 403

    sesion_id = crear_sesion(cabeceras, grabar=True)
    assert subir_parte(cabeceras, sesion_id, 1, b"fuera").status_code == 409
    assert subir_parte(cabeceras, sesion_id, 0, b"uno-", tipo_mime="video/ogg").status_code == 422
    assert subir_parte(cabeceras, sesion_id, 0, b"").status_code == 422
    assert subir_parte(cabeceras, sesion_id, 0, b"uno-").json() == {"partes": 1, "bytes": 4}
    assert subir_parte(cabeceras, sesion_id, 0, b"uno-").json() == {"partes": 1, "bytes": 4}
    assert subir_parte(cabeceras, sesion_id, 1, b"dos").json() == {"partes": 2, "bytes": 7}
    assert subir_parte(cabeceras, sesion_id, 3, b"x").status_code == 409

    for _ in range(2):
        cliente.post(f"/sesiones/{sesion_id}/mediciones", json=MEDICION_BASE, headers=cabeceras)
    cliente.patch(f"/sesiones/{sesion_id}", json={"finalizada": True, "kss_final": 6}, headers=cabeceras)
    assert subir_parte(cabeceras, sesion_id, 2, b"tarde").status_code == 409

    listado = cliente.get("/admin/sesiones", params={"participante": codigo}, headers=cabeceras_admin).json()["elementos"]
    fila = next(s for s in listado if s["id"] == sesion_id)
    assert fila["tiene_grabacion"] is True
    assert fila["grabacion_consentida"] is True
    grabacion = cliente.get(f"/admin/sesiones/{sesion_id}", headers=cabeceras_admin).json()["grabacion"]
    assert grabacion["tipo_mime"] == "video/webm"
    assert grabacion["desfase_ms"] == 40

    ruta_video = f"/admin/sesiones/{sesion_id}/grabacion"
    video = cliente.get(ruta_video, headers=cabeceras_admin)
    assert video.status_code == 200
    assert video.content == b"uno-dos"
    assert video.headers["content-type"].startswith("video/webm")
    archivo = tmp_path / f"sesion_{sesion_id}.webm"
    assert archivo.exists()

    assert cliente.delete(ruta_video, headers=cabeceras_admin).status_code == 204
    assert not archivo.exists()
    assert cliente.get(ruta_video, headers=cabeceras_admin).status_code == 404
    assert cliente.delete(ruta_video, headers=cabeceras_admin).status_code == 404
    assert cliente.get(f"/admin/sesiones/{sesion_id}", headers=cabeceras_admin).json()["grabacion"] is None


def test_grabacion_se_entrega_como_mp4_reproducible(
    cliente, analisis_solicitados, cabeceras_admin, registrar, crear_sesion, subir_parte, tmp_path
):
    imageio_ffmpeg = pytest.importorskip("imageio_ffmpeg")
    webm = tmp_path / "entrada.webm"
    subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25",
         "-t", "2", "-c:v", "libvpx", str(webm)],
        check=True,
    )
    cabeceras, datos = registrar()
    cliente.patch(
        f"/admin/participantes/{datos['codigo_participante']}", json={"grabacion_habilitada": True}, headers=cabeceras_admin
    )
    sesion_id = crear_sesion(cabeceras, grabar=True)
    assert subir_parte(cabeceras, sesion_id, 0, webm.read_bytes(), tipo_mime="video/webm;codecs=vp8").status_code == 200

    ruta_video = f"/admin/sesiones/{sesion_id}/grabacion"
    video = cliente.get(ruta_video, headers=cabeceras_admin)
    assert video.status_code == 200
    assert video.headers["content-type"] == "video/mp4"
    assert f'sesion_{sesion_id}.mp4' in video.headers["content-disposition"]
    assert video.content[4:8] == b"ftyp"
    vista = tmp_path / f"sesion_{sesion_id}.vista.mp4"
    assert vista.exists()

    assert cliente.delete(ruta_video, headers=cabeceras_admin).status_code == 204
    assert not vista.exists()
    assert not (tmp_path / f"sesion_{sesion_id}.webm").exists()
