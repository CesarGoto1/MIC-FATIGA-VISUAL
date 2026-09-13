from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

NivelFatiga = Literal["sin_fatiga", "leve", "moderada"]
MomentoJornada = Literal["pre", "post"]


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
    actividad: str = Field(min_length=1, max_length=80)
    momento: Optional[MomentoJornada] = None


class SessionCreateResponse(BaseModel):
    sesion_id: int
    actividad: str
    momento: Optional[MomentoJornada]


class MetricsInRequest(BaseModel):
    actividad: str = Field(min_length=1, max_length=80)
    ear: float = Field(ge=0, le=1, description="Eye Aspect Ratio promedio del intervalo")
    perclos: float = Field(ge=0, le=100, description="Porcentaje de cierre ocular")
    parpadeos_min: float = Field(ge=0, description="Frecuencia de parpadeo por minuto")
    tiempo_cierre: float = Field(ge=0, description="Duración promedio de cierre ocular en ms")
    velocidad_ocular: float = Field(ge=0, description="Índice de velocidad de movimiento ocular")
    nivel_subjetivo: int = Field(ge=1, le=5, description="Autoevaluación de fatiga visual (1-5)")


class MetricsSavedResponse(BaseModel):
    medicion_id: int
    nivel_fatiga: NivelFatiga
    diagnostico_disponible: bool


class MedicionOut(BaseModel):
    id: int
    actividad: str
    ear: Optional[float]
    perclos: Optional[float]
    parpadeos_min: Optional[float]
    tiempo_cierre: Optional[float]
    velocidad_ocular: Optional[float]
    nivel_subjetivo: Optional[int]
    nivel_fatiga: Optional[str]
    registrado_en: str


class SesionOut(BaseModel):
    id: int
    actividad: str
    momento: Optional[MomentoJornada]
    iniciada_en: str
    finalizada_en: Optional[str]
    mediciones: list[MedicionOut]


class DiagnosticoOut(BaseModel):
    disponible: bool
    texto: Optional[str]
    detalle: Optional[dict] = None
    generado_en: Optional[str]
