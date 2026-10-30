"""Web Push: the devices a user asked to be notified on.

A row is one browser on one device where the user turned push on from their
profile: the push service's endpoint for it and the keys the browser made
for encrypting payloads to it. The service decides how long a row lives: a
404 or 410 from it means the subscription is gone (uninstalled, revoked,
rotated) and the row is deleted on the next push. Users are soft-deleted
only, so there is no cascade; the sender skips inactive users.
"""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
try:
    from ..database import Base
except ImportError:
    from database import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    # The push service's URL for this browser; one row per browser, whoever is signed in.
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # The browser's keys (base64url), as PushSubscription.toJSON() hands them over.
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # The last push the service accepted, and the last it refused for a reason
    # that does not end the subscription (a bad VAPID key, say).
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
