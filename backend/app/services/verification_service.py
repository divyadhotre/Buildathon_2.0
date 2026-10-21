# """Deterministic invoice checks to be implemented."""


# def check_required_fields(fields: dict) -> list[dict]:
#     required = ("supplier", "invoice_number", "date", "total")
#     findings = []
#     for field in required:
#         value = fields.get(field)
#         if value is None or str(value).strip() == "":
#             findings.append({
#                 "rule_id": "required_field",
#                 "field": field,
#                 "status": "flag",
#                 "message": f"Required field '{field}' is missing or unreadable.",
#             })
#     return findings


# def check_total(subtotal: float, tax: float, total: float, tolerance: float = 0.02) -> dict:
#     expected = round(subtotal + tax, 2)
#     difference = round(abs(expected - total), 2)
#     return {
#         "rule_id": "total_consistency",
#         "status": "pass" if difference <= tolerance else "flag",
#         "expected_total": expected,
#         "observed_total": round(total, 2),
#         "difference": difference,
#         "tolerance": tolerance,
#         "message": "Totals are consistent." if difference <= tolerance else "Subtotal plus tax differs from total.",
#     }

"""Deterministic invoice checks.

These checks flag issues for human review. They never approve an invoice.
"""

from typing import Any


REQUIRED_FIELDS = ("supplier", "invoice_number", "date", "total")


def _field_value(fields: dict[str, Any], name: str) -> Any:
    """Read a plain value or an extraction-service field object."""
    value = fields.get(name)

    if isinstance(value, dict):
        # Prefer the parsed number when available.
        if value.get("numeric_value") is not None:
            return value["numeric_value"]
        return value.get("value")

    return value


def _parse_amount(value: Any) -> float | None:
    """Convert formatted currency values to numbers."""
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return round(float(value), 2)

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


def check_required_fields(fields: dict) -> list[dict]:
    """Flag required fields that are missing or unreadable."""
    findings = []

    for field in REQUIRED_FIELDS:
        value = _field_value(fields, field)

        if value is None or str(value).strip() == "":
            findings.append({
                "rule_id": "required_field",
                "field": field,
                "status": "flag",
                "message": (
                    f"Required field '{field}' is missing or unreadable."
                ),
            })

    return findings


def check_total(
    subtotal: float,
    tax: float,
    total: float,
    tolerance: float = 0.02,
) -> dict:
    """Compare subtotal plus tax against the stated total."""
    expected = round(subtotal + tax, 2)
    observed = round(total, 2)
    difference = round(abs(expected - observed), 2)

    return {
        "rule_id": "total_consistency",
        "status": "pass" if difference <= tolerance else "flag",
        "expected_total": expected,
        "observed_total": observed,
        "difference": difference,
        "tolerance": tolerance,
        "message": (
            "Totals are consistent."
            if difference <= tolerance
            else "Subtotal plus tax differs from total."
        ),
    }


def verify_invoice(extraction_result: dict[str, Any]) -> dict[str, Any]:
    """Run deterministic checks against extracted invoice fields."""
    fields = extraction_result.get("fields", {})
    findings = check_required_fields(fields)

    amounts = {
        name: _parse_amount(_field_value(fields, name))
        for name in ("subtotal", "tax", "total")
    }

    if all(value is not None for value in amounts.values()):
        findings.append(
            check_total(
                subtotal=amounts["subtotal"],
                tax=amounts["tax"],
                total=amounts["total"],
            )
        )
    else:
        findings.append({
            "rule_id": "total_consistency",
            "status": "flag",
            "message": (
                "Cannot verify total: subtotal, tax, or total is missing "
                "or unreadable."
            ),
        })

    flagged = any(item.get("status") == "flag" for item in findings)

    return {
        "status": "needs_review" if flagged else "checks_passed",
        "findings": findings,
        "approval_decision": "human_review_required",
        "message": (
            "Issues were found or some checks could not be completed."
            if flagged
            else (
                "Automated checks passed; authorised human review "
                "is still required."
            )
        ),
    }

