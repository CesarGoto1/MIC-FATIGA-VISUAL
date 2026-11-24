from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a7d4e2c9f1b3'
down_revision: Union[str, None] = 'f6b3c8d2e9a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('usuarios', sa.Column('grabacion_habilitada', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('sesiones', sa.Column('grabacion_consentida', sa.Boolean(), nullable=True))
    op.create_table(
        'grabaciones',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('sesion_id', sa.Integer(), sa.ForeignKey('sesiones.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('archivo', sa.String(length=255), nullable=False),
        sa.Column('mime', sa.String(length=40), nullable=False),
        sa.Column('offset_ms', sa.Integer(), nullable=False),
        sa.Column('partes', sa.Integer(), nullable=False),
        sa.Column('bytes', sa.BigInteger(), nullable=False),
        sa.Column('creada_en', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('actualizada_en', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('grabaciones')
    op.drop_column('sesiones', 'grabacion_consentida')
    op.drop_column('usuarios', 'grabacion_habilitada')
