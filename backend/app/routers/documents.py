
import hashlib
from io import BytesIO
import logging
from pathlib import Path
from uuid import uuid4

import pymupdf as fitz
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from ..auth import get_actor
from ..config import settings
from ..database import get_db
from ..models import AuditEvent, Document, ReviewRequest
from ..schemas import DocumentRead
from ..services.ocr_service import extract_text
from ..services.extraction_service import extract_fields
from ..services.verification_service import verify_document
from ..services.genai_service import SuggestionError, generate_suggestion

router = APIRouter(prefix="/api/requests", tags=["documents"])
logger = logging.getLogger(__name__)

MAX_FILE_SIZE = settings.max_upload_mb * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
}
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".txt", ".docx"}
MIME_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _store_ai_review(db: Session, request_id: int, document: Document, user: str) -> None:
    """Persist an advisory review result or an explicit failure for this version."""
    try:
        suggestion = generate_suggestion(document)
        suggestion_available = suggestion.get("suggestion_available") is True
        db.add(AuditEvent(
            request_id=request_id,
            actor=(
                "gemini"
                if suggestion_available
                and not str(suggestion.get("model") or "").startswith("Built-in")
                else "system"
            ),
            action=(
                "ai_suggestion_generated"
                if suggestion_available
                else "ai_human_review_required"
            ),
            details={
                **suggestion,
                "document_id": document.id,
                "requested_by": user,
                "trigger": "document_submission",
            },
        ))
    except SuggestionError as exc:
        db.add(AuditEvent(
            request_id=request_id,
            actor="gemini",
            action="ai_suggestion_failed",
            details={
                "document_id": document.id,
                "error": str(exc),
                "requested_by": user,
                "trigger": "document_submission",
            },
        ))
    except Exception:
        logger.exception(
            "AI suggestion failed unexpectedly for document %s",
            document.id,
        )
        db.add(AuditEvent(
            request_id=request_id,
            actor="system",
            action="ai_suggestion_failed",
            details={
                "document_id": document.id,
                "error": "Unexpected AI review error. Check the backend logs.",
                "requested_by": user,
                "trigger": "document_submission",
            },
        ))
    db.commit()


