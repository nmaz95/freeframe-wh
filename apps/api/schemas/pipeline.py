import uuid
from typing import Optional
from pydantic import BaseModel, Field, field_validator

COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


def _clean_name(value: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError("Name must not be blank")
    return cleaned


class StatusCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(pattern=COLOR_PATTERN)
    is_default: bool = False
    notify_creator: bool = True
    notify_assignee: bool = False
    notify_role_ids: list[uuid.UUID] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_name(v)


class StatusUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    color: Optional[str] = Field(default=None, pattern=COLOR_PATTERN)
    is_default: Optional[bool] = None
    notify_creator: Optional[bool] = None
    notify_assignee: Optional[bool] = None
    notify_role_ids: Optional[list[uuid.UUID]] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _clean_name(v)


class StatusResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: str
    position: int
    is_default: bool
    notify_creator: bool
    notify_assignee: bool
    notify_role_ids: list[uuid.UUID] = Field(default_factory=list)
    # The legacy `assets.status` value this status mirrors into, if any.
    legacy_key: Optional[str] = None


class StatusReorder(BaseModel):
    """Every live status id, in the order they should be shown."""
    ids: list[uuid.UUID] = Field(min_length=1)


class PipelineRoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_name(v)


class PipelineRoleUpdate(PipelineRoleCreate):
    pass


class PipelineRoleResponse(BaseModel):
    id: uuid.UUID
    name: str
    model_config = {"from_attributes": True}


class RoleAssignmentEntry(BaseModel):
    role_id: uuid.UUID
    user_ids: list[uuid.UUID] = Field(default_factory=list)


class RoleAssignmentsPut(BaseModel):
    """Replaces every assignment at that scope: a role left out loses its holders."""
    assignments: list[RoleAssignmentEntry] = Field(default_factory=list)


class RoleAssignmentsResponse(BaseModel):
    project_defaults: list[RoleAssignmentEntry] = Field(default_factory=list)
    # Only on an asset's response. A role with at least one override uses it
    # instead of the project default.
    overrides: list[RoleAssignmentEntry] = Field(default_factory=list)


class AssetStatusChange(BaseModel):
    status_id: uuid.UUID


class AssetsStatusChange(BaseModel):
    """Several assets of one project to one status."""
    asset_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    status_id: uuid.UUID
