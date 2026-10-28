"""Google Drive deliveries: connected accounts, deliveries, root folder setting

"Send to Google Drive" copies an asset's original from storage to a Drive
folder, as the person sending it. `google_connections` holds each user's
encrypted refresh token; `drive_deliveries` records every copy and how it
ended; the instance setting names the folder the picker opens on. A new
notification type tells the sender when a copy is done or failed.

Revision ID: d4e5f6a7b8c9
Revises: f2a7c9e1b3d4
Create Date: 2026-10-28
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'f2a7c9e1b3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'delivery'")

    op.create_table(
        'google_connections',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('google_email', sa.String(length=255), nullable=False),
        sa.Column('refresh_token_encrypted', sa.Text(), nullable=False),
        sa.Column('scopes', sa.String(length=500), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_google_connections_user_id'),
    )

    op.create_table(
        'drive_deliveries',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('asset_id', sa.UUID(), nullable=False),
        sa.Column('version_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('folder_id', sa.String(length=128), nullable=False),
        sa.Column('folder_name', sa.String(length=500), nullable=False),
        sa.Column('file_name', sa.String(length=500), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='queued'),
        sa.Column('progress_percent', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('drive_file_id', sa.String(length=128), nullable=True),
        sa.Column('web_view_link', sa.String(length=1000), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['assets.id']),
        sa.ForeignKeyConstraint(['version_id'], ['asset_versions.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_drive_deliveries_asset_id', 'drive_deliveries', ['asset_id'])
    op.create_index('ix_drive_deliveries_version_id', 'drive_deliveries', ['version_id'])
    op.create_index('ix_drive_deliveries_user_id', 'drive_deliveries', ['user_id'])

    op.add_column('instance_settings', sa.Column('drive_root_folder_id', sa.String(length=128), nullable=True))
    op.add_column('instance_settings', sa.Column('drive_root_folder_name', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('instance_settings', 'drive_root_folder_name')
    op.drop_column('instance_settings', 'drive_root_folder_id')
    op.drop_index('ix_drive_deliveries_user_id', table_name='drive_deliveries')
    op.drop_index('ix_drive_deliveries_version_id', table_name='drive_deliveries')
    op.drop_index('ix_drive_deliveries_asset_id', table_name='drive_deliveries')
    op.drop_table('drive_deliveries')
    op.drop_table('google_connections')
    # The enum value stays, as every enum-add migration here leaves it.
