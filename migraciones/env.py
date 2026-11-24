from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from backend.configuracion import URL_BASE_DATOS
from backend.modelos.orm import Base

configuracion = context.config
configuracion.set_main_option("sqlalchemy.url", URL_BASE_DATOS)

if configuracion.config_file_name is not None:
    fileConfig(configuracion.config_file_name)

metadatos = Base.metadata


def migrar_sin_conexion() -> None:
    context.configure(
        url=configuracion.get_main_option("sqlalchemy.url"),
        target_metadata=metadatos,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def migrar_con_conexion() -> None:
    motor = engine_from_config(
        configuracion.get_section(configuracion.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with motor.connect() as conexion:
        context.configure(connection=conexion, target_metadata=metadatos)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    migrar_sin_conexion()
else:
    migrar_con_conexion()
