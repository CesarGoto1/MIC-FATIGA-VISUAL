import random
import uuid

from locust import HttpUser, between, task

API = "/api/v1"


class Estudiante(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        correo = f"carga-{uuid.uuid4().hex[:10]}@example.com"
        respuesta = self.client.post(
            f"{API}/usuarios",
            json={"nombre": "Carga", "correo": correo, "clave": "clave-de-carga-123"},
        )
        self.client.headers["Authorization"] = f"Bearer {respuesta.json()['token_acceso']}"
        self._abrir_sesion()

    def _abrir_sesion(self):
        respuesta = self.client.post(
            f"{API}/sesiones",
            json={
                "actividad": "lectura",
                "momento": random.choice(["pre", "post"]),
                "kss_inicial": random.randint(1, 9),
            },
        )
        self.sesion_id = respuesta.json()["id"]
        self.mediciones = 0

    @task(10)
    def enviar_medicion(self):
        self.client.post(
            f"{API}/sesiones/{self.sesion_id}/mediciones",
            json={
                "ear": round(random.uniform(0.2, 0.32), 3),
                "perclos": round(random.uniform(0, 25), 2),
                "parpadeos_min": round(random.uniform(4, 20), 2),
                "tiempo_cierre": round(random.uniform(80, 400), 1),
                "velocidad_ocular": round(random.uniform(0.1, 1.5), 4),
                "cierres_prolongados": random.randint(0, 3),
                "parpadeos_incompletos_pct": round(random.uniform(0, 60), 1),
            },
            name=f"{API}/sesiones/[id]/mediciones",
        )
        self.mediciones += 1

    @task(1)
    def consultar_historial(self):
        self.client.get(f"{API}/usuarios/yo/sesiones", params={"pagina": 1, "por_pagina": 10})
        self.client.get(f"{API}/usuarios/yo/resumen")

    @task(1)
    def cerrar_y_abrir_sesion(self):
        if self.mediciones < 4:
            return
        self.client.patch(
            f"{API}/sesiones/{self.sesion_id}",
            json={"finalizada": True, "kss_final": random.randint(1, 9)},
            name=f"{API}/sesiones/[id]",
        )
        self._abrir_sesion()
