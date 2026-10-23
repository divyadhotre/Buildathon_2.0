"""Deterministic document checks that never make a human decision."""

import math
import re
from typing import Any

from .extraction_service import DOCUMENT_TYPES


REQUIRED_FIELDS = ("supplier", "invoice_number", "date", "total")
INVOICE_CONFIDENCE_THRESHOLD = 0.65


def _field_value(fields: dict[str, Any], name: str) -> Any:
    value = fields.get(name)
    if isinstance(value, dict):
        if "corrected_value" in value:
            return value["corrected_value"]
        if value.get("numeric_value") is not None:
            return value["numeric_value"]
        return value.get("value")
    return value


def _parse_amount(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            number = float(value)
        except OverflowError:
            return None
        return round(number, 2) if math.isfinite(number) else None
    cleaned = re.sub(r"[^0-9.\-]", "", str(value).replace(",", ""))
    try:
        amount = float(cleaned)
        return round(amount, 2) if math.isfinite(amount) else None
    except (OverflowError, TypeError, ValueError):
        return None


def check_required_fields(fields: dict[str, Any]) -> list[dict[str, Any]]:
    findings = []
    for field in REQUIRED_FIELDS:
        record = fields.get(field)
        value = _field_value(fields, field)
        if isinstance(record, dict) and record.get("status") == "uncertain":
            findings.append({
                "rule_id": "required_field",
                "field": field,
                "status": "inconclusive",
                "category": "uncertain_result",
                "candidate": record.get("candidate") or record.get("value"),
                "evidence": record.get("evidence"),
                "message": (
                    f"Required invoice field '{field}' has an uncertain candidate "
                    "that must be confirmed by a human reviewer."
                ),
            })
            continue
        if value is None or str(value).strip() == "":
            findings.append({
                "rule_id": "required_field",
                "field": field,
                "status": "flag",
                "category": "missing_information",
                "message": f"Required invoice field '{field}' is missing or unreadable.",
            })
    return findings


def check_total(
    subtotal: float,
    tax: float,
    total: float,
    tolerance: float = 0.02,
    evidence: dict[str, Any] | None = None,
    discount: float = 0.0,
) -> dict[str, Any]:
    if not all(math.isfinite(value) for value in (subtotal, tax, total, discount)):
        return {
            "rule_id": "total_consistency",
            "status": "inconclusive",
            "category": "uncertain_result",
            "message": "Total consistency could not be performed because an extracted amount is outside the supported numeric range.",
        }
    if discount < 0:
        return {
            "rule_id": "total_consistency",
            "status": "inconclusive",
            "category": "uncertain_result",
            "evidence": evidence,
            "message": "Total consistency could not be performed because the extracted discount is negative.",
        }
    expected_sum = subtotal + tax - discount
    if not math.isfinite(expected_sum):
        return {
            "rule_id": "total_consistency",
            "status": "inconclusive",
            "category": "uncertain_result",
            "message": "Total consistency could not be performed because the extracted amounts are outside the supported numeric range.",
        }
    expected = round(expected_sum, 2)
    observed = round(total, 2)
    difference = round(abs(expected - observed), 2)
    consistent = difference <= tolerance
    return {
        "rule_id": "total_consistency",
        "status": "pass" if consistent else "flag",
        "category": "confirmed_error" if not consistent else "passed",
        "expected_total": expected,
        "observed_total": observed,
        "difference": difference,
        "tolerance": tolerance,
        "evidence": evidence,
        "message": (
            (
                "Extracted subtotal plus tax less discount matches the extracted total."
                if discount
                else "Extracted subtotal plus tax matches the extracted total."
            )
            if consistent
            else (
                "Confirmed total mismatch: extracted subtotal plus tax less discount "
                "differs from the extracted total."
                if discount
                else "Confirmed total mismatch: extracted subtotal plus tax differs from the extracted total."
            )
        ),
    }


def _invoice_findings(fields: dict[str, Any]) -> list[dict[str, Any]]:
    findings = check_required_fields(fields)
    amounts = {
        name: _parse_amount(_field_value(fields, name))
        for name in ("subtotal", "tax", "discount", "total")
    }
    if all(amounts[name] is not None for name in ("subtotal", "tax", "total")):
        discount_value = _field_value(fields, "discount")
        if discount_value is not None and amounts["discount"] is None:
            findings.append({
                "rule_id": "total_consistency",
                "status": "inconclusive",
                "category": "uncertain_result",
                "fields_unavailable": ["discount"],
                "evidence": fields.get("discount", {}).get("evidence"),
                "message": "Total consistency was not performed because the extracted discount is unreadable.",
            })
        else:
            findings.append(check_total(
                subtotal=amounts["subtotal"],
                tax=amounts["tax"],
                total=amounts["total"],
                discount=amounts["discount"] or 0.0,
                evidence={
                    name: fields.get(name, {}).get("evidence")
                    for name in ("subtotal", "tax", "discount", "total")
                    if isinstance(fields.get(name), dict)
                    and fields[name].get("evidence")
                },
            ))
    else:
        missing = [
            name for name in ("subtotal", "tax", "total")
            if amounts[name] is None
        ]
        uncertain = [
            name for name in ("subtotal", "tax", "discount", "total")
            if isinstance(fields.get(name), dict)
            and fields[name].get("status") == "uncertain"
        ]
        findings.append({
            "rule_id": "total_consistency",
            "status": "inconclusive" if uncertain else "not_performed",
            "category": "uncertain_result" if uncertain else "unavailable_evidence",
            "fields_unavailable": sorted(set(missing + uncertain)),
            "evidence": {
                name: fields[name].get("evidence")
                for name in uncertain
                if fields[name].get("evidence")
            } or None,
            "message": (
                "Total consistency was not performed because "
                f"{', '.join(uncertain)} {'is' if len(uncertain) == 1 else 'are'} ambiguous or unreadable."
                if uncertain
                else (
                    "Total consistency was not performed because "
                    f"{', '.join(missing)} {'is' if len(missing) == 1 else 'are'} missing or unreadable."
                )
            ),
        })
    items = _field_value(fields, "line_items")
    if isinstance(items, list) and items:
        findings.extend(
            finding for finding in _transaction_findings(fields, "invoice")
            if finding.get("rule_id", "").startswith("line_item_")
        )
    return findings


DOCUMENT_REQUIRED_FIELDS = {
    "purchase_order": ("supplier", "po_number", "order_date", "total"),
    "receipt": ("supplier", "receipt_number", "date", "total"),
    "contract": ("contract_title", "parties", "effective_date"),
}


def _document_required_findings(
    fields: dict[str, Any],
    document_type: str,
) -> list[dict[str, Any]]:
    findings = []
    for name in DOCUMENT_REQUIRED_FIELDS.get(document_type, ()):
        value = _field_value(fields, name)
        if value is None or (isinstance(value, str) and not value.strip()) or value == []:
            findings.append({
                "rule_id": "required_field",
                "field": name,
                "status": "flag",
                "category": "missing_information",
                "message": (
                    f"Important {document_type.replace('_', ' ')} field "
                    f"'{name}' is missing or unreadable."
                ),
            })
    return findings


def _transaction_findings(fields: dict[str, Any], document_type: str) -> list[dict[str, Any]]:
    findings = _document_required_findings(fields, document_type)
    amounts = {
        name: _parse_amount(_field_value(fields, name))
        for name in ("subtotal", "tax", "total")
    }
    if amounts["subtotal"] is not None and amounts["tax"] is not None and amounts["total"] is not None:
        findings.append(check_total(
            subtotal=amounts["subtotal"],
            tax=amounts["tax"],
            total=amounts["total"],
            evidence={
                name: fields.get(name, {}).get("evidence")
                for name in ("subtotal", "tax", "total")
                if isinstance(fields.get(name), dict)
                and fields[name].get("evidence")
            },
        ))
    else:
        unavailable = [
            name for name, amount in amounts.items()
            if amount is None
        ]
        if amounts["total"] is not None:
            findings.append({
                "rule_id": "total_consistency",
                "status": "not_performed",
                "category": "unavailable_evidence",
                "fields_unavailable": unavailable,
                "message": (
                    "Subtotal/tax arithmetic was not performed because "
                    f"{', '.join(unavailable)} is missing or unreadable."
                ),
            })
        else:
            findings.append({
                "rule_id": "total_consistency",
                "status": "not_performed",
                "category": "unavailable_evidence",
                "fields_unavailable": unavailable,
                "message": "Total arithmetic was not performed because transaction amounts are missing or unreadable.",
            })

    items = _field_value(fields, "line_items")
    if isinstance(items, list) and items:
        tax_was_explicit_zero = (
            _field_value(fields, "tax") is not None and amounts["tax"] == 0
        )
        item_comparison_target = (
            ("subtotal", amounts["subtotal"])
            if amounts["subtotal"] is not None
            else ("total", amounts["total"])
            if tax_was_explicit_zero and amounts["total"] is not None
            else (None, None)
        )
        if item_comparison_target[1] is not None:
            item_amounts = [
                _parse_amount(item.get("amount"))
                for item in items if isinstance(item, dict)
            ]
            if item_amounts and all(amount is not None for amount in item_amounts):
                item_sum = round(sum(item_amounts), 2)
                target_name, target_amount = item_comparison_target
                difference = round(abs(item_sum - target_amount), 2)
                consistent = difference <= 0.02
                findings.append({
                    "rule_id": "line_item_total_consistency",
                    "status": "pass" if consistent else "flag",
                    "category": "passed" if consistent else "confirmed_error",
                    "expected_total": item_sum,
                    "observed_total": target_amount,
                    "difference": difference,
                    "message": (
                        f"The sum of extracted line item amounts matches the document {target_name}."
                        if consistent
                        else f"Confirmed mismatch: extracted line item amounts do not sum to the document {target_name}."
                    ),
                    "evidence": [
                        item.get("evidence") for item in items
                        if isinstance(item, dict) and item.get("evidence")
                    ][:10],
                })
            else:
                findings.append({
                    "rule_id": "line_item_total_consistency",
                    "status": "not_performed",
                    "category": "unavailable_evidence",
                    "message": "Line item totals could not be compared because item amounts were incomplete or unreadable.",
                })
        else:
            findings.append({
                "rule_id": "line_item_total_consistency",
                "status": "not_performed",
                "category": "unavailable_evidence",
                "message": "Line items were not compared with a subtotal or total because tax information was insufficient to make a safe comparison.",
            })

        invalid_items = []
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            quantity = _parse_amount(item.get("quantity"))
            unit_price = _parse_amount(item.get("unit_price"))
            amount = _parse_amount(item.get("amount"))
            if quantity is None or unit_price is None or amount is None:
                continue
            expected = round(quantity * unit_price, 2)
            if abs(expected - amount) > 0.02:
                invalid_items.append({
                    "item": index,
                    "expected": expected,
                    "observed": amount,
                    "evidence": item.get("evidence"),
                })
        if invalid_items:
            findings.append({
                "rule_id": "line_item_arithmetic",
                "status": "flag",
                "category": "confirmed_error",
                "message": "One or more extracted line item amounts do not equal quantity multiplied by unit price.",
                "evidence": invalid_items[:10],
            })
        else:
            findings.append({
                "rule_id": "line_item_arithmetic",
                "status": "pass",
                "category": "passed",
                "message": "Extracted line item quantity and unit price calculations are consistent.",
                "evidence": [item.get("evidence") for item in items if isinstance(item, dict)][:10],
            })
    elif not any(f.get("rule_id") == "line_item_arithmetic" for f in findings):
        findings.append({
            "rule_id": "line_item_arithmetic",
            "status": "not_performed",
            "category": "unavailable_evidence",
            "message": "Line item arithmetic was not performed because no readable line items were extracted.",
        })
    return findings


def _contract_findings(fields: dict[str, Any]) -> list[dict[str, Any]]:
    findings = _document_required_findings(fields, "contract")
    if _field_value(fields, "expiry_date") is None:
        findings.append({
            "rule_id": "contract_expiry_date",
            "status": "not_performed",
            "category": "unavailable_evidence",
            "field": "expiry_date",
            "message": "No expiry date was extracted; the contract may be ongoing or the date may be stated in another form.",
        })
    if _field_value(fields, "payment_terms") is None:
        findings.append({
            "rule_id": "contract_payment_terms",
            "status": "not_performed",
            "category": "unavailable_evidence",
            "field": "payment_terms",
            "message": "No payment terms were extracted from the available contract text.",
        })
    if _field_value(fields, "obligations") is None:
        findings.append({
            "rule_id": "contract_obligations",
            "status": "not_performed",
            "category": "unavailable_evidence",
            "field": "obligations",
            "message": "No reliably identifiable obligation clauses were extracted.",
        })
    return findings


def _bank_statement_findings(fields: dict[str, Any]) -> list[dict[str, Any]]:
    records = {
        name: _parse_amount(_field_value(fields, name))
        for name in (
            "opening_balance", "total_credits", "total_debits", "closing_balance",
        )
    }
    required = ("opening_balance", "total_credits", "total_debits", "closing_balance")
    if all(records[name] is not None for name in required):
        expected = round(
            records["opening_balance"] + records["total_credits"] - records["total_debits"],
            2,
        )
        observed = round(records["closing_balance"], 2)
        difference = round(abs(expected - observed), 2)
        return [{
            "rule_id": "statement_balance_consistency",
            "status": "pass" if difference <= 0.02 else "flag",
            "category": "passed" if difference <= 0.02 else "confirmed_error",
            "expected_balance": expected,
            "observed_balance": observed,
            "difference": difference,
            "evidence": {
                name: fields[name].get("evidence")
                for name in required
                if isinstance(fields.get(name), dict) and fields[name].get("evidence")
            },
            "message": (
                "Opening balance plus credits less debits matches the closing balance."
                if difference <= 0.02
                else "Confirmed statement balance mismatch: opening balance plus credits less debits differs from the closing balance."
            ),
        }]
    unavailable = [name for name in required if records[name] is None]
    return [{
        "rule_id": "statement_balance_consistency",
        "status": "not_performed",
        "category": "unavailable_evidence",
        "fields_unavailable": unavailable,
        "message": (
            "Statement balance arithmetic was not performed because "
            f"{', '.join(unavailable)} were not all readable from the document."
        ),
    }]


def _income_tax_findings() -> list[dict[str, Any]]:
    return [{
        "rule_id": "tax_record_policy",
        "status": "not_performed",
        "category": "unavailable_evidence",
        "message": (
            "The document was classified as an income-tax record, but no jurisdiction-specific "
            "tax compliance or authenticity rules are configured. Review the extracted evidence manually."
        ),
    }]


def verify_document(extraction_result: dict[str, Any]) -> dict[str, Any]:
    """Run only checks supported by the classification and extracted evidence."""
    result = extraction_result if isinstance(extraction_result, dict) else {}
    fields = result.get("fields")
    fields = fields if isinstance(fields, dict) else {}
    document_type = result.get("document_type", "unknown")
    confidence = result.get("classification_confidence", 0)
    try:
        confidence = float(confidence)
    except (OverflowError, TypeError, ValueError):
        confidence = 0
    if not math.isfinite(confidence):
        confidence = 0
    extraction_status = result.get("extraction_status", "unknown")
    extraction_status = extraction_status if isinstance(extraction_status, str) else "unknown"
    document_type = document_type if isinstance(document_type, str) else "unknown"

    if extraction_status == "failed":
        findings = [{
            "rule_id": "document_processing",
            "status": "not_performed",
            "category": "unavailable_evidence",
            "message": "Verification checks were not performed because extraction failed.",
        }]
    elif (
        document_type == "invoice"
        and confidence >= INVOICE_CONFIDENCE_THRESHOLD
    ):
        findings = _invoice_findings(fields)
    elif document_type in {
        "purchase_order", "receipt", "contract", "certificate",
        "bank_statement", "income_tax_document",
    } and confidence >= INVOICE_CONFIDENCE_THRESHOLD:
        identification = {
            "rule_id": "document_type_identification",
            "status": "pass",
            "category": "passed",
            "message": f"Text patterns support classification as {document_type.replace('_', ' ')}.",
            "evidence": result.get("classification_evidence"),
        }
        if document_type in {"purchase_order", "receipt"}:
            findings = [identification, *_transaction_findings(fields, document_type)]
        elif document_type == "bank_statement":
            findings = [identification, *_bank_statement_findings(fields)]
        elif document_type == "income_tax_document":
            findings = [identification, *_income_tax_findings()]
        elif document_type == "contract":
            findings = [identification, *_contract_findings(fields)]
        else:
            findings = [identification, {
                "rule_id": "certificate_metadata",
                "status": "not_performed",
                "category": "unavailable_evidence",
                "message": "Certificate-specific authenticity checks are not configured; extracted metadata requires human review.",
            }]
    else:
        findings = [{
            "rule_id": "document_classification",
            "status": "inconclusive",
            "category": "uncertain_result",
            "message": (
                "Document type is unknown or classification confidence is insufficient. "
                "Document-specific checks were not performed; human review is required."
            ),
            "evidence": result.get("classification_evidence"),
        }]

    if document_type not in DOCUMENT_TYPES:
        document_type = "unknown"

    passed_only = bool(findings) and all(item.get("status") == "pass" for item in findings)
    return {
        "status": "checks_passed" if passed_only else "needs_review",
        "findings": findings,
        "approval_decision": "human_review_required",
        "message": (
            "Supported automated checks passed; authorised human review is still required."
            if passed_only
            else "Some checks were inconclusive, unavailable, or raised findings. Human review is required."
        ),
        "document_type": document_type,
        "classification_confidence": confidence,
    }


def verify_invoice(extraction_result: dict[str, Any]) -> dict[str, Any]:
    """Backward-compatible alias for callers that still use the old name."""
    return verify_document(extraction_result)
