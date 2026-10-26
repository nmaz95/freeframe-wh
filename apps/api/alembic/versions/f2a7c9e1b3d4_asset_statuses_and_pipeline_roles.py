"""asset statuses, pipeline roles and status-change notifications

An instance-wide, admin-managed list of asset statuses (one of them the
default a new asset starts in), each with a rule saying who is notified when
an asset is moved to it: the asset's creator, its assignee, and the holders of
chosen pipeline roles. Roles are held per project, with per-asset overrides.

`assets.status_id` is nullable and reads as "the default" when NULL; the
legacy `assets.status` enum stays and is mirrored where a status names a
`legacy_key`. Notifications gain an actor and a payload snapshot so a status
notification can say who moved what to where even after a rename.

Seeds the statuses of a review pipeline and four roles. Existing assets are
backfilled onto the status whose `legacy_key` matches their enum value, and
onto the default otherwise.

Revision ID: f2a7c9e1b3d4
Revises: c5d1f3a7b9e2
Create Date: 2026-10-26
"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f2a7c9e1b3d4'
down_revision: Union[str, Sequence[str], None] = 'c5d1f3a7b9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (name, color, is_default, legacy_key). Order is the pipeline order.
SEED_STATUSES = [
    ("No Status", "#8b8fa3", True, "draft"),
    ("Needs PM Review", "#3b82f6", False, None),
    ("Needs Editor Changes", "#eab308", False, None),
    ("Needs HOS Approval", "#15803d", False, None),
    ("Client Review", "#db2777", False, None),
    ("Approved", "#22c55e", False, "approved"),
    ("Rejected", "#ef4444", False, "rejected"),
]

SEED_ROLES = ["PM", "Editor", "HOS", "Client"]


def upgrade() -> None:
    # Only added here; the value is first used by application code, never in
    # this transaction (Postgres refuses that).
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'status_change'")

    op.add_column('notifications', sa.Column('actor_id', sa.UUID(), nullable=True))
    op.add_column('notifications', sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_foreign_key('fk_notifications_actor_id_users', 'notifications', 'users', ['actor_id'], ['id'])
    op.create_index('ix_notifications_actor_id', 'notifications', ['actor_id'])

    op.create_table(
        'asset_statuses',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('color', sa.String(length=7), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('notify_creator', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('notify_assignee', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('legacy_key', sa.String(length=20), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_asset_statuses_name_live', 'asset_statuses', [sa.text('lower(name)')],
        unique=True, postgresql_where=sa.text('deleted_at IS NULL'),
    )
    op.create_index(
        'uq_asset_statuses_one_default', 'asset_statuses', ['is_default'],
        unique=True, postgresql_where=sa.text('is_default AND deleted_at IS NULL'),
    )

    op.create_table(
        'pipeline_roles',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_pipeline_roles_name_live', 'pipeline_roles', [sa.text('lower(name)')],
        unique=True, postgresql_where=sa.text('deleted_at IS NULL'),
    )

    op.create_table(
        'asset_status_notify_roles',
        sa.Column('status_id', sa.UUID(), nullable=False),
        sa.Column('role_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['status_id'], ['asset_statuses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['pipeline_roles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('status_id', 'role_id'),
    )

    op.create_table(
        'pipeline_role_assignments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('role_id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('asset_id', sa.UUID(), nullable=True),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['role_id'], ['pipeline_roles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['asset_id'], ['assets.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_pipeline_role_assignments_role_id', 'pipeline_role_assignments', ['role_id'])
    op.create_index('ix_pipeline_role_assignments_user_id', 'pipeline_role_assignments', ['user_id'])
    op.create_index('ix_pra_project_asset', 'pipeline_role_assignments', ['project_id', 'asset_id'])
    op.create_index(
        'uq_pra_project_default', 'pipeline_role_assignments', ['role_id', 'project_id', 'user_id'],
        unique=True, postgresql_where=sa.text('asset_id IS NULL'),
    )
    op.create_index(
        'uq_pra_asset_override', 'pipeline_role_assignments', ['role_id', 'asset_id', 'user_id'],
        unique=True, postgresql_where=sa.text('asset_id IS NOT NULL'),
    )

    op.add_column('assets', sa.Column('status_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_assets_status_id_asset_statuses', 'assets', 'asset_statuses', ['status_id'], ['id'])
    op.create_index('ix_assets_status_id', 'assets', ['status_id'])

    # Seed. notify_creator is on (the uploader hears about every move) and no
    # role is attached yet, so nobody gets mail they did not sign up for until
    # an admin wires the roles up.
    statuses = sa.table(
        'asset_statuses',
        sa.column('id', sa.UUID()), sa.column('name', sa.String()), sa.column('color', sa.String()),
        sa.column('position', sa.Integer()), sa.column('is_default', sa.Boolean()),
        sa.column('notify_creator', sa.Boolean()), sa.column('notify_assignee', sa.Boolean()),
        sa.column('legacy_key', sa.String()),
    )
    op.bulk_insert(statuses, [
        {
            'id': uuid.uuid4(), 'name': name, 'color': color, 'position': i,
            'is_default': is_default, 'notify_creator': True, 'notify_assignee': False,
            'legacy_key': legacy,
        }
        for i, (name, color, is_default, legacy) in enumerate(SEED_STATUSES)
    ])
    roles = sa.table('pipeline_roles', sa.column('id', sa.UUID()), sa.column('name', sa.String()))
    op.bulk_insert(roles, [{'id': uuid.uuid4(), 'name': name} for name in SEED_ROLES])

    # Backfill: an asset whose enum value a seeded status mirrors goes there;
    # everything else starts on the default.
    op.execute(
        "UPDATE assets a SET status_id = s.id FROM asset_statuses s "
        "WHERE s.legacy_key = a.status::text AND a.status_id IS NULL"
    )
    op.execute(
        "UPDATE assets SET status_id = (SELECT id FROM asset_statuses WHERE is_default AND deleted_at IS NULL LIMIT 1) "
        "WHERE status_id IS NULL"
    )


def downgrade() -> None:
    op.drop_index('ix_assets_status_id', table_name='assets')
    op.drop_constraint('fk_assets_status_id_asset_statuses', 'assets', type_='foreignkey')
    op.drop_column('assets', 'status_id')
    op.drop_table('pipeline_role_assignments')
    op.drop_table('asset_status_notify_roles')
    op.drop_table('pipeline_roles')
    op.drop_table('asset_statuses')
    op.drop_index('ix_notifications_actor_id', table_name='notifications')
    op.drop_constraint('fk_notifications_actor_id_users', 'notifications', type_='foreignkey')
    op.drop_column('notifications', 'payload')
    op.drop_column('notifications', 'actor_id')
    # The enum value stays, as every enum-add migration here leaves it.
