from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
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


class Usuario(Base):
    """Modela la tabla usuarios: cuentas registradas en la plataforma."""

    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sesiones: Mapped[list["Sesion"]] = relationship(
        back_populates="usuario", cascade="all, delete-orphan"
    )


class Sesion(Base):
    """Modela la tabla sesiones: una sesión de monitoreo iniciada por un usuario."""

    __tablename__ = "sesiones"
    __table_args__ = (
        CheckConstraint("momento IN ('pre', 'post')", name="sesiones_momento_check"),
        CheckConstraint("kss_inicial BETWEEN 1 AND 9", name="sesiones_kss_inicial_check"),
        CheckConstraint("kss_final BETWEEN 1 AND 9", name="sesiones_kss_final_check"),
        Index("idx_sesiones_usuario", "usuario_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False
    )
    actividad: Mapped[str] = mapped_column(String(80), nullable=False)
    momento: Mapped[str | None] = mapped_column(String(10))
    kss_inicial: Mapped[int | None] = mapped_column(SmallInteger)
    kss_final: Mapped[int | None] = mapped_column(SmallInteger)
    iniciada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finalizada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    usuario: Mapped["Usuario"] = relationship(back_populates="sesiones")
    mediciones: Mapped[list["Medicion"]] = relationship(
        back_populates="sesion", cascade="all, delete-orphan"
    )
    diagnosticos: Mapped[list["Diagnostico"]] = relationship(
        back_populates="sesion", cascade="all, delete-orphan"
    )


class Medicion(Base):
    """Modela la tabla mediciones: una lectura de métricas oculares dentro de una sesión."""

    __tablename__ = "mediciones"
    __table_args__ = (Index("idx_mediciones_sesion", "sesion_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sesion_id: Mapped[int] = mapped_column(
        ForeignKey("sesiones.id", ondelete="CASCADE"), nullable=False
    )
    actividad: Mapped[str] = mapped_column(String(80), nullable=False)
    # asdecimal=False: se leen como float y se pueden serializar a JSON sin conversión.
    ear: Mapped[float | None] = mapped_column(Numeric(5, 3, asdecimal=False))
    perclos: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False))
    parpadeos_min: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False))
    tiempo_cierre: Mapped[float | None] = mapped_column(Numeric(7, 1, asdecimal=False))
    velocidad_ocular: Mapped[float | None] = mapped_column(Numeric(8, 5, asdecimal=False))
    cierres_prolongados: Mapped[int | None] = mapped_column(SmallInteger)
    nivel_fatiga: Mapped[str | None] = mapped_column(String(20))
    registrado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sesion: Mapped["Sesion"] = relationship(back_populates="mediciones")


class Diagnostico(Base):
    """Modela la tabla diagnosticos: el diagnóstico narrativo generado para una sesión."""

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
