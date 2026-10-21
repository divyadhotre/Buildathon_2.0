import hashlib
from pathlib import Path
from uuid import uuid4

import fitz
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import AuditEvent, Document, ReviewRequest
from ..schemas import DocumentRead


router = APIRouter(prefix="/api/requests", tags=["documents"])

MAX_FILE_SIZE = settings.max_upload_mb * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/octet-stream",
}


@router.post(
    "/{request_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    request_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    review_request = db.get(ReviewRequest, request_id)

    if review_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review request not found",
        )

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A filename is required",
        )

    content_type = (file.content_type or "").lower()

    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF documents are supported",
        )

    contents = await file.read(MAX_FILE_SIZE + 1)

    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is empty",
        )

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {settings.max_upload_mb} MB limit",
        )

    if not contents.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="The uploaded file is not a valid PDF",
        )

    try:
        with fitz.open(stream=contents, filetype="pdf") as pdf:
            if pdf.page_count < 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="The PDF contains no pages",
                )

            extracted_text = "\n".join(
                page.get_text() for page in pdf
            ).strip()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The PDF file is damaged or cannot be opened",
        ) from exc

    original_filename = Path(file.filename.replace("\\", "/")).name
    original_filename = original_filename[:255]

    stored_filename = f"{uuid4().hex}.pdf"
    storage_path = settings.upload_path / stored_filename
    file_hash = hashlib.sha256(contents).hexdigest()

    document = Document(
        request_id=request_id,
        original_filename=original_filename,
        stored_filename=stored_filename,
        storage_path=str(storage_path.resolve()),
        mime_type="application/pdf",
        size_bytes=len(contents),
        sha256=file_hash,
        extracted_text=extracted_text or None,
    )

    try:
        settings.upload_path.mkdir(parents=True, exist_ok=True)
        storage_path.write_bytes(contents)

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
                },
            )
        )

        db.commit()
        db.refresh(document)

    except Exception as exc:
        db.rollback()

        try:
            storage_path.unlink(missing_ok=True)
        except OSError:
            pass

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save the uploaded document",
        ) from exc

    finally:
        await file.close()

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
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review request not found",
        )

    return (
        db.query(Document)
        .filter(Document.request_id == request_id)
        .order_by(Document.uploaded_at.desc())
        .all()
    )
