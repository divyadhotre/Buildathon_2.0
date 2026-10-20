# Architecture

See the root README for the end-to-end Mermaid flow and technology rationale.

## Service boundaries
- API layer: request validation, route handlers and orchestration.
- File service: file size/type validation, safe naming, versioned storage.
- Extraction service: parse extracted text into structured fields and evidence.
- OCR service: PDF text-layer extraction first, OCR fallback for scanned pages.
- Verification service: deterministic rules and traceable findings.
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
