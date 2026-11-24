from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f6b3c8d2e9a1'
down_revision: Union[str, None] = 'e5f2a9c1b7d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'parpadeos',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('sesion_id', sa.Integer(), sa.ForeignKey('sesiones.id', ondelete='CASCADE'), nullable=False),
        sa.Column('medicion_id', sa.Integer(), sa.ForeignKey('mediciones.id', ondelete='SET NULL'), nullable=True),
        sa.Column('tipo', sa.String(length=12), nullable=False),
        sa.Column('inicio_ms', sa.Integer(), nullable=False),
        sa.Column('duracion_ms', sa.Integer(), nullable=False),
        sa.Column('ocurrido_en', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ear_minimo', sa.Numeric(precision=5, scale=3), nullable=True),
        sa.Column('umbral_p80', sa.Numeric(precision=5, scale=3), nullable=True),
        sa.Column('ear_base', sa.Numeric(precision=5, scale=3), nullable=True),
        sa.CheckConstraint("tipo IN ('completo', 'incompleto', 'prolongado')", name='parpadeos_tipo_check'),
    )
    op.create_index('idx_parpadeos_sesion', 'parpadeos', ['sesion_id'])


def downgrade() -> None:
    op.drop_index('idx_parpadeos_sesion', table_name='parpadeos')
    op.drop_table('parpadeos')
