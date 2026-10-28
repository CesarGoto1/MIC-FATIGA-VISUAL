from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e5f2a9c1b7d4'
down_revision: Union[str, None] = 'd3e8f1a2b6c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('usuarios', sa.Column('es_admin', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('usuarios', 'es_admin')
