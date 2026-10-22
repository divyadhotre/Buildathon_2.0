import asyncio
import json
import socket
import urllib.error
from io import BytesIO
from types import SimpleNamespace

import pytest
import pymupdf as fitz
from PIL import Image
from fastapi import HTTPException, UploadFile
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_actor
from app.config import settings
from app.database import Base, get_db
from app.models import AuditEvent, Document, ReviewRequest
from app.routers import documents as documents_router
from app.routers import ai as ai_router
from app.routers import requests as requests_router
from app.routers import reviews as reviews_router
from app.routers.documents import upload_document
from app.routers.requests import create_request
from app.routers.reviews import load_for_review, record_decision, stored_ai_suggestion
from app.schemas import RequestCreate, ReviewDecision
from app.services import genai_service
from app.services.extraction_service import classify_document, extract_fields
from app.services import ocr_service
from app.services.ocr_service import extract_text
from app.services.verification_service import verify_document


def _extracted_fields(
    *,
    supplier="Acme Supplies",
    invoice_number="INV-17",
    date="2026-10-22",
    subtotal="100.00",
    tax="18.00",
    total="118.00",
):
    values = {
        "supplier": supplier,
        "invoice_number": invoice_number,
        "date": date,
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
    }
    fields = {
        key: {
            "value": value,
            "numeric_value": float(value) if key in {"subtotal", "tax", "total"} and value is not None else None,
            "confidence": 0.9 if value is not None else 0.0,
            "evidence": {"page": 1, "snippet": f"{key}: {value}"} if value is not None else None,
            "source": "regex_text_match" if value is not None else "not_found",
        }
        for key, value in values.items()
    }
    return {
        "extraction_status": "success",
        "document_type": "invoice",
        "classification_confidence": 0.9,
        "classification_evidence": "Matched text: tax invoice.",
        "fields": fields,
    }


def _document(extraction=None, verification=None):
    return SimpleNamespace(
        extracted_fields=extraction or _extracted_fields(),
        verification_result=verification or verify_document(extraction or _extracted_fields()),
    )


def _gemini_response(action="approve", explanation="All available invoice checks passed."):
    return {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": (
                        '{"action":"%s","explanation":"%s",'
                        '"key_findings":["Checks passed"],"human_review_required":false}'
                    ) % (action, explanation)
                }]
            }
        }]
    }


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("TAX INVOICE\nInvoice No: A-1", "invoice"),
        ("PURCHASE ORDER\nOrder Quantity: 4", "purchase_order"),
        ("PAYMENT RECEIPT\nAmount Paid: 20", "receipt"),
        ("SERVICE AGREEMENT\nThe parties agree", "contract"),
        ("CERTIFICATE OF COMPLETION\nHereby certifies", "certificate"),
        ("Meeting notes for next week", "unknown"),
        (
            "The Perfect Match Invoice (Happy Path)\n"
            "Use the sample to demonstrate invoice extraction and subtotal matching.",
            "unknown",
        ),
    ],
)
def test_classifies_supported_document_types(text, expected):
    result = classify_document(text)
    assert result["type"] == expected
    assert 0 <= result["confidence"] <= 1
    assert result["evidence"]


def test_empty_and_malformed_extraction_are_safe():
    empty = extract_fields({"text": "", "pages": "invalid"})
    assert empty["extraction_status"] == "needs_review"
    assert empty["document_type"] == "unknown"
    assert empty["classification_confidence"] == 0

    failed = verify_document({
        "extraction_status": "failed",
        "document_type": "invoice",
        "classification_confidence": 0.9,
        "fields": {},
    })
    assert failed["status"] == "needs_review"
    assert failed["findings"][0]["status"] == "not_performed"


def test_complete_invoice_totals_pass():
    result = verify_document(_extracted_fields())
    assert result["status"] == "checks_passed"
    assert [finding["status"] for finding in result["findings"]] == ["pass"]


def test_missing_subtotal_or_tax_is_not_reported_as_total_mismatch():
    result = verify_document(_extracted_fields(subtotal=None, tax=None, total="30.00"))
    consistency = next(f for f in result["findings"] if f["rule_id"] == "total_consistency")
    assert consistency["status"] == "not_performed"
    assert "flag" not in [f["status"] for f in result["findings"]]
    assert result["status"] == "needs_review"

    line_item_text = (
        "TAX INVOICE\nInvoice No: INV-17\nSupplier: Acme Supplies\n"
        "Date: 2026-10-22\nItem 10.00\nItem 20.00\nTotal: 30.00"
    )
    extracted = extract_fields({"text": line_item_text, "pages": [{"text": line_item_text}]})
    checks = verify_document(extracted)
    assert not any(
        f.get("rule_id") == "total_consistency" and f.get("status") == "flag"
        for f in checks["findings"]
    )


def test_confirmed_invoice_mismatch_is_flagged_with_evidence_values():
    result = verify_document(_extracted_fields(total="120.00"))
    mismatch = next(f for f in result["findings"] if f["rule_id"] == "total_consistency")
    assert mismatch["status"] == "flag"
    assert mismatch["expected_total"] == 118
    assert mismatch["observed_total"] == 120
    assert mismatch["difference"] == 2


def test_ai_context_includes_confirmed_mismatch_amounts():
    extraction = _extracted_fields(total="120.00")
    context = genai_service.build_context(_document(extraction, verify_document(extraction)))
    mismatch = next(
        f for f in context["verification_findings"]
        if f["rule_id"] == "total_consistency"
    )
    assert mismatch["status"] == "flag"
    assert mismatch["expected_total"] == 118
    assert mismatch["observed_total"] == 120
    assert mismatch["difference"] == 2


