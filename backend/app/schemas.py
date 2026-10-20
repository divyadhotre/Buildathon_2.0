from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class RequestCreate(BaseModel):
    title: str = Field(default="Invoice review", max_length=200)
    submitter: str = Field(default="demo-user", max_length=120)


class RequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: str
    submitter: str
    created_at: datetime
    current_version: int
    notes: str | None = None
