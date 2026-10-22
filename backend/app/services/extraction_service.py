
"""Extract structured fields from OCR/PDF text.

Extracted values are suggestions for review, not authoritative facts.
Each field includes its value, confidence, and supporting text evidence.
"""

import math
import re
from typing import Any


FIELD_LABELS = {
    "supplier": (
        r"vendor(?:\s+name)?", r"supplier(?:\s+name)?", r"seller",
        r"merchant(?:\s+name)?",
    ),
    "buyer": (
        r"buyer(?:\s+name)?", r"customer(?:\s+name)?", r"bill\s+to",
        r"billed\s+to", r"client",
    ),
    "invoice_number": (
        r"invoice\s*(?:number|no\.?|#|id)", r"bill\s*(?:number|no\.?|#)",
    ),
    "po_number": (
        r"purchase\s*order\s*(?:number|no\.?|#|id)",
        r"p\.?\s*o\.?\s*(?:number|no\.?|#|id)",
        r"order\s*(?:number|no\.?|#|id)",
    ),
    "receipt_number": (
        r"receipt\s*(?:number|no\.?|#|id)",
        r"transaction\s*(?:id|number|no\.?|#)",
        r"reference\s*(?:number|no\.?|#)",
    ),
    "certificate_id": (
        r"certificate\s*(?:number|no\.?|#|id)",
        r"certification\s*(?:number|no\.?|#|id)",
    ),
    "date": (r"invoice\s+date", r"transaction\s+date", r"receipt\s+date", r"date"),
    "order_date": (r"order\s+date", r"purchase\s+date", r"date\s+ordered"),
    "due_date": (r"due\s+date", r"payment\s+due"),
    "effective_date": (r"effective\s+date", r"commencement\s+date", r"start\s+date"),
    "expiry_date": (r"expiry\s+date", r"expiration\s+date", r"end\s+date", r"expires"),
    "subtotal": (r"taxable\s+subtotal", r"sub\s*total", r"subtotal"),
    "tax": (r"sales\s+tax", r"gst(?:\s*\([^)]*\))?", r"vat", r"tax"),
    "total": (
        r"grand\s+total", r"total\s+amount", r"amount\s+due", r"balance\s+due",
        r"total\s+due", r"order\s+total", r"amount\s+paid", r"total",
    ),
    "currency": (r"currency",),
    "payment_method": (r"payment\s+method", r"paid\s+by", r"tender"),
    "delivery_address": (r"ship\s+to", r"deliver\s+to", r"delivery\s+address"),
    "contract_title": (r"contract\s+title", r"agreement\s+title"),
    "contract_type": (r"contract\s+type", r"agreement\s+type"),
    "parties": (r"parties", r"contracting\s+parties"),
    "contract_value": (r"contract\s+value", r"agreement\s+value", r"total\s+contract\s+price"),
    "payment_terms": (r"payment\s+terms", r"payment\s+schedule"),
}

DOCUMENT_TYPE_PATTERNS = {
    "invoice": (
        (r"(?im)^\s*(?:tax\s+)?invoice(?:\s+statement)?\s*$", 4),
        (r"\binvoice\s*(?:number|no\.?|#|id)\b", 3),
        (r"\binvoice\s+date\b", 2),
        (r"\bamount\s+due\b|\bbalance\s+due\b|\btotal\s+due\b", 2),
        (r"\bsubtotal\b", 1),
        (r"\bvendor\b|\bsupplier\b", 1),
    ),
    "purchase_order": (
        (r"(?im)^\s*(?:purchase\s+order|p\.?\s*o\.?)\s*$", 4),
        (r"\bpurchase\s*order\s*(?:number|no\.?|#|id)\b", 3),
        (r"\bp\.?\s*o\.?\s*(?:number|no\.?|#|id)\b", 3),
        (r"\border\s+date\b", 2),
        (r"\bship\s+to\b|\bdeliver\s+to\b", 1),
        (r"\bquantity\b|\bqty\b", 1),
    ),
    "receipt": (
        (r"(?im)^\s*(?:payment\s+)?receipt\s*$", 4),
        (r"\btransaction\s*(?:id|number|no\.?|#)\b", 3),
        (r"\bamount\s+paid\b|\bpayment\s+method\b", 2),
        (r"\bchange\s+due\b|\bthank\s+you\s+for\s+your\s+purchase\b", 1),
        (r"\bmerchant\b|\bstore\s*#\b", 1),
    ),
    "contract": (
        (r"(?im)^\s*(?:service\s+)?(?:agreement|contract)\s*$", 4),
        (r"\bservice\s+agreement\b|\bcontract\s+agreement\b", 4),
        (r"\bcontract\s*(?:number|no\.?|#|id)\b", 3),
        (r"\bthis\s+(?:agreement|contract)\s+is\s+(?:made|entered)\b", 3),
        (r"\bbetween\s+.{2,100}\s+and\s+.{2,100}", 2),
        (r"\beffective\s+date\b|\bparties\s+agree\b", 1),
    ),
    "certificate": (
        (r"\bcertificate\s+of\b", 3),
        (r"(?im)^\s*certificate\s*$", 3),
        (r"(?im)^\s*membership\s+certificate\s*$", 3),
        (r"\bhereby\s+certif(?:y|ies)\b|\bcertification\s+number\b", 2),
    ),
}

