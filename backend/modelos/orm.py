from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


LARGO_NOMBRE = 100
LARGO_CORREO = 150
ACTIVIDADES = "('lectura', 'video', 'libre')"


def codigo_participante(usuario_id: int) -> str:
    return f"P{usuario_id:03d}"


class Usuario(Base):

    __tablename__ = "usuarios"
    __table_args__ = (
        CheckConstraint("length(trim(nombre)) > 0", name="usuarios_nombre_check"),
        CheckConstraint("correo = lower(correo) AND position('@' IN correo) > 1", name="usuarios_correo_check"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(LARGO_NOMBRE), nullable=False)
    correo: Mapped[str] = mapped_column(String(LARGO_CORREO), nullable=False, unique=True)
    clave_hash: Mapped[str] = mapped_column(String(100), nullable=False)
    es_admin: Mapped[bool] = mapped_column(default=False, server_default="false")
    grabacion_habilitada: Mapped[bool] = mapped_column(default=False, server_default="false")
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sesiones: Mapped[list["Sesion"]] = relationship(
        back_populates="usuario", cascade="all, delete-orphan"
    )

    @property
    def codigo(self) -> str:
        return codigo_participante(self.id)


class Sesion(Base):

    __tablename__ = "sesiones"
    __table_args__ = (
        CheckConstraint("momento IN ('pre', 'post')", name="sesiones_momento_check"),
        CheckConstraint("kss_inicial BETWEEN 1 AND 9", name="sesiones_kss_inicial_check"),
        CheckConstraint("kss_final BETWEEN 1 AND 9", name="sesiones_kss_final_check"),
        CheckConstraint(f"actividad IN {ACTIVIDADES}", name="sesiones_actividad_check"),
        CheckConstraint("finalizada_en IS NULL OR finalizada_en >= iniciada_en", name="sesiones_fechas_check"),
        Index("idx_sesiones_usuario", "usuario_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False
    )
    actividad: Mapped[str] = mapped_column(String(20), nullable=False)
    momento: Mapped[str | None] = mapped_column(String(10))
    kss_inicial: Mapped[int | None] = mapped_column(SmallInteger)
    kss_final: Mapped[int | None] = mapped_column(SmallInteger)
    iniciada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finalizada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    grabacion_consentida: Mapped[bool | None] = mapped_column()

    usuario: Mapped["Usuario"] = relationship(back_populates="sesiones")
    mediciones: Mapped[list["Medicion"]] = relationship(
        back_populates="sesion", cascade="all, delete-orphan"
    )
    diagnosticos: Mapped[list["Diagnostico"]] = relationship(
        back_populates="sesion", cascade="all, delete-orphan"
    )
    parpadeos: Mapped[list["Parpadeo"]] = relationship(
        back_populates="sesion", cascade="all, delete-orphan"
    )
    grabacion: Mapped["Grabacion | None"] = relationship(
        back_populates="sesion", cascade="all, delete-orphan"
    )


class Medicion(Base):

    __tablename__ = "mediciones"
    __table_args__ = (
        CheckConstraint(f"actividad IN {ACTIVIDADES}", name="mediciones_actividad_check"),
        CheckConstraint("ear BETWEEN 0 AND 1", name="mediciones_ear_check"),
        CheckConstraint("perclos BETWEEN 0 AND 100", name="mediciones_perclos_check"),
        CheckConstraint("parpadeos_min >= 0", name="mediciones_parpadeos_min_check"),
        CheckConstraint("tiempo_cierre >= 0", name="mediciones_tiempo_cierre_check"),
        CheckConstraint("velocidad_ocular >= 0", name="mediciones_velocidad_ocular_check"),
        CheckConstraint("cierres_prolongados >= 0", name="mediciones_cierres_prolongados_check"),
        CheckConstraint("parpadeos_incompletos_pct BETWEEN 0 AND 100", name="mediciones_incompletos_pct_check"),
        CheckConstraint(
            "nivel_fatiga IN ('sin_fatiga', 'leve', 'moderada')", name="mediciones_nivel_fatiga_check"
        ),
        Index("idx_mediciones_sesion", "sesion_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sesion_id: Mapped[int] = mapped_column(
        ForeignKey("sesiones.id", ondelete="CASCADE"), nullable=False
    )
    actividad: Mapped[str] = mapped_column(String(20), nullable=False)
    ear: Mapped[float | None] = mapped_column(Numeric(5, 3, asdecimal=False))
    perclos: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False))
    parpadeos_min: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False))
    tiempo_cierre: Mapped[float | None] = mapped_column(Numeric(7, 1, asdecimal=False))
    velocidad_ocular: Mapped[float | None] = mapped_column(Numeric(8, 5, asdecimal=False))
    cierres_prolongados: Mapped[int | None] = mapped_column(SmallInteger)
    parpadeos_incompletos_pct: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False))
    nivel_fatiga: Mapped[str | None] = mapped_column(String(20))
    somnolencia: Mapped[bool | None] = mapped_column()
    registrado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sesion: Mapped["Sesion"] = relationship(back_populates="mediciones")


