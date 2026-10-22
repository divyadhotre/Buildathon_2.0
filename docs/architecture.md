# Architecture

See the root README for the end-to-end Mermaid flow and technology rationale.

## Service boundaries
- API layer: request validation, route handlers and orchestration.
- File service: file size/type validation, safe naming, versioned storage.
- Extraction service: parse extracted text into structured fields and evidence.
- Classification: detect common document types from extracted text patterns, retaining confidence and evidence; unfamiliar types remain usable as generic documents.
- OCR service: extract embedded PDF text and use Tesseract for scanned PDF pages or supported PNG/JPG/JPEG images.
- Extraction service: apply type-aware field patterns for invoices, purchase orders, receipts, and contracts, preserve generic labelled fields, and attach source evidence.
- Verification service: run invoice/PO/receipt required-field and available arithmetic checks, plus contract metadata findings; uncertain or unreadable documents retain explicit not-performed or inconclusive findings for human review.
- Review service: corrections, decisions, actor and timestamp.
- GenAI service: optional explanation grounded in current stored evidence.

## Key invariants
1. Never overwrite the original uploaded file.
2. Every new upload creates a version.
3. Keep machine-extracted values separate from human corrections.
4. Every check has a stable rule ID, result, message and evidence.
5. Processing failure never implies approval.
6. Human decisions include actor, timestamp and reason.
7. Authorization is enforced by the backend.

AI suggestions use bounded extracted-field values, field evidence, classification metadata, verification findings, an available purchase-order comparison, and up to 6,000 characters of extracted text. Unknown document types and unsupported checks can still receive an evidence-grounded AI analysis; unsafe or unsupported approve/reject/correction actions are withheld and require human review. Network, API, and response-validation failures remain explicit errors. AI suggestions remain separate from recorded human decisions.