@pytest.mark.parametrize(
    ("document_type", "text"),
    [
        ("purchase_order", "PURCHASE ORDER"),
        ("receipt", "PAYMENT RECEIPT"),
        ("contract", "SERVICE AGREEMENT"),
        ("certificate", "CERTIFICATE OF COMPLETION"),
    ],
)
def test_non_invoice_types_receive_type_specific_checks(document_type, text):
    classification = classify_document(text)
    assert classification["type"] == document_type
    result = verify_document({
        "extraction_status": "success",
        "document_type": document_type,
        "classification_confidence": classification["confidence"],
        "classification_evidence": classification["evidence"],
        "fields": {},
    })
    assert not any(
        f.get("field") == "invoice_number"
        for f in result["findings"]
    )
    assert any(
        f["rule_id"] in {
            "document_type_identification",
            "certificate_metadata",
            "line_item_arithmetic",
            "contract_expiry_date",
        }
        for f in result["findings"]
    )
    assert result["approval_decision"] == "human_review_required"


def test_unknown_document_is_inconclusive_not_a_failure():
    result = verify_document({
        "extraction_status": "success",
        "document_type": "unknown",
        "classification_confidence": 0,
        "fields": {},
    })
    assert result["findings"][0]["status"] == "inconclusive"
    assert result["status"] == "needs_review"


def test_non_invoice_extraction_returns_generic_key_value_fields():
    text = (
        "CERTIFICATE OF COMPLETION\n"
        "Employee: Jane Doe\n"
        "Issued By: Example Academy\n"
        "Certificate ID: CERT-204"
    )
    extracted = extract_fields({"text": text, "pages": [{"page_number": 1, "text": text}]})
    assert extracted["document_type"] == "certificate"
    assert extracted["fields"]["employee"]["value"] == "Jane Doe"
    assert extracted["fields"]["issued_by"]["value"] == "Example Academy"
    assert extracted["fields"]["certificate_id"]["value"] == "CERT-204"


def test_text_and_docx_files_extract_readable_text(tmp_path):
    plain_text = tmp_path / "policy.txt"
    plain_text.write_text("POLICY\nOwner: Finance\nPolicy ID: P-15", encoding="utf-8")
    result = extract_text(plain_text)
    assert result["status"] == "success"
    assert "Policy ID: P-15" in result["text"]

    docx_path = tmp_path / "certificate.docx"
    xml = (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>Certificate of Completion</w:t></w:r></w:p>"
        "<w:p><w:r><w:t>Member: Ada Example</w:t></w:r></w:p></w:body></w:document>"
    )
    import zipfile

    with zipfile.ZipFile(docx_path, "w") as archive:
        archive.writestr("word/document.xml", xml)
    docx_result = extract_text(docx_path)
    assert docx_result["status"] == "success"
    assert "Member: Ada Example" in docx_result["text"]


def test_short_digital_pdf_does_not_require_tesseract(tmp_path, monkeypatch):
    pdf_path = tmp_path / "short.pdf"
    pdf = fitz.open()
    pdf.new_page().insert_text((72, 72), "Hello")
    pdf.save(pdf_path)
    pdf.close()
    monkeypatch.setattr(
        "app.services.ocr_service.configure_tesseract",
        lambda: pytest.fail("Text-bearing digital PDF must not require OCR"),
    )
    result = extract_text(pdf_path)
    assert result["status"] == "success"
    assert "Hello" in result["text"]


def test_build_context_preserves_evidence_and_all_finding_states():
    extraction = _extracted_fields(subtotal=None, tax=None)
    verification = {
        "status": "needs_review",
        "findings": [
            {"rule_id": "missing", "status": "flag", "category": "missing_information", "field": "date", "message": "Date missing"},
            {"rule_id": "arithmetic", "status": "pass", "message": "Amounts match"},
            {"rule_id": "comparison", "status": "inconclusive", "message": "Comparison uncertain"},
            {"rule_id": "total", "status": "not_performed", "message": "Missing subtotal"},
        ],
    }
    document = _document(extraction, verification)
    context = genai_service.build_context(document)
    assert context["document_type"]["value"] == "invoice"
    assert context["fields"]["supplier"]["confidence"] == 0.9
    assert context["fields"]["supplier"]["evidence"]["snippet"] == "supplier: Acme Supplies"
    assert {f["status"] for f in context["verification_findings"]} == {
        "flag", "pass", "inconclusive", "not_performed"
    }
    assert context["actionable_missing_information"] == [
        {"field": "date", "message": "Date missing"}
    ]
    assert context["human_review_required"] is True
    assert "raw_ocr" not in context


def test_purchase_order_context_is_included_only_when_supplied():
    document = _document()
    purchase_order = SimpleNamespace(extracted_fields={"fields": {"total": {"value": "110.00"}}})
    assert genai_service.build_context(document)["related_purchase_order"] is None
    comparison = genai_service.build_context(document, purchase_order)["related_purchase_order"]
    assert comparison["document_total"] == "118.00"
    assert comparison["po_total"] == "110.00"
    assert comparison["difference"] == 8.0
    assert comparison["comparison_status"] == "available"


