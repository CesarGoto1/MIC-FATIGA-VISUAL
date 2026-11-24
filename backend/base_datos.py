from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.configuracion import URL_BASE_DATOS

motor = create_engine(URL_BASE_DATOS, pool_size=5, max_overflow=5, pool_pre_ping=True)

crear_sesion_bd = sessionmaker(bind=motor, autoflush=False, expire_on_commit=False)


def obtener_bd() -> Generator[Session, None, None]:
    bd = crear_sesion_bd()
    try:
        yield bd
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    finally:
        bd.close()
