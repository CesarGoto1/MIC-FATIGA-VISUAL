from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c9d2e7a4f1b6'
down_revision: Union[str, None] = 'b8e3f0d6c2a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LONGITUDES = [
    ('usuarios', 'nombre', 120, 100),
    ('usuarios', 'correo', 160, 150),
    ('usuarios', 'clave_hash', 255, 100),
    ('sesiones', 'actividad', 80, 20),
    ('mediciones', 'actividad', 80, 20),
    ('parpadeos', 'tipo', 12, 20),
    ('grabaciones', 'archivo', 255, 100),
    ('grabaciones', 'tipo_mime', 40, 50),
]

RESTRICCIONES = [
    ('usuarios', 'usuarios_nombre_check', "length(trim(nombre)) > 0"),
    ('usuarios', 'usuarios_correo_check', "correo = lower(correo) AND position('@' IN correo) > 1"),
    ('sesiones', 'sesiones_actividad_check', "actividad IN ('lectura', 'video', 'libre')"),
    ('sesiones', 'sesiones_fechas_check', "finalizada_en IS NULL OR finalizada_en >= iniciada_en"),
    ('mediciones', 'mediciones_actividad_check', "actividad IN ('lectura', 'video', 'libre')"),
    ('mediciones', 'mediciones_ear_check', "ear BETWEEN 0 AND 1"),
    ('mediciones', 'mediciones_perclos_check', "perclos BETWEEN 0 AND 100"),
    ('mediciones', 'mediciones_parpadeos_min_check', "parpadeos_min >= 0"),
    ('mediciones', 'mediciones_tiempo_cierre_check', "tiempo_cierre >= 0"),
    ('mediciones', 'mediciones_velocidad_ocular_check', "velocidad_ocular >= 0"),
    ('mediciones', 'mediciones_cierres_prolongados_check', "cierres_prolongados >= 0"),
    ('mediciones', 'mediciones_incompletos_pct_check', "parpadeos_incompletos_pct BETWEEN 0 AND 100"),
    ('mediciones', 'mediciones_nivel_fatiga_check', "nivel_fatiga IN ('sin_fatiga', 'leve', 'moderada')"),
    ('parpadeos', 'parpadeos_inicio_ms_check', "inicio_ms >= 0"),
    ('parpadeos', 'parpadeos_duracion_ms_check', "duracion_ms >= 0"),
    ('parpadeos', 'parpadeos_ear_check', "ear_minimo >= 0 AND umbral_p80 >= 0 AND ear_base >= 0"),
    ('grabaciones', 'grabaciones_tipo_mime_check', "tipo_mime IN ('video/webm', 'video/mp4', 'video/x-matroska')"),
    ('grabaciones', 'grabaciones_conteos_check', "desfase_ms >= 0 AND partes >= 0 AND bytes >= 0"),
    ('grabaciones', 'grabaciones_fechas_check', "actualizada_en >= creada_en"),
]


def _verificar_datos() -> None:
    conexion = op.get_bind()
    problemas = []
    for tabla, columna, _, nueva in LONGITUDES:
        exceso = conexion.scalar(sa.text(f"SELECT count(*) FROM {tabla} WHERE length({columna}) > {nueva}"))
        if exceso:
            problemas.append(f"{tabla}.{columna}: {exceso} fila(s) con más de {nueva} caracteres")
    for tabla, nombre, condicion in RESTRICCIONES:
        fallas = conexion.scalar(sa.text(f"SELECT count(*) FROM {tabla} WHERE NOT ({condicion})"))
        if fallas:
            problemas.append(f"{tabla} ({nombre}): {fallas} fila(s) no cumplen '{condicion}'")
    if problemas:
        raise RuntimeError("Hay datos que no cumplen las reglas nuevas:\n  " + "\n  ".join(problemas))


def upgrade() -> None:
    _verificar_datos()
    for tabla, columna, _, nueva in LONGITUDES:
        op.alter_column(tabla, columna, type_=sa.String(nueva), existing_nullable=False)
    for tabla, nombre, condicion in RESTRICCIONES:
        op.create_check_constraint(nombre, tabla, condicion)
    op.create_index('idx_parpadeos_medicion', 'parpadeos', ['medicion_id'])


def downgrade() -> None:
    op.drop_index('idx_parpadeos_medicion', table_name='parpadeos')
    for tabla, nombre, _ in reversed(RESTRICCIONES):
        op.drop_constraint(nombre, tabla, type_='check')
    for tabla, columna, anterior, _ in reversed(LONGITUDES):
        op.alter_column(tabla, columna, type_=sa.String(anterior), existing_nullable=False)
