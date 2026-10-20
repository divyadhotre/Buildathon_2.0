"""Deterministic invoice checks to be implemented."""


def check_required_fields(fields: dict) -> list[dict]:
    required = ("supplier", "invoice_number", "date", "total")
    findings = []
    for field in required:
        value = fields.get(field)
        if value is None or str(value).strip() == "":
            findings.append({
                "rule_id": "required_field",
                "field": field,
                "status": "flag",
                "message": f"Required field '{field}' is missing or unreadable.",
            })
    return findings


def check_total(subtotal: float, tax: float, total: float, tolerance: float = 0.02) -> dict:
    expected = round(subtotal + tax, 2)
    difference = round(abs(expected - total), 2)
    return {
        "rule_id": "total_consistency",
        "status": "pass" if difference <= tolerance else "flag",
        "expected_total": expected,
        "observed_total": round(total, 2),
        "difference": difference,
        "tolerance": tolerance,
        "message": "Totals are consistent." if difference <= tolerance else "Subtotal plus tax differs from total.",
    }
