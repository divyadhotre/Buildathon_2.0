from datetime import datetime, timezone
from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


def utc_now():
    return datetime.now(timezone.utc)


class ReviewRequest(Base):
    __tablename__ = "review_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), default="Invoice review")
    status: Mapped[str] = mapped_column(String(40), default="submitted", index=True)
    submitter: Mapped[str] = mapped_column(String(120), default="demo-user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    current_version: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
