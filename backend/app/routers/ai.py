import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_actor
from ..database import get_db
from ..models import AuditEvent, Document
from ..services.genai_service import (
    SuggestionError,
    generate_suggestion,
    status as ai_status,
)
from .reviews import latest_invoice, load_for_review

router = APIRouter(tags=["ai"])

EVAL_FILE = Path(__file__).resolve().parents[2] / "evaluation" / "results.json"
DECISIONS = ("approve", "reject", "request_correction")


@router.post("/api/requests/{request_id}/ai-suggestion")
def create_ai_suggestion(
    request_id: int,
    db: Session = Depends(get_db),
    actor: tuple[str, str] = Depends(get_actor),
):
    """Generate and store a suggestion. It never changes the request status."""
    _, user = load_for_review(db, request_id, actor)

    invoice = latest_invoice(db, request_id)
    if invoice is None:
        raise HTTPException(status_code=400, detail="Upload a document first")

    po = db.scalars(
        select(Document)
        .where(
            Document.request_id == request_id,
            Document.original_filename.startswith("PO__", autoescape=True),
        )
        .order_by(Document.id.desc())
    ).first()

    try:
        result = generate_suggestion(invoice, po)
    except SuggestionError as exc:
        db.add(AuditEvent(
            request_id=request_id, actor="gemini", action="ai_suggestion_failed",
            details={"document_id": invoice.id, "error": str(exc), "requested_by": user},
        ))
        db.commit()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc

    details = {**result, "document_id": invoice.id, "requested_by": user}
    db.add(AuditEvent(
        request_id=request_id, actor="gemini",
        action="ai_suggestion_generated", details=details,
    ))
    db.commit()
    return details


@router.get("/api/ai/status")
def ai_config_status():
    """Shows whether Gemini is configured (never returns the key)."""
    return ai_status()


def review_times(db: Session) -> dict:
    """Average seconds from opening a request to the decision, from real decisions."""
    events = db.scalars(
        select(AuditEvent).where(AuditEvent.action.in_(DECISIONS))
    ).all()
    groups = {"assisted": [], "manual": []}
    for e in events:
        d = e.details or {}
        seconds = d.get("review_seconds")
        if not isinstance(seconds, (int, float)) or seconds <= 0 or seconds > 1800:
            continue
        groups["assisted" if d.get("ai_source") == "gemini" else "manual"].append(seconds)
    avg = lambda xs: round(sum(xs) / len(xs)) if xs else None
    return {
        "avg_review_seconds_assisted": avg(groups["assisted"]),
        "avg_review_seconds_manual": avg(groups["manual"]),
        "review_time_samples": {k: len(v) for k, v in groups.items()},
    }


@router.get("/api/evaluation")
def evaluation(db: Session = Depends(get_db)):
    result = {}
    if EVAL_FILE.is_file():
        result = json.loads(EVAL_FILE.read_text(encoding="utf-8"))
    result.update(review_times(db))
    return result