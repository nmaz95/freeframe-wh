"""Web Push: what the browser hands over when it subscribes, and what we list back."""
import uuid
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscribe(BaseModel):
    """Exactly `PushSubscription.toJSON()` as the browser produces it."""
    endpoint: str = Field(min_length=1, max_length=2000)
    keys: PushKeys
    # The browser may send it; nothing here reads it (services rotate on their own).
    expirationTime: Optional[float] = None

    @field_validator("endpoint")
    @classmethod
    def _absolute_https(cls, v: str) -> str:
        v = v.strip()
        parsed = urlparse(v)
        local = parsed.hostname in ("localhost", "127.0.0.1")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
            raise ValueError("endpoint must be an https URL")
        if not parsed.netloc:
            raise ValueError("endpoint must be an absolute URL")
        return v


class PushSubscriptionResponse(BaseModel):
    id: uuid.UUID
    endpoint: str
    user_agent: Optional[str] = None
    created_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None


class PushStatusResponse(BaseModel):
    """Whether this instance can push at all, the key a browser subscribes
    with, and the devices this user has turned push on in."""
    enabled: bool
    public_key: Optional[str] = None
    subscriptions: list[PushSubscriptionResponse] = []
