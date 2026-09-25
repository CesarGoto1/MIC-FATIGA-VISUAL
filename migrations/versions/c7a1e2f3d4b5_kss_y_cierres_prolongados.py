"""KSS por sesión y cierres prolongados por medición

Reemplaza la autoevaluación 1-5 que se repetía en cada medición por la
Karolinska Sleepiness Scale (1-9) registrada al inicio y al final de la sesión.

Revision ID: c7a1e2f3d4b5
Revises: b4dfa1dfebf8
Create Date: 2026-09-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c7a1e2f3d4b5'
down_revision: Union[str, None] = 'b4dfa1dfebf8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sesiones', sa.Column('kss_inicial', sa.SmallInteger(), nullable=True))
    op.add_column('sesiones', sa.Column('kss_final', sa.SmallInteger(), nullable=True))
    op.create_check_constraint('sesiones_kss_inicial_check', 'sesiones', 'kss_inicial BETWEEN 1 AND 9')
    op.create_check_constraint('sesiones_kss_final_check', 'sesiones', 'kss_final BETWEEN 1 AND 9')

    op.add_column('mediciones', sa.Column('cierres_prolongados', sa.SmallInteger(), nullable=True))
    op.drop_constraint('mediciones_nivel_subjetivo_check', 'mediciones', type_='check')
    op.drop_column('mediciones', 'nivel_subjetivo')


def downgrade() -> None:
    op.add_column('mediciones', sa.Column('nivel_subjetivo', sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        'mediciones_nivel_subjetivo_check', 'mediciones', 'nivel_subjetivo BETWEEN 1 AND 5'
    )
    op.drop_column('mediciones', 'cierres_prolongados')

    op.drop_constraint('sesiones_kss_final_check', 'sesiones', type_='check')
    op.drop_constraint('sesiones_kss_inicial_check', 'sesiones', type_='check')
    op.drop_column('sesiones', 'kss_final')
    op.drop_column('sesiones', 'kss_inicial')
