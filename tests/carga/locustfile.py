import random
import uuid

from locust import HttpUser, between, task


class Estudiante(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        email = f"carga-{uuid.uuid4().hex[:10]}@example.com"
        response = self.client.post(
            "/auth/register",
            json={"nombre": "Carga", "email": email, "password": "clave-de-carga-123"},
        )
        self.client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
        self._abrir_sesion()

    def _abrir_sesion(self):
        response = self.client.post(
            "/sessions",
            json={"actividad": "lectura", "momento": random.choice(["pre", "post"]),
                  "kss_inicial": random.randint(1, 9)},
        )
        self.sesion_id = response.json()["sesion_id"]
        self.mediciones = 0

    @task(10)
    def enviar_metricas(self):
        self.client.post(
            f"/sessions/{self.sesion_id}/metrics",
            json={
                "ear": round(random.uniform(0.2, 0.32), 3),
                "perclos": round(random.uniform(0, 25), 2),
                "parpadeos_min": round(random.uniform(4, 20), 2),
                "tiempo_cierre": round(random.uniform(80, 400), 1),
                "velocidad_ocular": round(random.uniform(0.1, 1.5), 4),
                "cierres_prolongados": random.randint(0, 3),
                "parpadeos_incompletos_pct": round(random.uniform(0, 60), 1),
            },
            name="/sessions/[id]/metrics",
        )
        self.mediciones += 1

    @task(1)
    def consultar_historial(self):
        self.client.get("/users/me/history")

    @task(1)
    def cerrar_y_abrir_sesion(self):
        if self.mediciones < 4:
            return
        self.client.put(f"/sessions/{self.sesion_id}/finish", json={"kss_final": random.randint(1, 9)},
                        name="/sessions/[id]/finish")
        self._abrir_sesion()
