
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


RequestStatus = Literal[
    "submitted",
    "under_review",
    "approved",
    "rejected",
    "correction_requested",
]


class RequestCreate(BaseModel):
    title: str = Field(default="Invoice review", min_length=1, max_length=200)
    submitter: str = Field(default="demo-user", min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=5000)


 


class RequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: str
    submitter: str
    created_at: datetime
    updated_at: datetime
    current_version: int
    notes: str | None = None


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    extracted_text: str | None = None
    extracted_fields: dict[str, Any] | None = None
    verification_result: dict[str, Any] | None = None
    uploaded_at: datetime


class ReviewDecision(BaseModel):
    decision: Literal["approve", "reject", "request_correction"]
    actor: str = Field(default="reviewer", min_length=1, max_length=120)
    reason: str = Field(min_length=3, max_length=2000)
    override_reason: str | None = Field(default=None, max_length=2000)





class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    actor: str
    action: str
    details: dict[str, Any] | None = None
    created_at: datetime


class MessageResponse(BaseModel):
    message: str
class FieldCorrection(BaseModel):
    field: str = Field(min_length=1, max_length=60)
    value: str = Field(max_length=500)
    reason: str = Field(min_length=3, max_length=2000)