def test_gemini_missing_key_and_network_errors_are_explicit(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(genai_service, "load_env", lambda: None)
    with pytest.raises(genai_service.SuggestionError, match="GEMINI_API_KEY"):
        genai_service._call_gemini("test")

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(genai_service.time, "sleep", lambda delay: None)
    monkeypatch.setattr(
        genai_service.urllib.request,
        "urlopen",
        lambda *args, **kwargs: (_ for _ in ()).throw(TimeoutError()),
    )
    with pytest.raises(genai_service.SuggestionError, match="Could not reach Gemini"):
        genai_service._call_gemini("test")


def test_gemini_network_error_identifies_dns_failure(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(genai_service, "load_env", lambda: None)
    monkeypatch.setattr(genai_service.time, "sleep", lambda delay: None)
    monkeypatch.setattr(
        genai_service.urllib.request,
        "urlopen",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            urllib.error.URLError(socket.gaierror(-2, "name lookup failed"))
        ),
    )

    with pytest.raises(genai_service.SuggestionError, match="DNS lookup failed") as error:
        genai_service._call_gemini("test")
    assert error.value.status == 503


def test_gemini_retries_transient_503_then_returns_response(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.5-flash")
    monkeypatch.setattr(genai_service, "load_env", lambda: None)
    monkeypatch.setattr(genai_service.time, "sleep", lambda delay: None)
    calls = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def read(self):
            return json.dumps({"candidates": []}).encode()

    def fake_urlopen(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(
                "https://example.invalid",
                503,
                "Service Unavailable",
                {},
                BytesIO(b"temporary service failure"),
            )
        return Response()

    monkeypatch.setattr(genai_service.urllib.request, "urlopen", fake_urlopen)
    assert genai_service._call_gemini("prompt") == {"candidates": []}
    assert len(calls) == 2


def test_gemini_persistent_503_returns_actionable_service_error(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(genai_service, "load_env", lambda: None)
    monkeypatch.setattr(genai_service.time, "sleep", lambda delay: None)
    calls = []

    def unavailable(*args, **kwargs):
        calls.append(1)
        raise urllib.error.HTTPError(
            "https://example.invalid",
            503,
            "Service Unavailable",
            {},
            BytesIO(b"temporary service failure"),
        )

    monkeypatch.setattr(genai_service.urllib.request, "urlopen", unavailable)
    with pytest.raises(genai_service.SuggestionError, match="temporarily unavailable") as error:
        genai_service._call_gemini("prompt")
    assert error.value.status == 503
    assert len(calls) == genai_service.MAX_GEMINI_ATTEMPTS


def test_ai_prompt_requests_unfamiliar_document_identification(monkeypatch):
    ctx = genai_service.build_context(_document())
    prompt = genai_service.build_prompt(ctx)
    assert "including unfamiliar document types" in prompt
    assert "document_identification" in prompt


@pytest.mark.parametrize(
    "response",
    [
        {},
        {"candidates": [{"content": {"parts": [{"text": ""}]}}]},
        {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]},
        {"candidates": [{"content": {"parts": [{"text": '{"action":"invalid","explanation":"A sufficiently long explanation."}'}]}}]},
        {"candidates": [{"content": {"parts": [{"text": '{"action":"approve","explanation":""}'}]}}]},
        {"candidates": [{"content": {"parts": [{"text": '{"action":"approve","explanation":"OK."}'}]}}]},
    ],
)
def test_invalid_gemini_response_shapes_are_rejected(response):
    with pytest.raises(genai_service.SuggestionError):
        genai_service._parse(response)


def test_ai_analysis_runs_for_generic_documents_and_incomplete_checks(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    prompts = []
    monkeypatch.setattr(genai_service, "_call_gemini", lambda prompt: prompts.append(prompt) or {
        "candidates": [{
            "content": {"parts": [{
                "text": (
                    '{"action":null,"explanation":"The document text is readable, but no '
                    'type-specific verification rule is available.","key_findings":'
                    '["Human review is required"],"human_review_required":true}'
                )
            }]}
        }]
    })
    failed_extraction = _document(
        {
            "extraction_status": "failed",
            "document_type": "invoice",
            "classification_confidence": 0.9,
            "fields": {},
        },
        {"status": "needs_review", "findings": []},
    )
    failed_result = genai_service.generate_suggestion(failed_extraction)
    assert failed_result["action"] is None
    assert failed_result["human_review_required"] is True
    assert failed_result["suggestion_available"] is False

    unknown = _document(
        {"extraction_status": "success", "document_type": "unknown", "fields": {}},
        {"status": "needs_review", "findings": []},
    )
    unknown_result = genai_service.generate_suggestion(unknown)
    assert unknown_result["action"] is None
    assert unknown_result["suggestion_available"] is False

    readable_unknown = SimpleNamespace(
        extracted_fields={
            "extraction_status": "success",
            "document_type": "unknown",
            "classification_confidence": 0.0,
            "classification_evidence": "No supported document-type indicators were found.",
            "fields": {"tag_no": {"value": "P-192314", "confidence": 0.75}},
        },
        extracted_text="Equipment Data Sheet\nTag No: P-192314\nPump model: PX-8",
        verification_result={
            "status": "needs_review",
            "findings": [{
                "rule_id": "document_classification",
                "status": "inconclusive",
                "message": "No supported type-specific rules are available.",
            }],
        },
    )
    identified_response = {
        "candidates": [{
            "content": {"parts": [{
                "text": (
                    '{"action":null,"explanation":"The readable content describes equipment '
                    'data, but no type-specific checks are configured.","key_findings":'
                    '["No type-specific verification was run"],'
                    '"document_identification":"Equipment datasheet, based on its heading and pump model field.",'
                    '"human_review_required":true}'
                )
            }]}
        }]
    }
    monkeypatch.setattr(genai_service, "_call_gemini", lambda prompt: prompts.append(prompt) or identified_response)
    identified = genai_service.generate_suggestion(readable_unknown)
    assert identified["suggestion_available"] is True
    assert identified["document_identification"].startswith("Equipment datasheet")
    assert identified["human_review_required"] is True
    assert "Equipment Data Sheet" in prompts[-1]

    generic_text = "MEMBERSHIP CERTIFICATE\nMember: Ada Example\nMember ID: M-812"
    generic = SimpleNamespace(
        extracted_fields={
            "extraction_status": "success",
            "document_type": "certificate",
            "classification_confidence": 0.8,
            "fields": {"member": {"value": "Ada Example"}},
        },
        extracted_text=generic_text,
        verification_result={
            "status": "needs_review",
            "findings": [{
                "rule_id": "document_specific_verification",
                "status": "not_performed",
                "message": "No certificate-specific checks are configured.",
            }],
        },
    )
    generic_result = genai_service.generate_suggestion(generic)
    assert generic_result["suggestion_available"] is True
    assert generic_result["action"] is None
    assert generic_result["human_review_required"] is True
    assert generic_text.replace("\n", "\\n") in prompts[-1]

    incomplete = _document(
        _extracted_fields(subtotal=None, tax=None),
        verify_document(_extracted_fields(subtotal=None, tax=None)),
    )
    monkeypatch.setattr(genai_service, "_call_gemini", lambda prompt: prompts.append(prompt) or _gemini_response())
    incomplete_result = genai_service.generate_suggestion(incomplete)
    assert incomplete_result["action"] is None
    assert incomplete_result["human_review_required"] is True
    assert incomplete_result["suggestion_available"] is True
    assert incomplete_result["adjusted"] is True
    assert "not all support an approval" in incomplete_result["explanation"]


def test_missing_gemini_key_returns_labeled_local_evidence_summary(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(genai_service, "load_env", lambda: None)
    monkeypatch.setattr(
        genai_service,
        "_call_gemini",
        lambda prompt: pytest.fail("Gemini must not be called without a key"),
    )
    document = SimpleNamespace(
        extracted_fields={
            "extraction_status": "success",
            "document_type": "unknown",
            "fields": {"member": {"value": "Ada Example"}},
        },
        extracted_text="MEMBERSHIP RECORD\nMember: Ada Example",
        verification_result={
            "status": "needs_review",
            "findings": [{
                "status": "not_performed",
                "message": "No document-specific rules are configured.",
            }],
        },
    )
    result = genai_service.generate_suggestion(document)
    assert result["suggestion_available"] is True
    assert result["action"] is None
    assert result["human_review_required"] is True
    assert result["model"].startswith("Built-in evidence summary")
    assert "1 check(s) were inconclusive" in result["explanation"]


def test_validated_ai_suggestion_stays_advisory(monkeypatch):
    monkeypatch.setattr(genai_service, "_call_gemini", lambda prompt: _gemini_response())
    suggestion = genai_service.generate_suggestion(_document())
    assert suggestion["action"] == "approve"
    assert suggestion["explanation"]
    assert suggestion["human_review_required"] is False
    assert suggestion["adjusted"] is False


def test_ai_actions_are_withheld_when_findings_do_not_support_them(monkeypatch):
    extraction = _extracted_fields(date=None)
    document = _document(extraction, verify_document(extraction))
    monkeypatch.setattr(
        genai_service,
        "_call_gemini",
        lambda prompt: _gemini_response(
            "request_correction",
            "The invoice date is missing and must be supplied.",
        ),
    )
    suggestion = genai_service.generate_suggestion(document)
    assert suggestion["action"] == "request_correction"

    monkeypatch.setattr(
        genai_service,
        "_call_gemini",
        lambda prompt: _gemini_response(
            "reject",
            "The invoice date is missing and must be supplied.",
        ),
    )
    unsafe_rejection = genai_service.generate_suggestion(document)
    assert unsafe_rejection["action"] is None
    assert unsafe_rejection["human_review_required"] is True
    assert unsafe_rejection["adjusted"] is True


def test_existing_role_guard_and_human_decision_audit_are_preserved():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            request = ReviewRequest(title="Invoice review", status="under_review", submitter="submitter-1")
            db.add(request)
            db.flush()
            document = Document(
                request_id=request.id,
                original_filename="invoice.pdf",
                stored_filename="invoice.pdf",
                storage_path="invoice.pdf",
                mime_type="application/pdf",
                size_bytes=10,
                sha256="0" * 64,
                extracted_fields={"extraction_status": "success"},
                verification_result={
                    "status": "needs_review",
                    "findings": [{
                        "rule_id": "total_consistency",
                        "status": "not_performed",
                        "category": "unavailable_evidence",
                        "message": "Subtotal and tax are unavailable.",
                    }],
                },
            )
            db.add(document)
            db.flush()
            db.add(AuditEvent(
                request_id=request.id,
                actor="gemini",
                action="ai_suggestion_generated",
                details={
                    "document_id": document.id,
                    "action": "reject",
                    "explanation": "A confirmed mismatch was found.",
                },
            ))
            db.commit()
            request_id = request.id

        with Session(engine) as db:
            with pytest.raises(HTTPException) as denied:
                load_for_review(db, request_id, ("submitter-2", "submitter"))
            assert denied.value.status_code == 403

            with pytest.raises(HTTPException) as own:
                load_for_review(db, request_id, ("submitter-1", "reviewer"))
            assert own.value.status_code == 403

            with pytest.raises(HTTPException) as missing_override:
                record_decision(
                    request_id,
                    ReviewDecision(decision="approve", reason="Evidence reviewed"),
                    db,
                    ("reviewer-1", "reviewer"),
                )
            assert missing_override.value.status_code == 400
            assert "override reason is required" in missing_override.value.detail

            decision = record_decision(
                request_id,
                ReviewDecision(
                    decision="approve",
                    reason="Evidence reviewed",
                    override_reason="Rechecked the original against the source PO",
                ),
                db,
                ("reviewer-1", "reviewer"),
            )
            assert decision.status == "pending_approval"
            event = db.scalar(select(AuditEvent).where(AuditEvent.action == "reviewer_recommendation"))
            assert event.actor == "reviewer-1"
            assert event.details["reason"] == "Evidence reviewed"
            assert event.details["previous_status"] == "under_review"
            assert event.details["override_reason"] == "Rechecked the original against the source PO"
            with pytest.raises(HTTPException) as final_status:
                load_for_review(db, request_id, ("reviewer-1", "reviewer"))
            assert final_status.value.status_code == 409
            final_decision = record_decision(
                request_id,
                ReviewDecision(
                    decision="approve",
                    reason="Approved after second review",
                    override_reason="Approver confirmed against primary evidence",
                ),
                db,
                ("approver-1", "approver"),
            )
            assert final_decision.status == "approved"
            final_event = db.scalar(select(AuditEvent).where(AuditEvent.action == "approve"))
            assert final_event.actor == "approver-1"
            assert final_event.details["reason"] == "Approved after second review"
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_approver_can_record_final_rejection_after_reviewer_stage():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            request = ReviewRequest(
                title="Review rejection",
                status="pending_approval",
                submitter="submitter-1",
            )
            db.add(request)
            db.flush()
            document = Document(
                request_id=request.id,
                original_filename="invoice.pdf",
                stored_filename="invoice-reject.pdf",
                storage_path="invoice.pdf",
                mime_type="application/pdf",
                size_bytes=10,
                sha256="2" * 64,
                extracted_fields={"extraction_status": "success"},
                verification_result={"status": "needs_review", "findings": []},
            )
            db.add(document)
            db.commit()
            request_id = request.id

        with Session(engine) as db:
            result = record_decision(
                request_id,
                ReviewDecision(decision="reject", reason="Evidence confirms the submitted values are invalid."),
                db,
                ("approver-1", "approver"),
            )
            assert result.status == "rejected"
            event = db.scalar(select(AuditEvent).where(AuditEvent.action == "reject"))
            assert event.actor == "approver-1"
            assert event.details["new_status"] == "rejected"
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_latest_ai_failure_clears_prior_document_recommendation():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            request = ReviewRequest(title="AI retry", status="under_review", submitter="submitter-1")
            db.add(request)
            db.flush()
            document = Document(
                request_id=request.id,
                original_filename="invoice.pdf",
                stored_filename="ai-retry.pdf",
                storage_path="invoice.pdf",
                mime_type="application/pdf",
                size_bytes=10,
                sha256="3" * 64,
                extracted_fields={"extraction_status": "success"},
                verification_result={"status": "checks_passed", "findings": []},
            )
            db.add(document)
            db.flush()
            db.add_all([
                AuditEvent(
                    request_id=request.id,
                    actor="gemini",
                    action="ai_suggestion_generated",
                    details={"document_id": document.id, "action": "approve"},
                ),
                AuditEvent(
                    request_id=request.id,
                    actor="gemini",
                    action="ai_suggestion_failed",
                    details={"document_id": document.id, "error": "Gemini unavailable"},
                ),
            ])
            db.commit()
            assert stored_ai_suggestion(db, request.id, document.id) is None
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_human_can_decide_when_ai_has_no_recommendation():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            request = ReviewRequest(
                title="Invoice review",
                status="under_review",
                submitter="submitter-1",
            )
            db.add(request)
            db.flush()
            document = Document(
                request_id=request.id,
                original_filename="invoice.pdf",
                stored_filename="invoice-no-ai.pdf",
                storage_path="invoice.pdf",
                mime_type="application/pdf",
                size_bytes=10,
                sha256="1" * 64,
                extracted_fields={"extraction_status": "success"},
                verification_result={
                    "status": "needs_review",
                    "findings": [{
                        "rule_id": "total_consistency",
                        "status": "not_performed",
                        "message": "Subtotal and tax are unavailable.",
                    }],
                },
            )
            db.add(document)
            db.commit()
            request_id = request.id

        with Session(engine) as db:
            result = record_decision(
                request_id,
                ReviewDecision(
                    decision="approve",
                    reason="I checked the source document manually.",
                ),
                db,
                ("reviewer-1", "reviewer"),
            )
            assert result.status == "pending_approval"
            decision_event = db.scalar(
                select(AuditEvent).where(AuditEvent.action == "reviewer_recommendation")
            )
            assert decision_event.details["ai_suggestion"] is None
            assert decision_event.details["ai_source"] is None
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_role_header_rejects_unknown_roles():
    with pytest.raises(HTTPException) as error:
        get_actor(x_user="test", x_role="unknown")
    assert error.value.status_code == 403


def test_request_creation_requires_submitter_identity():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            payload = RequestCreate(title="Invoice review", submitter="submitter-1")
            with pytest.raises(HTTPException) as role_error:
                create_request(payload, db, ("reviewer-1", "reviewer"))
            assert role_error.value.status_code == 403

            with pytest.raises(HTTPException) as identity_error:
                create_request(payload, db, ("other-user", "submitter"))
            assert identity_error.value.status_code == 403

            created = create_request(payload, db, ("submitter-1", "submitter"))
            assert created.submitter == "submitter-1"
            assert created.status == "submitted"
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_document_upload_requires_submitter_role_and_request_ownership():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            request = ReviewRequest(title="Invoice review", status="submitted", submitter="owner")
            db.add(request)
            db.commit()

            reviewer_file = UploadFile(filename="document.pdf", file=BytesIO(b"%PDF-"))
            with pytest.raises(HTTPException) as role_error:
                asyncio.run(upload_document(
                    request.id,
                    reviewer_file,
                    db,
                    ("reviewer-1", "reviewer"),
                ))
            assert role_error.value.status_code == 403
            assert reviewer_file.file.closed

            other_submitter_file = UploadFile(filename="document.pdf", file=BytesIO(b"%PDF-"))
            with pytest.raises(HTTPException) as owner_error:
                asyncio.run(upload_document(
                    request.id,
                    other_submitter_file,
                    db,
                    ("other-user", "submitter"),
                ))
            assert owner_error.value.status_code == 403
            assert other_submitter_file.file.closed
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_submitter_can_request_advisory_ai_for_own_upload(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(
        ai_router,
        "generate_suggestion",
        lambda document, po=None: {
            "action": None,
            "explanation": "The document was analyzed, but a human review is needed.",
            "key_findings": ["No specialized checks are configured."],
            "human_review_required": True,
            "suggestion_available": True,
        },
    )
    try:
        with Session(engine) as db:
            request = ReviewRequest(
                title="Document review",
                status="under_review",
                submitter="owner",
            )
            db.add(request)
            db.flush()
            document = Document(
                request_id=request.id,
                original_filename="policy.txt",
                stored_filename="policy.txt",
                storage_path="policy.txt",
                mime_type="text/plain",
                size_bytes=20,
                sha256="2" * 64,
                extracted_text="POLICY\nOwner: Finance",
                extracted_fields={
                    "extraction_status": "success",
                    "document_type": "unknown",
                    "fields": {},
                },
                verification_result={"status": "needs_review", "findings": []},
            )
            db.add(document)
            db.commit()
            request_id = request.id

            result = ai_router.create_ai_suggestion(
                request_id,
                db,
                ("owner", "submitter"),
            )

            assert result["suggestion_available"] is True
            assert result["action"] is None
            assert db.scalar(
                select(AuditEvent).where(
                    AuditEvent.request_id == request_id,
                    AuditEvent.action == "ai_suggestion_generated",
                )
            ) is not None
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_upload_route_returns_classification_and_document_specific_checks(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(documents_router.router)

    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(documents_router, "_store_ai_review", lambda *args: None)
    try:
        with Session(engine) as db:
            request = ReviewRequest(title="Invoice review", submitter="owner", status="submitted")
            db.add(request)
            db.commit()
            request_id = request.id

        pdf = fitz.open()
        page = pdf.new_page()
        text = (
            "TAX INVOICE\nVendor: Acme Supplies\nInvoice No: INV-2026-1\n"
            "Date: 22 October 2026\nSubtotal: 100.00\nGST: 18.00\nTotal: 118.00"
        )
        for index, line in enumerate(text.splitlines()):
            page.insert_text((72, 72 + index * 16), line)
        contents = pdf.tobytes()
        pdf.close()

        with TestClient(app) as client:
            response = client.post(
                f"/api/requests/{request_id}/documents",
                headers={"X-User": "owner", "X-Role": "submitter"},
                files={"file": ("invoice.pdf", contents, "application/pdf")},
            )
        assert response.status_code == 201
        payload = response.json()
        assert payload["extracted_fields"]["document_type"] == "invoice"
        assert payload["extracted_fields"]["classification_confidence"] >= 0.65
        assert payload["verification_result"]["status"] == "checks_passed"
        assert payload["verification_result"]["approval_decision"] == "human_review_required"

        with Session(engine) as db:
            saved_request = db.get(ReviewRequest, request_id)
            actions = list(db.scalars(
                select(AuditEvent.action).where(AuditEvent.request_id == request_id)
            ))
            assert saved_request.status == "under_review"
            assert "document_uploaded" in actions
            assert "extraction_completed" in actions
            assert "verification_completed" in actions
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_upload_route_accepts_supported_image_documents(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(documents_router.router)

    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(documents_router, "_store_ai_review", lambda *args: None)
    text = "MEMBERSHIP CERTIFICATE\nMember: Ada Example\nMember ID: M-812"
    monkeypatch.setattr(
        documents_router,
        "extract_text",
        lambda path: {
            "filename": path.name,
            "text": text,
            "pages": [{"page_number": 1, "text": text}],
        },
    )
    try:
        with Session(engine) as db:
            request = ReviewRequest(title="Membership document", submitter="owner", status="submitted")
            db.add(request)
            db.commit()
            request_id = request.id

        image = BytesIO()
        Image.new("RGB", (20, 20), "white").save(image, format="PNG")
        with TestClient(app) as client:
            response = client.post(
                f"/api/requests/{request_id}/documents",
                headers={"X-User": "owner", "X-Role": "submitter"},
                files={"file": ("certificate.png", image.getvalue(), "image/png")},
            )

        assert response.status_code == 201
        payload = response.json()
        assert payload["mime_type"] == "image/png"
        assert payload["extracted_fields"]["document_type"] == "certificate"
        assert payload["extracted_fields"]["fields"]["member"]["value"] == "Ada Example"
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def _invoice_pdf_bytes(total: str) -> bytes:
    text = (
        "TAX INVOICE\nVendor: Acme Supplies\nInvoice No: INV-LIFECYCLE-1\n"
        "Date: 2026-10-22\nSubtotal: 100.00\nTax: 18.00\n"
        f"Total: {total}"
    )
    pdf = fitz.open()
    page = pdf.new_page()
    for index, line in enumerate(text.splitlines()):
        page.insert_text((72, 72 + index * 16), line)
    contents = pdf.tobytes()
    pdf.close()
    return contents


def test_correction_resubmission_and_two_stage_decision_workflow(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(requests_router.router)
    app.include_router(documents_router.router)
    app.include_router(reviews_router.router)

    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))
    ai_documents = []

    def mock_ai(document, po=None):
        ai_documents.append({
            "id": document.id,
            "type": document.extracted_fields["document_type"],
            "text": document.extracted_text,
            "total": document.extracted_fields["fields"]["total"]["value"],
        })
        return {
            "action": None,
            "explanation": "This is an advisory test response based on this document version.",
            "key_findings": ["Current document text was received."],
            "document_identification": "Invoice, identified from the TAX INVOICE heading.",
            "human_review_required": True,
            "suggestion_available": True,
            "model": "mocked-test-model",
        }

    monkeypatch.setattr(documents_router, "generate_suggestion", mock_ai)
    try:
        with TestClient(app) as client:
            submitter = {"X-User": "submitter-1", "X-Role": "submitter"}
            reviewer = {"X-User": "reviewer-1", "X-Role": "reviewer"}
            approver = {"X-User": "approver-1", "X-Role": "approver"}
            created = client.post(
                "/api/requests",
                headers=submitter,
                json={"title": "Invoice lifecycle test", "submitter": "submitter-1"},
            )
            assert created.status_code == 201
            request_id = created.json()["id"]

            first_upload = client.post(
                f"/api/requests/{request_id}/documents",
                headers=submitter,
                files={"file": ("first.pdf", _invoice_pdf_bytes("118.00"), "application/pdf")},
            )
            assert first_upload.status_code == 201
            first_document = first_upload.json()
            assert "Subtotal: 100.00" in first_document["extracted_text"]
            assert first_document["extracted_fields"]["document_type"] == "invoice"
            assert first_document["extracted_fields"]["fields"]["total"]["value"] == "118.00"
            assert first_document["verification_result"]["status"] == "checks_passed"
            assert ai_documents[-1]["id"] == first_document["id"]

            early_approval = client.post(
                f"/api/requests/{request_id}/decision",
                headers=approver,
                json={"decision": "approve", "reason": "Should be blocked before review"},
            )
            assert early_approval.status_code == 409

            correction = client.post(
                f"/api/requests/{request_id}/decision",
                headers=reviewer,
                json={"decision": "request_correction", "reason": "Please confirm the total against the signed source."},
            )
            assert correction.status_code == 200
            assert correction.json()["status"] == "correction_requested"
            assert client.post(
                f"/api/requests/{request_id}/decision",
                headers=reviewer,
                json={"decision": "approve", "reason": "No longer authorized at correction stage"},
            ).status_code == 409

            audit = client.get(f"/api/audit?request_id={request_id}")
            correction_event = next(
                event for event in audit.json()
                if event["action"] == "request_correction"
            )
            assert correction_event["details"]["reason"] == "Please confirm the total against the signed source."

            resubmission = client.post(
                f"/api/requests/{request_id}/documents",
                headers=submitter,
                files={"file": ("corrected.pdf", _invoice_pdf_bytes("118.00"), "application/pdf")},
            )
            assert resubmission.status_code == 201
            second_document = resubmission.json()
            assert second_document["id"] != first_document["id"]
            assert second_document["extracted_fields"]["fields"]["total"]["value"] == "118.00"
            assert len(ai_documents) == 2
            assert ai_documents[0]["id"] != ai_documents[1]["id"]
            assert ai_documents[1]["total"] == "118.00"

            with Session(engine) as db:
                saved_request = db.get(ReviewRequest, request_id)
                assert saved_request.status == "under_review"
                assert saved_request.current_version == 2

            reviewer_approval = client.post(
                f"/api/requests/{request_id}/decision",
                headers=reviewer,
                json={"decision": "approve", "reason": "Corrected invoice matches the reviewed values."},
            )
            assert reviewer_approval.status_code == 200
            assert reviewer_approval.json()["status"] == "pending_approval"
            assert client.post(
                f"/api/requests/{request_id}/decision",
                headers=reviewer,
                json={"decision": "approve", "reason": "Reviewer cannot finalize"},
            ).status_code == 409

            disagreement = client.post(
                f"/api/requests/{request_id}/decision",
                headers=approver,
                json={"decision": "reject", "reason": "Attempt without override"},
            )
            assert disagreement.status_code == 400
            assert "reviewer recommendation" in disagreement.json()["detail"]

            final = client.post(
                f"/api/requests/{request_id}/decision",
                headers=approver,
                json={"decision": "approve", "reason": "Final approval after reviewer recommendation."},
            )
            assert final.status_code == 200
            assert final.json()["status"] == "approved"

            final_audit = client.get(f"/api/audit?request_id={request_id}").json()
            assert {event["action"] for event in final_audit} >= {
                "document_uploaded",
                "document_resubmitted",
                "extraction_completed",
                "verification_completed",
                "ai_suggestion_generated",
                "request_correction",
                "reviewer_recommendation",
                "approve",
            }
            final_decision = next(event for event in final_audit if event["action"] == "approve")
            assert final_decision["actor"] == "approver-1"
            assert final_decision["details"]["reason"] == "Final approval after reviewer recommendation."
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.mark.parametrize(
    ("filename", "text", "expected_type", "expected_fields"),
    [
        (
            "invoice-variant.pdf",
            "INVOICE\nSeller: Northwind Paper\nBill To: Acme Ltd\n"
            "Invoice #: INV-ALT-9\nInvoice Date: 2025-03-12\n"
            "Payment Due: 2025-04-11\nCurrency: USD\n"
            "Paper 2 10.00 20.00\nSubtotal: $20.00\n"
            "Sales Tax: $1.60\nAmount Due: $21.60",
            "invoice",
            {"supplier": "Northwind Paper", "invoice_number": "INV-ALT-9", "due_date": "2025-04-11"},
        ),
        (
            "purchase-order.pdf",
            "PURCHASE ORDER\nPO Number: PO-100\nOrder Date: 2025-02-01\n"
            "Supplier: Acme Supplies\nBuyer: Example Co\nShip To: Warehouse A\n"
            "Currency: USD\nWidget 2 10.00 20.00\nSubtotal: 20.00\n"
            "Tax: 0.00\nOrder Total: 20.00",
            "purchase_order",
            {"supplier": "Acme Supplies", "po_number": "PO-100", "order_date": "2025-02-01"},
        ),
        (
            "receipt.pdf",
            "PAYMENT RECEIPT\nMerchant: Corner Store\nTransaction ID: TX-44\n"
            "Transaction Date: 2025-01-02\nPayment Method: Card\n"
            "Coffee 1 4.00 4.00\nSubtotal: 4.00\nTax: 0.32\nAmount Paid: 4.32",
            "receipt",
            {"supplier": "Corner Store", "receipt_number": "TX-44", "date": "2025-01-02"},
        ),
        (
            "contract.pdf",
            "SERVICE AGREEMENT\nContract Title: Support Services\n"
            "This Agreement is entered between Alpha LLC and Beta Inc., effective today.\n"
            "Effective Date: 2025-01-01\nExpiry Date: 2026-01-01\n"
            "Contract Value: USD 1200\nPayment Terms: Net 30\n"
            "Provider shall provide support during business hours.",
            "contract",
            {"contract_title": "Support Services", "effective_date": "2025-01-01"},
        ),
        (
            "certificate.pdf",
            "CERTIFICATE OF INSPECTION\nCertificate ID: CERT-2026-77\n"
            "Issued By: Northwind Testing\nDate: 2026-10-20\n"
            "This certifies the inspected equipment met the listed standards.",
            "certificate",
            {"certificate_id": "CERT-2026-77"},
        ),
    ],
)
def test_real_pdf_extraction_classification_and_verification(
    tmp_path, filename, text, expected_type, expected_fields
):
    pdf_path = tmp_path / filename
    pdf = fitz.open()
    page = pdf.new_page()
    for index, line in enumerate(text.splitlines()):
        page.insert_text((72, 72 + index * 16), line)
    pdf.save(pdf_path)
    pdf.close()

    ocr_result = extract_text(pdf_path)
    extracted = extract_fields(ocr_result)
    verification = verify_document(extracted)

    assert extracted["extraction_status"] == "success"
    assert extracted["document_type"] == expected_type
    assert extracted["classification_confidence"] >= 0.65
    for field, expected_value in expected_fields.items():
        assert extracted["fields"][field]["value"] == expected_value
        assert extracted["fields"][field]["evidence"]["page"] == 1
    assert verification["document_type"] == expected_type
    assert verification["findings"]
    assert verification["approval_decision"] == "human_review_required"

    document = _document(extracted, verification)
    document.extracted_text = ocr_result["text"]
    context = genai_service.build_context(document)
    assert context["document_type"]["value"] == expected_type
    assert context["verification_findings"]
    assert any(finding.get("evidence") for finding in context["verification_findings"])
    assert expected_fields[next(iter(expected_fields))] in str(context["fields"])


def test_unknown_and_unreadable_text_do_not_claim_successful_classification():
    unknown = extract_fields({
        "text": "Notes from the team meeting next Tuesday.",
        "pages": [{"page_number": 1, "text": "Notes from the team meeting next Tuesday."}],
    })
    assert unknown["extraction_status"] == "success"
    assert unknown["document_type"] == "unknown"
    assert verify_document(unknown)["findings"][0]["status"] == "inconclusive"

    unreadable = extract_fields({"text": " \n ", "pages": [{"text": ""}]})
    assert unreadable["extraction_status"] == "needs_review"
    assert unreadable["document_type"] == "unknown"


def test_missing_fields_and_item_arithmetic_are_distinguished():
    text = (
        "PURCHASE ORDER\nPO Number: PO-101\nOrder Date: 2025-02-01\n"
        "Supplier: Acme Supplies\nWidget 2 10.00 25.00\n"
        "Order Total: 25.00"
    )
    extracted = extract_fields({"text": text, "pages": [{"page_number": 1, "text": text}]})
    verification = verify_document(extracted)
    arithmetic = next(
        finding for finding in verification["findings"]
        if finding["rule_id"] == "line_item_arithmetic"
    )
    assert arithmetic["status"] == "flag"
    assert arithmetic["category"] == "confirmed_error"

    absent = extract_fields({"text": "PAYMENT RECEIPT\nThank you", "pages": []})
    checks = verify_document(absent)
    assert any(
        finding["category"] == "missing_information"
        for finding in checks["findings"]
    )
    assert not any(
        finding["category"] == "confirmed_error"
        for finding in checks["findings"]
    )


@pytest.mark.skipif(
    not ocr_service.TESSERACT_EXE.is_file(),
    reason="Scanned PDF OCR requires a local Tesseract executable.",
)
def test_scanned_pdf_uses_ocr_fallback(tmp_path):
    source = fitz.open()
    page = source.new_page(width=900, height=700)
    page.insert_text((80, 100), "TAX INVOICE", fontsize=36)
    page.insert_text((80, 170), "Vendor: Acme Supplies", fontsize=28)
    page.insert_text((80, 220), "Invoice No: INV-OCR-1", fontsize=28)
    page.insert_text((80, 270), "Total: 118.00", fontsize=28)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    image_bytes = pixmap.tobytes("png")
    source.close()

    scanned = fitz.open()
    scanned_page = scanned.new_page(width=900, height=700)
    scanned_page.insert_image(scanned_page.rect, stream=image_bytes)
    path = tmp_path / "scanned-invoice.pdf"
    scanned.save(path)
    scanned.close()

    result = extract_fields(extract_text(path))
    assert result["document_type"] == "invoice"
    assert result["fields"]["invoice_number"]["value"] == "INV-OCR-1"
    assert result["fields"]["total"]["value"] == "118.00"
