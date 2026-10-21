"""PDF text extraction and OCR fallback to be implemented.

Suggested flow:
1. Try PyMuPDF text extraction for digital PDFs.
2. If text is absent/insufficient, render pages and run Tesseract OCR.
3. Return text with page numbers and extraction method.
4. Surface errors as processing failures, never as approvals.
"""

"""
OCR service for the Buildathon 2.0 document verification system.

Supports:
- Digital PDFs using PyMuPDF
- Scanned PDFs using Tesseract OCR
- PNG, JPG and JPEG images

Returns extracted text, page numbers and extraction methods.
OCR results are evidence for review, NOT document approval.
"""

from pathlib import Path
from typing import Any

import pymupdf as fitz
import pytesseract
from PIL import Image, ImageOps, UnidentifiedImageError


SUPPORTED_IMAGE_TYPES = {".png", ".jpg", ".jpeg"}
SUPPORTED_TYPES = SUPPORTED_IMAGE_TYPES | {".pdf"}

# The default Windows installation path. If Tesseract is on PATH,
# pytesseract can usually find it without this setting.
import shutil

TESSERACT_EXE = Path(
    shutil.which("tesseract")
    or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

# Safety limit for this initial prototype.
MAX_PDF_PAGES = 100


TESSERACT_EXE = Path(
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)


def configure_tesseract() -> None:
    """Configure the installed Windows Tesseract executable."""
    if not TESSERACT_EXE.is_file():
        raise FileNotFoundError(
            f"Tesseract executable not found: {TESSERACT_EXE}"
        )

    pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)



def _ocr_image(image: Image.Image) -> str:
    """Read printed English text from an image."""
    image = ImageOps.exif_transpose(image)
    image = ImageOps.grayscale(image)
    image = ImageOps.autocontrast(image)

    return pytesseract.image_to_string(
        image,
        lang="eng",
        config="--psm 3",
    ).strip()


def _extract_image(path: Path) -> dict[str, Any]:
    """Extract text from an uploaded image."""
    try:
        with Image.open(path) as image:
            text = _ocr_image(image.copy())
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError(
            "The image is invalid, damaged or unsupported."
        ) from exc

    return {
        "text": text,
        "page_count": 1,
        "pages": [
            {
                "page_number": 1,
                "text": text,
                "method": "tesseract_ocr",
            }
        ],
    }


def _extract_pdf(path: Path) -> dict[str, Any]:
    """Extract digital PDF text, using OCR when a page needs it."""
    pages: list[dict[str, Any]] = []

    try:
        with fitz.open(path) as document:
            if document.needs_pass:
                raise ValueError(
                    "Password-protected PDFs cannot be processed."
                )

            if document.page_count == 0:
                raise ValueError("The PDF has no pages.")

            if document.page_count > MAX_PDF_PAGES:
                raise ValueError(
                    f"PDF exceeds the {MAX_PDF_PAGES}-page limit."
                )

            for page_index, page in enumerate(document):
                # First attempt: extract embedded/selectable text.
                text = page.get_text("text").strip()
                method = "pdf_text"

                # If a page has little or no text, try OCR.
                # This also helps with PDFs containing a scanned page
                # alongside pages with selectable text.
                if len(text) < 20:
                    configure_tesseract()
                    pixmap = page.get_pixmap(
                        matrix=fitz.Matrix(2, 2),
                        colorspace=fitz.csRGB,
                        alpha=False,
                    )

                    image = Image.frombytes(
                        "RGB",
                        (pixmap.width, pixmap.height),
                        pixmap.samples,
                    )
                    ocr_text = _ocr_image(image)

                    if len(ocr_text) > len(text):
                        text = ocr_text
                        method = "tesseract_ocr"

                pages.append(
                    {
                        "page_number": page_index + 1,
                        "text": text,
                        "method": method,
                    }
                )

    except (fitz.FileDataError, RuntimeError) as exc:
        if isinstance(exc, RuntimeError) and str(exc).startswith(
            "PDF exceeds"
        ):
            raise
        raise ValueError(
            "The PDF is damaged or could not be processed."
        ) from exc

    combined_text = "\n\n".join(
        f"--- Page {page['page_number']} ---\n{page['text']}"
        for page in pages
    ).strip()

    return {
        "text": combined_text,
        "page_count": len(pages),
        "pages": pages,
    }



def extract_text(file_path: str | Path) -> dict[str, Any]:
    """
    Extract document text and return a structured result.
    Digital PDFs can be processed without Tesseract.
    Scanned PDFs and images require Tesseract OCR.
    """
    path = Path(file_path)

    if not path.exists() or not path.is_file():
        raise FileNotFoundError("The document file was not found.")

    suffix = path.suffix.lower()

    if suffix not in SUPPORTED_TYPES:
        raise ValueError(
            "Unsupported file type. Upload PDF, PNG, JPG or JPEG."
        )

    try:
        if suffix == ".pdf":
            # Try ordinary PDF text extraction first.
            # The PDF helper uses OCR only when a page needs it.
            result = _extract_pdf(path)
        else:
            configure_tesseract()
            result = _extract_image(path)

    except pytesseract.TesseractNotFoundError as exc:
        raise RuntimeError(
            "Tesseract OCR was not found. Check its installation and PATH."
        ) from exc
    except pytesseract.TesseractError as exc:
        raise RuntimeError(
            "Tesseract could not process the document. "
            "Check that English language data is installed."
        ) from exc

    text = result["text"]

    return {
        "filename": path.name,
        "status": "success" if text.strip() else "needs_review",
        "text": text,
        "pages": result["pages"],
        "page_count": result["page_count"],
        "character_count": len(text),
        "message": (
            "Text extracted. Continue to document verification."
            if text.strip()
            else "No readable text found. Manual review is required."
        ),
    }