DOCUMENT_TYPES = {
    "invoice", "purchase_order", "receipt", "contract", "certificate",
    "unknown",
}


def _normalise_text(text: str) -> str:
    """Return text with consistent line endings."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def classify_document(text: str, extraction_status: str = "success") -> dict[str, Any]:
    """Score several independent document indicators and return supporting evidence."""
    normalized = _normalise_text(str(text or ""))
    if extraction_status == "failed" or not normalized.strip():
        reason = (
            "Classification unavailable because text extraction failed."
            if extraction_status == "failed"
            else "No readable text was available for classification."
        )
        return {"type": "unknown", "confidence": 0.0, "evidence": reason}

    scored: list[tuple[int, str, list[str]]] = []
    for document_type, patterns in DOCUMENT_TYPE_PATTERNS.items():
        matches = []
        score = 0
        for pattern, weight in patterns:
            match = re.search(pattern, normalized, re.IGNORECASE)
            if match:
                score += weight
                matches.append(match.group(0))
        scored.append((score, document_type, matches))

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_type, matches = scored[0]
    second_score = scored[1][0]
    minimum_score = 3 if best_type == "invoice" else 2
    margin = best_score - second_score
    if best_score < minimum_score or margin < 2:
        confidence = min(0.49, round(best_score / max(best_score + second_score + 3, 3), 2))
        evidence = (
            f"Ambiguous indicators for {best_type.replace('_', ' ')}: {', '.join(matches[:3])}."
            if best_score
            else "No supported document-type indicators were found."
        )
        return {"type": "unknown", "confidence": confidence, "evidence": evidence[:240]}

    confidence = min(0.98, round(0.48 + best_score * 0.055 + margin * 0.045, 2))
    return {
        "type": best_type,
        "confidence": confidence,
        "evidence": f"Matched text: {', '.join(matches[:3])}."[:240],
    }


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

        value = match.group(1).strip(" \t:;|")

        # Reject placeholders instead of treating them as real data.
        if not value or any(
            value.lower() == marker or value.lower().startswith(f"{marker} ")
            for marker in invalid_placeholders
        ):
            continue
        if re.match(r"^[A-Za-z][A-Za-z0-9 /()#_.-]{1,50}\s*:\s*$", value):
            continue

        # Find the source page containing the extracted value.
        evidence_page = None
        evidence_text = None

        for index, page in enumerate(pages):
            if not isinstance(page, dict):
                continue
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
            "confidence": 0.9 if "\n" not in match.group(0) else 0.82,
            "evidence": {
                "page": evidence_page or 1,
                "snippet": evidence_text,
            },
            "source": "regex_text_match",
        }

    return _not_found()


def _label_patterns(labels: tuple[str, ...]) -> list[str]:
    label = "(?:" + "|".join(labels) + ")"
    return [
        rf"(?im)^\s*{label}\s*[:#]\s*([^\n]+)",
        rf"(?im)^\s*{label}\s*:?\s*\n\s*([^\n]+)",
    ]


def _extract_record(
    text: str,
    pages: list[dict[str, Any]],
    labels: tuple[str, ...],
) -> dict[str, Any]:
    return _find_field(text, _label_patterns(labels), pages)


def _currency_record(text: str, pages: list[dict[str, Any]]) -> dict[str, Any]:
    match = re.search(
        r"(?i)\b(INR|USD|EUR|GBP|CAD|AUD|JPY|CNY|AED|SGD)\b|₹|\$|€|£|¥",
        text,
    )
    if not match:
        return _not_found()
    currency = match.group(0).upper() if match.group(0).isalpha() else (
        "INR" if match.group(0) == "₹" else match.group(0)
    )
    return {
        "value": currency,
        "confidence": 0.8,
        "evidence": {
            "page": _page_for_value(match.group(0), pages),
            "snippet": next(
                (
                    line.strip()[:300]
                    for line in text.splitlines()
                    if match.group(0).lower() in line.lower()
                ),
                match.group(0),
            ),
        },
        "source": "currency_text_match",
    }


def _record(value: Any, text: str, confidence: float = 0.75) -> dict[str, Any]:
    return {
        "value": value,
        "confidence": confidence if value is not None else 0.0,
        "evidence": {
            "page": 1,
            "snippet": text[:300],
        } if value is not None else None,
        "source": "derived_from_document_text" if value is not None else "not_found",
    }


def _extract_line_items(text: str) -> list[dict[str, Any]]:
    items = []
    amount_pattern = r"(?:INR|USD|EUR|GBP|Rs\.?|₹|\$|€|£)?\s*\d[\d,]*(?:\.\d{1,2})"
    row_pattern = re.compile(
        rf"^\s*(?P<description>.+?)\s+"
        rf"(?P<quantity>\d+(?:\.\d+)?)\s+"
        rf"(?P<unit_price>{amount_pattern})\s+"
        rf"(?P<amount>{amount_pattern})\s*$",
        re.IGNORECASE,
    )
    for line in _normalise_text(text).splitlines():
        match = row_pattern.match(line)
        if not match:
            continue
        description = match.group("description").strip(" -|")
        if not description or re.search(r"\b(subtotal|tax|total|quantity|qty)\b", description, re.I):
            continue
        quantity = _parse_amount(match.group("quantity"))
        unit_price = _parse_amount(match.group("unit_price"))
        amount = _parse_amount(match.group("amount"))
        if quantity is None or unit_price is None or amount is None:
            continue
        items.append({
            "description": description,
            "quantity": quantity,
            "unit_price": unit_price,
            "amount": amount,
            "evidence": line[:300],
        })
    return items[:100]


def _extract_generic_fields(
    text: str,
    pages: list[dict[str, Any]],
) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    lines = text.splitlines()
    for index, line in enumerate(lines):
        match = re.match(r"^\s*([A-Za-z][A-Za-z0-9 /()#_.-]{1,59})\s*:\s*(.*?)\s*$", line)
        if not match:
            continue
        label = match.group(1).strip()
        value = match.group(2).strip()
        if not value and index + 1 < len(lines):
            value = lines[index + 1].strip()
        if not value:
            continue

        key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:60]
        if not key or key in fields:
            continue
        fields[key] = {
            "value": value,
            "confidence": 0.75,
            "evidence": {
                "page": _page_for_value(value, pages),
                "snippet": "\n".join(lines[max(0, index - 1):min(len(lines), index + 2)]),
            },
            "source": "key_value_text_match",
        }
    return fields


def _page_for_value(value: str, pages: list[dict[str, Any]]) -> int:
    for index, page in enumerate(pages):
        if isinstance(page, dict) and value.lower() in str(page.get("text") or "").lower():
            try:
                return int(page.get("page_number", index + 1))
            except (TypeError, ValueError):
                return index + 1
    return 1


def _extract_contract_parties(text: str, pages: list[dict[str, Any]]) -> dict[str, Any]:
    match = re.search(
        r"(?is)\bbetween\s+(.{2,120}?)\s+\band\b\s+(.{2,120}?)(?:[,.;\n]|\s+(?:each|collectively|effective|dated)\b)",
        text,
    )
    if not match:
        return _not_found()
    parties = [part.strip(" \t,.;") for part in match.groups()]
    if not all(parties):
        return _not_found()
    value = parties
    return {
        "value": value,
        "confidence": 0.72,
        "evidence": {
            "page": _page_for_value(match.group(0).strip(), pages),
            "snippet": match.group(0).strip()[:300],
        },
        "source": "contract_party_text_match",
    }


def _extract_obligations(text: str, pages: list[dict[str, Any]]) -> dict[str, Any]:
    clauses = []
    for line in _normalise_text(text).splitlines():
        candidate = line.strip()
        if len(candidate) >= 20 and re.search(
            r"\b(shall|must|agrees? to|is required to|will pay|will provide)\b",
            candidate,
            re.IGNORECASE,
        ):
            clauses.append(candidate[:400])
    if not clauses:
        return _not_found()
    return {
        "value": clauses[:20],
        "confidence": 0.68,
        "evidence": {
            "page": _page_for_value(clauses[0][:80], pages),
            "snippet": "\n".join(clauses[:3])[:300],
        },
        "source": "contract_clause_text_match",
    }


def _parse_amount(value: Any) -> float | None:
    """Convert a formatted amount into a number, if possible."""
    if value is None:
        return None

    cleaned = re.sub(r"[^0-9.\-]", "", str(value).replace(",", ""))

    try:
        amount = float(cleaned)
        return round(amount, 2) if math.isfinite(amount) else None
    except (OverflowError, TypeError, ValueError):
        return None


def extract_fields(ocr_result: dict[str, Any]) -> dict[str, Any]:
    """Extract available structured fields and classify the document text."""
    if not isinstance(ocr_result, dict):
        ocr_result = {}
    text = _normalise_text(str(ocr_result.get("text") or ""))
    pages = ocr_result.get("pages") or []
    if not isinstance(pages, list):
        pages = []
    meaningful_text = any(
        re.search(r"[A-Za-z0-9]", str(page.get("text") or ""))
        for page in pages if isinstance(page, dict)
    ) or bool(re.search(r"[A-Za-z0-9]", text))
    extraction_status = "success" if meaningful_text else "needs_review"

    classification = classify_document(text, extraction_status)
    fields = _extract_generic_fields(text, pages)
    document_type = classification["type"]
    field_names = {
        "invoice": (
            "supplier", "buyer", "invoice_number", "date", "due_date",
            "currency", "subtotal", "tax", "total",
        ),
        "purchase_order": (
            "supplier", "buyer", "po_number", "order_date", "delivery_address",
            "currency", "subtotal", "tax", "total",
        ),
        "receipt": (
            "supplier", "receipt_number", "date", "currency", "subtotal",
            "tax", "total", "payment_method",
        ),
        "contract": (
            "contract_title", "contract_type", "parties", "effective_date",
            "expiry_date", "contract_value", "payment_terms", "obligations",
        ),
        "certificate": ("certificate_id", "date"),
    }.get(document_type, ())

    for name in field_names:
        labels = FIELD_LABELS.get(name)
        if labels:
            fields[name] = _extract_record(text, pages, labels)
        else:
            fields[name] = _not_found()

    # A date explicitly labelled as an order date or transaction date is often
    # the document's primary date; preserve both semantic names when relevant.
    if document_type == "purchase_order" and fields.get("order_date", {}).get("value") is None:
        fields["order_date"] = _extract_record(text, pages, FIELD_LABELS["date"])
    if document_type == "receipt" and fields.get("date", {}).get("value") is None:
        fields["date"] = _extract_record(text, pages, FIELD_LABELS["order_date"])

    if document_type in {"invoice", "purchase_order", "receipt"}:
        line_items = _extract_line_items(text)
        fields["line_items"] = {
            **_record(line_items, text, 0.78),
            "evidence": (
                {
                    "page": _page_for_value(line_items[0]["evidence"], pages),
                    "snippet": "\n".join(
                        item["evidence"] for item in line_items[:3]
                    )[:300],
                }
                if line_items else None
            ),
            "source": "tabular_text_match" if line_items else "not_found",
        }
    elif document_type == "contract":
        title = fields.get("contract_title", _not_found())
        if title.get("value") is None:
            for line in text.splitlines()[:15]:
                candidate = line.strip()
                if re.search(r"\b(contract|agreement)\b", candidate, re.IGNORECASE):
                    fields["contract_title"] = {
                        "value": candidate,
                        "confidence": 0.75,
                        "evidence": {
                            "page": _page_for_value(candidate, pages),
                            "snippet": candidate[:300],
                        },
                        "source": "document_heading",
                    }
                    break
        fields["parties"] = _extract_contract_parties(text, pages)
        fields["obligations"] = _extract_obligations(text, pages)

    if document_type in {"invoice", "purchase_order", "receipt"}:
        fields["currency"] = _currency_record(text, pages)
        for name in ("subtotal", "tax", "total"):
            field = fields.get(name)
            if isinstance(field, dict):
                field["numeric_value"] = _parse_amount(field.get("value"))

    return {
        "filename": ocr_result.get("filename"),
        "extraction_status": extraction_status,
        "document_type": document_type,
        "classification_confidence": classification["confidence"],
        "classification_evidence": classification["evidence"],
        "fields": fields,
        "review_note": (
            "Automatically extracted values must be checked by a reviewer."
        ),
    }
