from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd3e8f1a2b6c9'
down_revision: Union[str, None] = 'c7a1e2f3d4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('mediciones', sa.Column('parpadeos_incompletos_pct', sa.Numeric(precision=5, scale=2), nullable=True))
    op.add_column('mediciones', sa.Column('somnolencia', sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column('mediciones', 'somnolencia')
    op.drop_column('mediciones', 'parpadeos_incompletos_pct')
