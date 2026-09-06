from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

NivelFatiga = Literal["sin_fatiga", "leve", "moderada"]
MomentoJornada = Literal["pre", "post"]


# --- Auth ---

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


# --- Sesiones (RF07) ---

class SessionCreateRequest(BaseModel):
    actividad: str = Field(min_length=1, max_length=80)
    # Fase experimental pre/post jornada (Objetivo específico 4). Opcional:
    # None para sesiones sueltas fuera del protocolo de validación.
    momento: Optional[MomentoJornada] = None


class SessionCreateResponse(BaseModel):
    sesion_id: int
    actividad: str
    momento: Optional[MomentoJornada]


# --- Métricas (RF03, RF04, RF05) ---
# Estos son los valores que el CLIENTE ya calculó localmente a partir de
# MediaPipe (ver RNF01): nunca se envían imágenes ni video, solo números.

class MetricsInRequest(BaseModel):
    actividad: str = Field(min_length=1, max_length=80)
    ear: float = Field(ge=0, le=1, description="Eye Aspect Ratio promedio del intervalo")
    perclos: float = Field(ge=0, le=100, description="Porcentaje de cierre ocular")
    parpadeos_min: float = Field(ge=0, description="Frecuencia de parpadeo por minuto")


class MetricsSavedResponse(BaseModel):
    medicion_id: int
    nivel_fatiga: NivelFatiga
    diagnostico_disponible: bool  # RNF05: false si el diagnóstico de IA no respondió aún


# --- Historial (Objetivo específico 4 / RF07) ---

class MedicionOut(BaseModel):
    id: int
    actividad: str
    ear: Optional[float]
    perclos: Optional[float]
    parpadeos_min: Optional[float]
    nivel_fatiga: Optional[str]
    registrado_en: str


class SesionOut(BaseModel):
    id: int
    actividad: str
    momento: Optional[MomentoJornada]
    iniciada_en: str
    finalizada_en: Optional[str]
    mediciones: list[MedicionOut]


# --- Diagnóstico narrativo (RF09) ---

class DiagnosticoOut(BaseModel):
    disponible: bool
    texto: Optional[str]
    generado_en: Optional[str]
