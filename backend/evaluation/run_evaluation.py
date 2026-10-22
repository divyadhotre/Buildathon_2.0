"""Measure the real extraction + verification pipeline on a synthetic test set.

Run from the backend folder:   python evaluation/run_evaluation.py

It writes evaluation/results.json, which GET /api/evaluation serves to the UI.
Run it before and after changing extraction rules to compare: the previous run
is kept inside the new file.
"""

import json
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import fitz  # PyMuPDF

from app.services.extraction_service import extract_fields
from app.services.ocr_service import extract_text
from app.services.verification_service import verify_invoice

SET_DIR = HERE / "test_set"
RESULTS = HERE / "results.json"
FIELDS = ("supplier", "invoice_number", "date", "subtotal", "tax", "total")
AMOUNTS = {"subtotal", "tax", "total"}
SUPPLIERS = [
    "Aster Supplies", "Northstar Components", "Meadow Office Mart",
    "Kiran Traders", "Blue Harbor Logistics", "Orchid Stationers",
    "Vega Packaging", "Lotus Hardware",
]
KINDS = (
    ["clean"] * 11 + ["missing_date"] * 4 + ["missing_invoice_number"] * 3
    + ["missing_supplier"] * 2 + ["total_mismatch"] * 4
)


def make_cases() -> list[dict]:
    """Fictional invoices. `written` = what the PDF says; `issues` = injected problems."""
    rng = random.Random(2026)
    cases = []
    for i, kind in enumerate(KINDS, 1):
        subtotal = float(rng.randrange(1000, 90000, 50))
        tax = round(subtotal * 0.18, 2)
        total = round(subtotal + tax, 2)
        written = {
            "supplier": rng.choice(SUPPLIERS),
            "invoice_number": f"INV-2026-{100 + i}",
            "date": f"{rng.randint(1, 28)} October 2026",
            "subtotal": subtotal, "tax": tax, "total": total,
        }
        issues = []
        if kind.startswith("missing_"):
            field = kind.removeprefix("missing_")
            written.pop(field)
            issues = [f"missing_field:{field}"]
        elif kind == "total_mismatch":
            written["total"] = round(total + rng.choice([250, 500, 1000]), 2)
            issues = ["total_mismatch"]
        cases.append({
            "file": f"invoice_{i:02d}_{kind}.pdf", "kind": kind,
            "written": written, "issues": issues,
            "labels": {  # layout variety: some labels the extractor may not know
                "supplier": ["Vendor", "Supplier", "Seller"][i % 3],
                "total": ["Total", "Grand Total", "Total Amount"][(i // 3) % 3],
                "currency": ["", "INR ", "Rs. "][(i // 2) % 3],
            },
        })
    return cases


def write_pdf(case: dict) -> None:
    w, lab = case["written"], case["labels"]
    money = lambda v: f"{lab['currency']}{v:,.2f}"
    lines = ["TAX INVOICE"]
    if "supplier" in w:
        lines.append(f"{lab['supplier']}: {w['supplier']}")
    if "invoice_number" in w:
        lines.append(f"Invoice No: {w['invoice_number']}")
    if "date" in w:
        lines.append(f"Date: {w['date']}")
    lines += [
        f"Subtotal: {money(w['subtotal'])}",
        f"GST (18%): {money(w['tax'])}",
        f"{lab['total']}: {money(w['total'])}",
    ]
    doc = fitz.open()
    page = doc.new_page()
    y = 90
    for line in lines:
        page.insert_text((72, y), line, fontsize=12)
        y += 22
    doc.save(SET_DIR / case["file"])
    doc.close()


def amount(value):
    cleaned = re.sub(r"[^0-9.]", "", str(value if value is not None else ""))
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def matches(field, got, want) -> bool:
    if field in AMOUNTS:
        return amount(got) == amount(want)
    return str(got or "").strip().lower() == str(want).strip().lower()


def predicted_issues(verification: dict) -> set[str]:
    found = set()
    for f in verification.get("findings", []):
        if f.get("status") != "flag":
            continue
        if f.get("rule_id") == "required_field":
            found.add(f"missing_field:{f.get('field')}")
        elif f.get("rule_id") == "total_consistency":
            found.add("total_mismatch" if "expected_total" in f else "cannot_verify_total")
    return found


def main() -> None:
    SET_DIR.mkdir(exist_ok=True)
    cases = make_cases()
    for case in cases:
        write_pdf(case)
    (SET_DIR / "manifest.json").write_text(json.dumps(cases, indent=2), encoding="utf-8")

    detected = missed = false_alerts = 0
    per_field = {f: [0, 0] for f in FIELDS}  # [correct, evaluated]
    failures = []

    for case in cases:
        extracted = extract_fields(extract_text(SET_DIR / case["file"]))
        flagged = predicted_issues(verify_invoice(extracted))
        expected = set(case["issues"])
        detected += len(flagged & expected)
        missed += len(expected - flagged)
        false_alerts += len(flagged - expected)

        problems = []
        if expected - flagged:
            problems.append("missed: " + ", ".join(sorted(expected - flagged)))
        if flagged - expected:
            problems.append("false alert: " + ", ".join(sorted(flagged - expected)))
        for field, want in case["written"].items():
            got = extracted["fields"].get(field, {}).get("value")
            per_field[field][1] += 1
            if matches(field, got, want):
                per_field[field][0] += 1
            else:
                problems.append(f"{field}: read {got!r}, document says {want!r}")
        if problems:
            failures.append({"file": case["file"], "problems": problems})

    correct = sum(c for c, _ in per_field.values())
    evaluated = sum(n for _, n in per_field.values())
    clean = sum(1 for c in cases if not c["issues"])

    previous = None
    if RESULTS.is_file():
        old = json.loads(RESULTS.read_text(encoding="utf-8"))
        previous = {k: old.get(k) for k in (
            "generated_at", "extraction_accuracy", "detected_issues", "missed_issues", "false_alerts")}

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_invoices": len(cases),
        "detected_issues": detected,
        "missed_issues": missed,
        "false_alerts": false_alerts,
        "extraction_accuracy": round(correct / evaluated, 4),
        "fields_evaluated": evaluated,
        "per_field_accuracy": {f: round(c / n, 4) if n else None for f, (c, n) in per_field.items()},
        "failures": failures,
        "previous": previous,
        "test_set": (
            f"{len(cases)} synthetic digital PDFs ({clean} clean, {len(cases) - clean} with "
            "injected issues), fixed random seed 2026, listed in evaluation/test_set/manifest.json"
        ),
        "methodology": (
            "Fictional invoices are generated by this script. Ground truth is what each PDF "
            "prints plus the issues deliberately injected (missing date, invoice number or "
            "supplier; total different from subtotal + tax). The real pipeline (PDF text, "
            "regex field extraction, deterministic checks) runs on every file. Issues: "
            "detected = injected issues that were flagged, missed = injected issues not "
            "flagged, false alerts = flags with no injected issue. Field accuracy = printed "
            "fields read exactly (amounts compared numerically). Layouts vary on purpose "
            "(Vendor/Supplier/Seller, Total/Grand Total/Total Amount, currency prefixes). "
            "Digital PDFs only: scanned-image OCR quality is not measured here, and results "
            "on synthetic data do not predict accuracy on real invoices."
        ),
    }
    RESULTS.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(f"Invoices: {len(cases)} | issues detected {detected}, missed {missed}, false alerts {false_alerts}")
    print(f"Field accuracy: {correct}/{evaluated} = {correct / evaluated:.1%}")
    print("Per field:", {f: f"{c}/{n}" for f, (c, n) in per_field.items()})
    for item in failures[:8]:
        print(" -", item["file"], "|", "; ".join(item["problems"]))
    print(f"Saved {RESULTS}")


if __name__ == "__main__":
    main()