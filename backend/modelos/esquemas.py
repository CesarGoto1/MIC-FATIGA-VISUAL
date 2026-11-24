from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from backend.modelos.orm import LARGO_CORREO, LARGO_NOMBRE
from backend.seguridad import MAX_BYTES_CLAVE

NivelFatiga = Literal["sin_fatiga", "leve", "moderada"]
MomentoJornada = Literal["pre", "post"]
Actividad = Literal["lectura", "video", "libre"]
EstadoAnalisis = Literal["disponible", "pendiente", "no_disponible", "sin_datos"]
TipoParpadeo = Literal["completo", "incompleto", "prolongado"]

KSS_MIN = 1
KSS_MAX = 9


class _ConCorreo(BaseModel):
    correo: EmailStr = Field(max_length=LARGO_CORREO)

    @field_validator("correo")
    @classmethod
    def _normalizar_correo(cls, correo: str) -> str:
        return correo.strip().lower()


class _ConClave(BaseModel):
    @field_validator("clave", check_fields=False)
    @classmethod
    def _limitar_bytes_clave(cls, clave: str) -> str:
        if len(clave.encode("utf-8")) > MAX_BYTES_CLAVE:
            raise ValueError(f"La contraseña no puede superar {MAX_BYTES_CLAVE} bytes.")
        return clave


class RegistroEntrada(_ConCorreo, _ConClave):
    nombre: str = Field(min_length=1, max_length=LARGO_NOMBRE)
    clave: str = Field(min_length=8)


class IngresoEntrada(_ConCorreo, _ConClave):
    clave: str


class TokenSalida(BaseModel):
    token_acceso: str
    tipo_token: str = "bearer"
    usuario_id: int
    nombre: str
    codigo_participante: str
    es_admin: bool = False


class PerfilSalida(BaseModel):
    usuario_id: int
    nombre: str
    codigo_participante: str
    es_admin: bool
    grabacion_habilitada: bool = False


class SesionNuevaEntrada(BaseModel):
    actividad: Actividad
    momento: MomentoJornada
    kss_inicial: int = Field(ge=KSS_MIN, le=KSS_MAX, description="KSS reportada al iniciar")
    grabar: bool = Field(default=False, description="El participante aceptó grabar la sesión")


class SesionNuevaSalida(BaseModel):
    id: int
    actividad: str
    momento: MomentoJornada
    kss_inicial: int
    grabar: bool = False


class SesionCambioEntrada(BaseModel):
    finalizada: Literal[True] = Field(description="Marca la sesión como finalizada")
    kss_final: int = Field(ge=KSS_MIN, le=KSS_MAX, description="KSS reportada al finalizar")


class ParpadeoEntrada(BaseModel):
    tipo: TipoParpadeo
    inicio_ms: int = Field(ge=0, description="Inicio del cierre en ms desde que empezó el monitoreo")
    duracion_ms: int = Field(ge=0, description="Duración del cierre en ms")
    ocurrido_en: datetime = Field(description="Hora real del inicio del cierre")
    ear_minimo: float | None = Field(default=None, ge=0)
    umbral_p80: float | None = Field(default=None, ge=0)
    ear_base: float | None = Field(default=None, ge=0)


class ParpadeoSalida(ParpadeoEntrada):
    model_config = ConfigDict(from_attributes=True)

    id: int


class MedicionEntrada(BaseModel):
    ear: float = Field(ge=0, le=1, description="Eye Aspect Ratio promedio del intervalo")
    perclos: float = Field(ge=0, le=100, description="PERCLOS P80 en porcentaje")
    parpadeos_min: float = Field(ge=0, description="Frecuencia de parpadeo por minuto")
    tiempo_cierre: float = Field(ge=0, description="Duración promedio de cierre ocular en ms")
    velocidad_ocular: float = Field(ge=0, description="Velocidad del iris en anchos de ojo por segundo")
    cierres_prolongados: int = Field(ge=0, description="Cierres de más de 500 ms en la ventana")
    parpadeos_incompletos_pct: float | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Porcentaje de parpadeos que no cierran el párpado al 80 % (nulo si no hubo parpadeos)",
    )
    parpadeos: list[ParpadeoEntrada] = Field(default_factory=list, max_length=2000)


class MedicionGuardadaSalida(BaseModel):
    id: int
    nivel_fatiga: NivelFatiga
    somnolencia: bool


class MedicionSalida(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actividad: str
    ear: float | None
    perclos: float | None
    parpadeos_min: float | None
    tiempo_cierre: float | None
    velocidad_ocular: float | None
    cierres_prolongados: int | None
    parpadeos_incompletos_pct: float | None
    nivel_fatiga: str | None
    somnolencia: bool | None
    registrado_en: datetime


class GrabacionSalida(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tipo_mime: str
    desfase_ms: int
    partes: int
    bytes: int
    actualizada_en: datetime


class GrabacionParteSalida(BaseModel):
    partes: int
    bytes: int


class ParticipanteCambioEntrada(BaseModel):
    grabacion_habilitada: bool


class DiagnosticoSalida(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    disponible: bool
    texto: str | None
    detalle: dict | None = None
    generado_en: datetime | None


class SolicitudAnalisisSalida(BaseModel):
    estado_analisis: EstadoAnalisis


class _SesionBase(BaseModel):
    id: int
    actividad: str
    momento: MomentoJornada | None
    kss_inicial: int | None
    kss_final: int | None
    iniciada_en: datetime
    finalizada_en: datetime | None
    estado_analisis: EstadoAnalisis


class SesionSalida(_SesionBase):
    nivel_fatiga: NivelFatiga | None
    mediciones: list[MedicionSalida]


class PromediosMomento(BaseModel):
    sesiones: int
    kss: float | None
    parpadeos_min: float | None
    parpadeos_incompletos_pct: float | None
    tiempo_cierre: float | None


class ResumenSalida(BaseModel):
    total_sesiones: int
    sesiones_semana: int
    sesiones_con_fatiga: int
    ultima_sesion: datetime | None
    pre: PromediosMomento | None
    post: PromediosMomento | None


class ParticipanteSalida(BaseModel):
    codigo: str
    sesiones: int
    sesiones_pre: int
    sesiones_post: int
    ultima_sesion: datetime | None
    grabacion_habilitada: bool = False


class SesionAdminSalida(_SesionBase):
    participante: str
    duracion_min: float | None
    num_mediciones: int
    nivel_fatiga_tramo_final: NivelFatiga | None
    mediciones_con_somnolencia: int
    somnolencia_tramo_final: bool | None
    parpadeos_completos: int = 0
    parpadeos_incompletos: int = 0
    cierres_prolongados_total: int = 0
    grabacion_consentida: bool | None = None
    tiene_grabacion: bool = False


class SesionAdminDetalleSalida(SesionAdminSalida):
    mediciones: list[MedicionSalida]
    diagnostico: DiagnosticoSalida
    grabacion: GrabacionSalida | None = None
