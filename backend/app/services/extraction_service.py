
"""Extract structured invoice fields from OCR/PDF text.

Extracted values are suggestions for review, not authoritative facts.
Each field includes its value, confidence, and supporting text evidence.
"""

import re
from typing import Any


FIELD_PATTERNS = {
    "supplier": [
        r"(?im)^\s*(?:vendor|supplier)\s*:?\s*\n\s*([^\n]+)",
        r"(?im)^\s*(?:vendor|supplier)\s*:\s*([^\n]+)",
    ],
    "invoice_number": [
        r"(?im)^\s*invoice\s*(?:number|no\.?|#)\s*:?\s*\n?\s*([A-Z0-9][A-Z0-9/_-]*)",
    ],
    "date": [
        r"(?im)^\s*invoice\s*date\s*:?\s*\n?\s*([^\n]+)",
    ],
    "purchase_order": [
        r"(?im)^\s*(?:purchase\s*order|PO)\s*(?:number|no\.?|#)?\s*:?\s*\n?\s*([A-Z0-9][A-Z0-9/_-]*)",
    ],
    "subtotal": [
        r"(?im)^\s*(?:taxable\s+)?subtotal\s*:?\s*\n?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
    ],
    "tax": [
        r"(?im)^\s*(?:GST(?:\s*\([^)]*\))?|tax)\s*:?\s*\n?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
    ],
    "total": [
        r"(?im)^\s*(?:grand\s+total|total\s+amount|total)\s*:?\s*\n?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
    ],
}


def _normalise_text(text: str) -> str:
    """Return text with consistent line endings."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _not_found() -> dict[str, Any]:
    """Return a consistent result for a missing or invalid field."""
    return {
        "value": None,
        "confidence": 0.0,
        "evidence": None,
        "source": "not_found",
    }


def _find_field(
    text: str,
    patterns: list[str],
    pages: list[dict[str, Any]],
) -> dict[str, Any]:
    """Find a field using multiple patterns and retain page evidence."""

    invalid_placeholders = (
        "missing",
        "test case",
        "not provided",
        "not available",
        "n/a",
        "none",
        "null",
    )

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)

        if not match:
            continue

        value = match.group(1).strip()

        # Reject placeholders instead of treating them as real data.
        if not value or any(
            marker in value.lower()
            for marker in invalid_placeholders
        ):
            continue

        # Find the source page containing the extracted value.
        evidence_page = None
        evidence_text = None

        for index, page in enumerate(pages):
            page_text = _normalise_text(str(page.get("text") or ""))

            if value.lower() in page_text.lower():
                evidence_page = page.get("page_number", index + 1)

                lines = page_text.splitlines()
                for line_index, line in enumerate(lines):
                    if value.lower() in line.lower():
                        start = max(0, line_index - 1)
                        end = min(len(lines), line_index + 2)
                        evidence_text = "\n".join(lines[start:end])
                        break

                break

        # Fall back to the full OCR text if page-level evidence is unavailable.
        if evidence_text is None:
            lines = text.splitlines()
            match_line = text[:match.start(1)].count("\n")
            start = max(0, match_line - 1)
            end = min(len(lines), match_line + 2)
            evidence_text = "\n".join(lines[start:end])

        return {
            "value": value,
            "confidence": 0.9,
            "evidence": {
                "page": evidence_page or 1,
                "snippet": evidence_text,
            },
            "source": "regex_text_match",
        }

    return _not_found()


def _parse_amount(value: Any) -> float | None:
    """Convert a formatted amount into a number, if possible."""
    if value is None:
        return None

    cleaned = (
        str(value)
        .replace(",", "")
        .replace("INR", "")
        .replace("Rs.", "")
        .replace("₹", "")
        .strip()
    )

    try:
        return round(float(cleaned), 2)
    except (TypeError, ValueError):
        return None


def extract_fields(ocr_result: dict[str, Any]) -> dict[str, Any]:
    """Extract invoice fields from the OCR service result."""
    text = _normalise_text(str(ocr_result.get("text") or ""))
    pages = ocr_result.get("pages") or []

    fields: dict[str, Any] = {}

    for field_name, patterns in FIELD_PATTERNS.items():
        fields[field_name] = _find_field(text, patterns, pages)

    # Preserve raw amounts and also provide parsed numeric values.
    for name in ("subtotal", "tax", "total"):
        fields[name]["numeric_value"] = _parse_amount(
            fields[name]["value"]
        )

    return {
        "filename": ocr_result.get("filename"),
        "extraction_status": (
            "success"
            if any(field["value"] for field in fields.values())
            else "needs_review"
        ),
        "fields": fields,
        "review_note": (
            "Automatically extracted values must be checked by a reviewer."
        ),
    }