class Parpadeo(Base):

    __tablename__ = "parpadeos"
    __table_args__ = (
        CheckConstraint(
            "tipo IN ('completo', 'incompleto', 'prolongado')", name="parpadeos_tipo_check"
        ),
        CheckConstraint("inicio_ms >= 0", name="parpadeos_inicio_ms_check"),
        CheckConstraint("duracion_ms >= 0", name="parpadeos_duracion_ms_check"),
        CheckConstraint(
            "ear_minimo >= 0 AND umbral_p80 >= 0 AND ear_base >= 0", name="parpadeos_ear_check"
        ),
        Index("idx_parpadeos_sesion", "sesion_id"),
        Index("idx_parpadeos_medicion", "medicion_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sesion_id: Mapped[int] = mapped_column(
        ForeignKey("sesiones.id", ondelete="CASCADE"), nullable=False
    )
    medicion_id: Mapped[int | None] = mapped_column(
        ForeignKey("mediciones.id", ondelete="SET NULL")
    )
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)
    inicio_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    duracion_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    ocurrido_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ear_minimo: Mapped[float | None] = mapped_column(Numeric(5, 3, asdecimal=False))
    umbral_p80: Mapped[float | None] = mapped_column(Numeric(5, 3, asdecimal=False))
    ear_base: Mapped[float | None] = mapped_column(Numeric(5, 3, asdecimal=False))

    sesion: Mapped["Sesion"] = relationship(back_populates="parpadeos")


class Diagnostico(Base):

    __tablename__ = "diagnosticos"
    __table_args__ = (Index("idx_diagnosticos_sesion", "sesion_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sesion_id: Mapped[int] = mapped_column(
        ForeignKey("sesiones.id", ondelete="CASCADE"), nullable=False
    )
    texto: Mapped[str | None] = mapped_column(Text)
    detalle: Mapped[dict | None] = mapped_column(JSONB)
    disponible: Mapped[bool] = mapped_column(default=False, server_default="false")
    generado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sesion: Mapped["Sesion"] = relationship(back_populates="diagnosticos")


class Grabacion(Base):

    __tablename__ = "grabaciones"
    __table_args__ = (
        CheckConstraint(
            "tipo_mime IN ('video/webm', 'video/mp4', 'video/x-matroska')", name="grabaciones_tipo_mime_check"
        ),
        CheckConstraint("desfase_ms >= 0 AND partes >= 0 AND bytes >= 0", name="grabaciones_conteos_check"),
        CheckConstraint("actualizada_en >= creada_en", name="grabaciones_fechas_check"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sesion_id: Mapped[int] = mapped_column(
        ForeignKey("sesiones.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    archivo: Mapped[str] = mapped_column(String(100), nullable=False)
    tipo_mime: Mapped[str] = mapped_column(String(50), nullable=False)
    desfase_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    partes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actualizada_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sesion: Mapped["Sesion"] = relationship(back_populates="grabacion")
