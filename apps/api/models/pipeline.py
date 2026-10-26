"""Custom asset statuses and the pipeline roles their notifications go to.

An instance has one ordered list of statuses (an admin's "No Status", "Needs
PM Review", ...), one of which is the default a new asset starts in. Each
status carries a notification rule: when an asset is moved to it, the asset's
creator and/or assignee and the people holding the chosen pipeline roles are
told. A pipeline role ("PM", "Editor", ...) is held per project, with an
optional per-asset override, through `PipelineRoleAssignment`.
"""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, func, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
try:
    from ..database import Base
except ImportError:
    from database import Base


class AssetStatusDef(Base):
    """One of the instance's statuses. `legacy_key` names the value of the
    fixed `assets.status` enum this status mirrors into, so smart collections
    and older clients that read that column keep agreeing with the new one."""
    __tablename__ = "asset_statuses"
    __table_args__ = (
        Index(
            "uq_asset_statuses_name_live", text("lower(name)"), unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_asset_statuses_one_default", "is_default", unique=True,
            postgresql_where=text("is_default AND deleted_at IS NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notify_creator: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notify_assignee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    legacy_key: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PipelineRole(Base):
    __tablename__ = "pipeline_roles"
    __table_args__ = (
        Index(
            "uq_pipeline_roles_name_live", text("lower(name)"), unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class AssetStatusNotifyRole(Base):
    """Which pipeline roles a status notifies. Replaced whole on every edit."""
    __tablename__ = "asset_status_notify_roles"
    status_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("asset_statuses.id", ondelete="CASCADE"), primary_key=True,
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pipeline_roles.id", ondelete="CASCADE"), primary_key=True,
    )


class PipelineRoleAssignment(Base):
    """Who holds a pipeline role. `asset_id` NULL is the project's default;
    a row with an asset is that asset's override, which replaces the default
    for that role whenever at least one exists. `project_id` is set on both so
    everything about a project is one query."""
    __tablename__ = "pipeline_role_assignments"
    __table_args__ = (
        Index(
            "uq_pra_project_default", "role_id", "project_id", "user_id", unique=True,
            postgresql_where=text("asset_id IS NULL"),
        ),
        Index(
            "uq_pra_asset_override", "role_id", "asset_id", "user_id", unique=True,
            postgresql_where=text("asset_id IS NOT NULL"),
        ),
        Index("ix_pra_project_asset", "project_id", "asset_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pipeline_roles.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    asset_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id"), nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
