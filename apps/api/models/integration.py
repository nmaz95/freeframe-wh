"""Google Drive: a user's connected account and the copies sent there.

A connection is one per user: the refresh token Google issued to FreeFrame on
that person's behalf, encrypted at rest. A delivery is one copy of an asset's
original to a Drive folder, with where it went and how it ended.
"""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
try:
    from ..database import Base
except ImportError:
    from database import Base


class GoogleConnection(Base):
    __tablename__ = "google_connections"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, unique=True)
    google_email: Mapped[str] = mapped_column(String(255), nullable=False)
    # Fernet ciphertext (services/crypto_service.py). Never returned by the API.
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DeliveryStatus:
    queued = "queued"
    uploading = "uploading"
    done = "done"
    failed = "failed"


class DriveDelivery(Base):
    __tablename__ = "drive_deliveries"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id"), nullable=False, index=True)
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("asset_versions.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    folder_id: Mapped[str] = mapped_column(String(128), nullable=False)
    # The path as the Picker showed it ("Consegne / Barilla"), for the history.
    folder_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=DeliveryStatus.queued)
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    drive_file_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    web_view_link: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
