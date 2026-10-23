"""
OCR service for the document verification system.

Supports:
- Digital PDFs using PyMuPDF
- Scanned PDFs using Tesseract OCR
- PNG, JPG and JPEG images
- Plain text and Microsoft Word DOCX files

Returns extracted text, page numbers and extraction methods.
OCR results are evidence for review, NOT document approval.
"""

import os
import shutil
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

import pymupdf as fitz
import pytesseract
from PIL import Image, ImageOps, UnidentifiedImageError


SUPPORTED_IMAGE_TYPES = {".png", ".jpg", ".jpeg"}
SUPPORTED_TYPES = SUPPORTED_IMAGE_TYPES | {".pdf", ".txt", ".docx"}
MAX_DOCX_XML_BYTES = 20 * 1024 * 1024

# Safety limit for this initial prototype.
MAX_PDF_PAGES = 100

DEFAULT_TESSERACT_EXE = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")


def _resolve_tesseract_executable() -> Path:
    configured = os.getenv("TESSERACT_CMD")
    if configured:
        return Path(configured)
    on_path = shutil.which("tesseract")
    return Path(on_path) if on_path else DEFAULT_TESSERACT_EXE


def configure_tesseract() -> None:
    """Configure the installed Windows Tesseract executable."""
    executable = _resolve_tesseract_executable()
    if not executable.is_file():
        raise FileNotFoundError(
            "Tesseract OCR is unavailable. Install it or set TESSERACT_CMD "
            "to the executable's full path."
        )

    pytesseract.pytesseract.tesseract_cmd = str(executable)



def _ocr_image(image: Image.Image) -> str:
    """Read printed English text from an image."""
    image = ImageOps.exif_transpose(image)
    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        image = Image.alpha_composite(background, rgba).convert("RGB")
    else:
        image = image.convert("RGB")

    longest_side = max(image.size)
    if longest_side < 1200:
        scale = min(2.5, 1200 / longest_side)
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)),
            Image.Resampling.LANCZOS,
        )

    image = ImageOps.grayscale(image)
    image = ImageOps.autocontrast(image)

    return pytesseract.image_to_string(
        image,
        lang="eng",
        config="--psm 6",
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


def _extract_text_file(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("The text file must use UTF-8 encoding.") from exc
    if "\x00" in text:
        raise ValueError("The text file contains invalid binary data.")
    return {
        "text": text,
        "page_count": 1,
        "pages": [{"page_number": 1, "text": text, "method": "plain_text"}],
    }


def _extract_docx(path: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(path) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise ValueError("The Word document contains too much text to process.")
            xml = archive.read(info)
        if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
            raise ValueError("The Word document contains unsupported XML declarations.")
        root = ET.fromstring(xml)
    except (KeyError, zipfile.BadZipFile, ET.ParseError) as exc:
        raise ValueError("The Word document is damaged or invalid.") from exc
    paragraphs = []
    for paragraph in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
        value = "".join(
            node.text or ""
            for node in paragraph.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
        )
        if value.strip():
            paragraphs.append(value)
    text = "\n".join(paragraphs)
    return {
        "text": text,
        "page_count": 1,
        "pages": [{"page_number": 1, "text": text, "method": "docx_text"}],
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

                # Only require OCR when the page has no embedded text.
                if not text:
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
            "Unsupported file type. Upload PDF, PNG, JPG, JPEG, TXT or DOCX."
        )

    try:
        if suffix == ".pdf":
            # Try ordinary PDF text extraction first.
            # The PDF helper uses OCR only when a page needs it.
            result = _extract_pdf(path)
        elif suffix in SUPPORTED_IMAGE_TYPES:
            configure_tesseract()
            result = _extract_image(path)
        elif suffix == ".txt":
            result = _extract_text_file(path)
        else:
            result = _extract_docx(path)

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
