from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_actor
from ..database import get_db
from ..models import AuditEvent, ReviewRequest
from ..schemas import RequestCreate, RequestRead


router = APIRouter(prefix="/api/requests", tags=["requests"])


@router.post(
    "",
    response_model=RequestRead,
    status_code=status.HTTP_201_CREATED,
)
def create_request(
    payload: RequestCreate,
    db: Session = Depends(get_db),
    actor: tuple[str, str] = Depends(get_actor),
):
    user, role = actor
    if role != "submitter":
        raise HTTPException(status_code=403, detail="Only submitters can create requests")
    if payload.submitter.strip() != user:
        raise HTTPException(
            status_code=403,
            detail="A request must be created for the authenticated submitter",
        )

    review_request = ReviewRequest(
        title=payload.title.strip(),
        submitter=user,
        notes=payload.notes,
        status="submitted",
        current_version=1,
    )

    db.add(review_request)
    db.flush()

    audit_event = AuditEvent(
        request_id=review_request.id,
        actor=user,
        action="request_created",
        details={
            "title": review_request.title,
            "status": review_request.status,
        },
    )

    db.add(audit_event)
    db.commit()
    db.refresh(review_request)

    return review_request


@router.get("", response_model=list[RequestRead])
def list_requests(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    request_status: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    query = select(ReviewRequest).order_by(ReviewRequest.created_at.desc())

    if request_status:
        query = query.where(ReviewRequest.status == request_status)

    query = query.offset(skip).limit(limit)

    return list(db.scalars(query).all())


@router.get("/{request_id}", response_model=RequestRead)
def get_request(
    request_id: int,
    db: Session = Depends(get_db),
):
    review_request = db.get(ReviewRequest, request_id)

    if review_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review request not found",
        )

    return review_request
