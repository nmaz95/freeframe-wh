import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class GoogleStatusResponse(BaseModel):
    # False when the instance has no Google keys at all.
    enabled: bool
    connected: bool
    email: Optional[str] = None
    connected_at: Optional[datetime] = None


class GoogleAuthorizeResponse(BaseModel):
    url: str


class PickerConfigResponse(BaseModel):
    access_token: str
    expires_in: int
    api_key: str
    app_id: str
    root_folder_id: str = ""
    root_folder_name: Optional[str] = None


class DeliveryCreate(BaseModel):
    folder_id: str = Field(min_length=1, max_length=128)
    folder_name: str = Field(min_length=1, max_length=500)
    file_name: Optional[str] = Field(default=None, max_length=500)
    version_id: Optional[uuid.UUID] = None

    @field_validator("file_name")
    @classmethod
    def _clean(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = " ".join(v.split()).replace("/", "-").replace("\\", "-")
        return cleaned or None


class DeliveryResponse(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    version_id: uuid.UUID
    version_number: Optional[int] = None
    user_id: uuid.UUID
    user_name: Optional[str] = None
    folder_id: str
    folder_name: str
    file_name: str
    status: str
    progress_percent: int
    drive_file_id: Optional[str] = None
    web_view_link: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