@router.post(
    "/{request_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    request_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    actor: tuple[str, str] = Depends(get_actor),
):
    user, role = actor
    if role != "submitter":
        await file.close()
        raise HTTPException(
            status_code=403,
            detail="Only submitters can upload documents",
        )

    review_request = db.get(ReviewRequest, request_id)

    if review_request is None:
        await file.close()
        raise HTTPException(
            status_code=404,
            detail="Review request not found",
        )

    if review_request.submitter != user:
        await file.close()
        raise HTTPException(
            status_code=403,
            detail="You can upload documents only to your own request",
        )

    if not file.filename:
        await file.close()
        raise HTTPException(
            status_code=400,
            detail="A filename is required",
        )

    is_reference_upload = file.filename.startswith("PO__")
    primary_documents = [
        document for document in review_request.documents
        if not document.original_filename.startswith("PO__")
    ]
    if review_request.status == "submitted":
        if is_reference_upload:
            await file.close()
            raise HTTPException(
                status_code=409,
                detail="Upload the main document before attaching a purchase order",
            )
    elif review_request.status == "correction_requested":
        if is_reference_upload:
            await file.close()
            raise HTTPException(
                status_code=409,
                detail="A correction resubmission must replace the main document",
            )
    elif review_request.status == "under_review" and is_reference_upload and primary_documents:
        pass
    else:
        await file.close()
        raise HTTPException(
            status_code=409,
            detail="Documents can be uploaded only for a new submission or an outstanding correction request",
        )

    content_type = (file.content_type or "").lower()

    extension = Path(file.filename.replace("\\", "/")).suffix.lower()
    if content_type not in ALLOWED_CONTENT_TYPES or extension not in ALLOWED_EXTENSIONS:
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="Supported formats are PDF, PNG, JPG, JPEG, TXT and DOCX",
        )

    try:
        contents = await file.read(MAX_FILE_SIZE + 1)
    finally:
        await file.close()

    if not contents:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is empty",
        )

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.max_upload_mb} MB limit",
        )

    try:
        if extension == ".pdf":
            if not contents.startswith(b"%PDF-"):
                raise HTTPException(
                    status_code=415,
                    detail="The uploaded file is not a valid PDF",
                )
            with fitz.open(stream=contents, filetype="pdf") as pdf:
                if pdf.page_count < 1:
                    raise HTTPException(
                        status_code=400,
                        detail="The PDF contains no pages",
                    )
        elif extension in {".png", ".jpg", ".jpeg"}:
            with Image.open(BytesIO(contents)) as image:
                image.verify()
            expected_format = "PNG" if extension == ".png" else "JPEG"
            with Image.open(BytesIO(contents)) as image:
                if image.format != expected_format:
                    raise HTTPException(
                        status_code=415,
                        detail="The file extension does not match its image format",
                    )
                if image.width * image.height > 100_000_000:
                    raise HTTPException(
                        status_code=413,
                        detail="The image dimensions exceed the supported limit",
                    )
        elif extension == ".docx":
            import zipfile

            with zipfile.ZipFile(BytesIO(contents)) as archive:
                if "word/document.xml" not in archive.namelist():
                    raise HTTPException(
                        status_code=400,
                        detail="The Word document is missing its main content",
                    )
        else:
            try:
                text = contents.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise HTTPException(
                    status_code=415,
                    detail="Text files must use UTF-8 encoding",
                ) from exc
            if "\x00" in text:
                raise HTTPException(
                    status_code=415,
                    detail="The text file contains invalid binary data",
                )
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="The image is damaged or cannot be opened",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="The document is damaged or cannot be opened",
        ) from exc

    original_filename = Path(
        file.filename.replace("\\", "/")
    ).name[:255]

    stored_filename = f"{uuid4().hex}{extension}"
    storage_path = settings.upload_path / stored_filename
    file_hash = hashlib.sha256(contents).hexdigest()
    mime_type = MIME_TYPES[extension]

    try:
        settings.upload_path.mkdir(parents=True, exist_ok=True)
        storage_path.write_bytes(contents)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail="Unable to store the uploaded document",
        ) from exc

    # M2 processing: OCR/text extraction -> field extraction -> verification.
    try:
        ocr_result = extract_text(storage_path)
        extraction_result = extract_fields(ocr_result)
        verification_result = verify_document(extraction_result)

        extracted_text = ocr_result.get("text") or None
        extracted_fields = extraction_result

    except Exception:
        logger.exception("Document extraction or verification failed")
        # Keep the uploaded document available for manual review.
        extracted_text = None
        extracted_fields = {
            "filename": original_filename,
            "extraction_status": "failed",
            "document_type": "unknown",
            "classification_confidence": 0.0,
            "classification_evidence": (
                "Classification unavailable because text extraction failed."
            ),
            "fields": {},
            "review_note": (
                "Automatic extraction failed. Manual review is required."
            ),
        }
        verification_result = {
            "status": "needs_review",
            "findings": [
                {
                    "rule_id": "document_processing",
                    "status": "not_performed",
                    "category": "unavailable_evidence",
                    "message": "Automatic document processing failed.",
                }
            ],
            "approval_decision": "human_review_required",
            "message": (
                "The document was stored, but manual review is required."
            ),
        }

    document = Document(
        request_id=request_id,
        original_filename=original_filename,
        stored_filename=stored_filename,
        storage_path=str(storage_path.resolve()),
        mime_type=mime_type,
        size_bytes=len(contents),
        sha256=file_hash,
        extracted_text=extracted_text,
        extracted_fields=extracted_fields,
        verification_result=verification_result,
    )

    try:
        db.add(document)
        db.flush()

        db.add(
            AuditEvent(
                request_id=request_id,
                actor=review_request.submitter,
                action="document_uploaded",
                details={
                    "document_id": document.id,
                    "filename": original_filename,
                    "size_bytes": len(contents),
                    "sha256": file_hash,
                    "extraction_status": extracted_fields.get(
                        "extraction_status", "unknown"
                    ),
                    "verification_status": verification_result.get(
                        "status", "needs_review"
                    ),
                },
            )
        )

        flagged = [
            f for f in (verification_result.get("findings") or [])
            if isinstance(f, dict) and f.get("status") == "flag"
        ]
        db.add(AuditEvent(
            request_id=request_id, actor="system",
            action="extraction_completed",
            details={
                "document_id": document.id,
                "extraction_status": extracted_fields.get(
                    "extraction_status", "unknown"),
            },
        ))
        db.add(AuditEvent(
            request_id=request_id, actor="system",
            action="verification_completed",
            details={
                "document_id": document.id,
                "verification_status": verification_result.get(
                    "status", "needs_review"),
                "flags": len(flagged),
            },
        ))
        if not is_reference_upload and review_request.status in ("submitted", "correction_requested"):
            previous_status = review_request.status
            if previous_status == "correction_requested":
                review_request.current_version += 1
            review_request.status = "under_review"
            db.add(AuditEvent(
                request_id=request_id, actor=user,
                action=(
                    "document_resubmitted"
                    if previous_status == "correction_requested"
                    else "moved_to_review"
                ),
                details={
                    "previous_status": previous_status,
                    "new_status": "under_review",
                    "document_id": document.id,
                    "version": review_request.current_version,
                },
            ))

        db.commit()
        db.refresh(document)

    except Exception as exc:
        db.rollback()
        try:
            storage_path.unlink(missing_ok=True)
        except OSError:
            pass

        raise HTTPException(
            status_code=500,
            detail="Unable to save the uploaded document",
        ) from exc

    if not is_reference_upload:
        _store_ai_review(db, request_id, document, user)

    return document


@router.get(
    "/{request_id}/documents",
    response_model=list[DocumentRead],
)
def list_documents(
    request_id: int,
    db: Session = Depends(get_db),
):
    review_request = db.get(ReviewRequest, request_id)

    if review_request is None:
        raise HTTPException(
            status_code=404,
            detail="Review request not found",
        )

    return (
        db.query(Document)
        .filter(Document.request_id == request_id)
        .order_by(Document.uploaded_at.desc())
        .all()
    )
