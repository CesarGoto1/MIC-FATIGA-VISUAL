from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

NivelFatiga = Literal["sin_fatiga", "leve", "moderada"]
MomentoJornada = Literal["pre", "post"]
Actividad = Literal["lectura", "video", "libre"]
# disponible: hay análisis | pendiente: se está generando | no_disponible: el intento falló
# (se puede reintentar) | sin_datos: la sesión no permite análisis (abierta o < 2 mediciones).
EstadoAnalisis = Literal["disponible", "pendiente", "no_disponible", "sin_datos"]

# Karolinska Sleepiness Scale (Åkerstedt y Gillberg 1990): 1 = extremadamente alerta,
# 9 = muy somnoliento, luchando contra el sueño.
KSS_MIN = 1
KSS_MAX = 9


class RegisterRequest(BaseModel):
    nombre: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario_id: int
    nombre: str


class SessionCreateRequest(BaseModel):
    actividad: Actividad
    momento: MomentoJornada
    kss_inicial: int = Field(ge=KSS_MIN, le=KSS_MAX, description="KSS reportada al iniciar")


class SessionCreateResponse(BaseModel):
    sesion_id: int
    actividad: str
    momento: MomentoJornada
    kss_inicial: int


class SessionFinishRequest(BaseModel):
    kss_final: int = Field(ge=KSS_MIN, le=KSS_MAX, description="KSS reportada al finalizar")


class MetricsInRequest(BaseModel):
    ear: float = Field(ge=0, le=1, description="Eye Aspect Ratio promedio del intervalo")
    perclos: float = Field(ge=0, le=100, description="PERCLOS P80 en porcentaje")
    parpadeos_min: float = Field(ge=0, description="Frecuencia de parpadeo por minuto")
    tiempo_cierre: float = Field(ge=0, description="Duración promedio de cierre ocular en ms")
    velocidad_ocular: float = Field(ge=0, description="Velocidad del iris en anchos de ojo por segundo")
    cierres_prolongados: int = Field(ge=0, description="Cierres de más de 500 ms en la ventana")


class MetricsSavedResponse(BaseModel):
    medicion_id: int
    nivel_fatiga: NivelFatiga


class MedicionOut(BaseModel):
    id: int
    actividad: str
    ear: Optional[float]
    perclos: Optional[float]
    parpadeos_min: Optional[float]
    tiempo_cierre: Optional[float]
    velocidad_ocular: Optional[float]
    cierres_prolongados: Optional[int]
    nivel_fatiga: Optional[str]
    registrado_en: str


class SesionOut(BaseModel):
    id: int
    actividad: str
    momento: Optional[MomentoJornada]
    kss_inicial: Optional[int]
    kss_final: Optional[int]
    iniciada_en: str
    finalizada_en: Optional[str]
    estado_analisis: EstadoAnalisis
    mediciones: list[MedicionOut]


class DiagnosticoOut(BaseModel):
    disponible: bool
    texto: Optional[str]
    detalle: Optional[dict] = None
    generado_en: Optional[str]
