from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import DECIDERS, get_actor
from ..database import get_db
from ..models import AuditEvent, Document, ReviewRequest
from ..schemas import (
    AuditEventRead,
    FieldCorrection,
    RequestRead,
    ReviewDecision,
)

router = APIRouter(tags=["reviews"])

FINAL_STATUSES = {"approved", "rejected"}
EDITABLE_FIELDS = {
    "supplier", "invoice_number", "date",
    "purchase_order", "subtotal", "tax", "total",
}
DECISION_STATUS = {
    "approve": "approved",
    "reject": "rejected",
    "request_correction": "correction_requested",
}


def latest_invoice(db: Session, request_id: int) -> Document | None:
    """Current invoice = newest document that is not a PO (PO__ prefix)."""
    docs = db.scalars(
        select(Document)
        .where(Document.request_id == request_id)
        .order_by(Document.id.desc())
    ).all()
    return next(
        (d for d in docs if not d.original_filename.startswith("PO__")),
        None,
    )


def automated_suggestion(document: Document) -> str:
    """Rule-based suggestion only. A human always decides."""
    fields = document.extracted_fields or {}
    result = document.verification_result or {}
    if fields.get("extraction_status") == "failed":
        return "manual_review"
    if result.get("status") == "needs_review":
        return "request_correction"
    return "approve"

def stored_ai_suggestion(db: Session, request_id: int, document_id: int):
    """Latest Gemini suggestion saved for this document, or None."""
    events = db.scalars(
        select(AuditEvent)
        .where(
            AuditEvent.request_id == request_id,
            AuditEvent.action == "ai_suggestion_generated",
        )
        .order_by(AuditEvent.id.desc())
    ).all()
    for event in events:
        d = event.details or {}
        if d.get("document_id") == document_id and d.get("action") in DECISION_STATUS:
            return d
    return None

def load_for_review(db: Session, request_id: int, actor: tuple[str, str]):
    user, role = actor
    review_request = db.get(ReviewRequest, request_id)

    if review_request is None:
        raise HTTPException(status_code=404, detail="Review request not found")
    if role not in DECIDERS:
        raise HTTPException(
            status_code=403, detail="Your role cannot review requests"
        )
    if user == review_request.submitter:
        raise HTTPException(
            status_code=403,
            detail="You cannot review a request you submitted",
        )
    if review_request.status in FINAL_STATUSES:
        raise HTTPException(
            status_code=409, detail="A final decision is already recorded"
        )
    return review_request, user


@router.post(
    "/api/requests/{request_id}/decision",
    response_model=RequestRead,
)
def record_decision(
    request_id: int,
    payload: ReviewDecision,
    db: Session = Depends(get_db),
    actor: tuple[str, str] = Depends(get_actor),
):
    review_request, user = load_for_review(db, request_id, actor)

    document = latest_invoice(db, request_id)
    if document is None:
        raise HTTPException(
            status_code=400,
            detail="Upload a document before recording a decision",
        )

    suggestion = automated_suggestion(document)

    # Extraction failure still blocks approval, whatever anyone suggests.
    if (
        payload.decision == "approve"
        and automated_suggestion(document) == "manual_review"
    ):
        raise HTTPException(
            status_code=400,
            detail="Extraction failed. Approval is blocked; request a "
                   "correction or reject.",
        )

    ai = stored_ai_suggestion(db, request_id, document.id)
    suggestion = ai["action"] if ai else None
    override = (payload.override_reason or "").strip()

    if suggestion and suggestion != payload.decision and not override:
        raise HTTPException(
            status_code=400,
            detail="You disagree with the AI suggestion. "
                   "An override reason is required.",
        )
   

    previous_status = review_request.status
    review_request.status = DECISION_STATUS[payload.decision]

    db.add(
        AuditEvent(
            request_id=request_id,
            actor=user,
            action=payload.decision,
            details={
                "reason": payload.reason.strip(),
                "previous_status": previous_status,
                "new_status": review_request.status,
                "document_id": document.id,
                "ai_suggestion": suggestion,
                "ai_source": "gemini" if ai else None,
                "override_reason": override or None,
                "review_seconds": payload.review_seconds,
            },
        )
    )

    try:
        db.commit()
        db.refresh(review_request)
    except Exception:
        db.rollback()
        raise

    return review_request


@router.post(
    "/api/requests/{request_id}/corrections",
    response_model=AuditEventRead,
    status_code=status.HTTP_201_CREATED,
)
def correct_field(
    request_id: int,
    payload: FieldCorrection,
    db: Session = Depends(get_db),
    actor: tuple[str, str] = Depends(get_actor),
):
    _, user = load_for_review(db, request_id, actor)

    if payload.field not in EDITABLE_FIELDS:
        raise HTTPException(status_code=400, detail="Unknown field")

    document = latest_invoice(db, request_id)
    if document is None:
        raise HTTPException(status_code=400, detail="No invoice uploaded")

    earlier = db.scalars(
        select(AuditEvent)
        .where(
            AuditEvent.request_id == request_id,
            AuditEvent.action == "field_corrected",
        )
        .order_by(AuditEvent.id.desc())
    ).all()
    previous = next(
        (
            e.details.get("new_value")
            for e in earlier
            if e.details
            and e.details.get("field") == payload.field
            and e.details.get("document_id") == document.id
        ),
        None,
    )
    if previous is None:
        extracted = (document.extracted_fields or {}).get("fields", {})
        previous = (extracted.get(payload.field) or {}).get("value")

    event = AuditEvent(
        request_id=request_id,
        actor=user,
        action="field_corrected",
        details={
            "document_id": document.id,
            "field": payload.field,
            "previous_value": previous,
            "new_value": payload.value.strip(),
            "reason": payload.reason.strip(),
        },
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("/api/documents/{document_id}/file")
def document_file(document_id: int, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if document is None or not Path(document.storage_path).is_file():
        raise HTTPException(status_code=404, detail="Document file not found")
    return FileResponse(
        document.storage_path,
        media_type="application/pdf",
        filename=document.original_filename,
        content_disposition_type="inline",
    )


@router.get(
    "/api/audit",
    response_model=list[AuditEventRead],
)
def list_audit_events(
    request_id: int | None = Query(default=None, ge=1),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = select(AuditEvent).order_by(
        AuditEvent.created_at.desc(),
        AuditEvent.id.desc(),
    )

    if request_id is not None:
        query = query.where(AuditEvent.request_id == request_id)

    query = query.offset(skip).limit(limit)

    return list(db.scalars(query).all())