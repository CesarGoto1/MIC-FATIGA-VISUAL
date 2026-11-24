from typing import Sequence, Union

from alembic import op

revision: str = 'b8e3f0d6c2a4'
down_revision: Union[str, None] = 'a7d4e2c9f1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('usuarios', 'email', new_column_name='correo')
    op.alter_column('usuarios', 'password_hash', new_column_name='clave_hash')
    op.execute('ALTER TABLE usuarios RENAME CONSTRAINT usuarios_email_key TO usuarios_correo_key')
    op.alter_column('grabaciones', 'mime', new_column_name='tipo_mime')
    op.alter_column('grabaciones', 'offset_ms', new_column_name='desfase_ms')
    for columna in ('creada_en', 'actualizada_en'):
        op.alter_column('grabaciones', columna, nullable=False)


def downgrade() -> None:
    for columna in ('creada_en', 'actualizada_en'):
        op.alter_column('grabaciones', columna, nullable=True)
    op.alter_column('grabaciones', 'desfase_ms', new_column_name='offset_ms')
    op.alter_column('grabaciones', 'tipo_mime', new_column_name='mime')
    op.execute('ALTER TABLE usuarios RENAME CONSTRAINT usuarios_correo_key TO usuarios_email_key')
    op.alter_column('usuarios', 'clave_hash', new_column_name='password_hash')
    op.alter_column('usuarios', 'correo', new_column_name='email')
