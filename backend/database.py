from contextlib import contextmanager

from psycopg2 import pool

from backend.config import DATABASE_URL

# Pool simple de conexiones. min=1, max=10 es suficiente para desarrollo
# y para un prototipo con un grupo focal reducido de usuarios.
_pool = pool.SimpleConnectionPool(1, 10, dsn=DATABASE_URL)


@contextmanager
def get_connection():
    """Entrega una conexión del pool y la devuelve al terminar.

    Uso:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(...)
    """
    conn = _pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)
