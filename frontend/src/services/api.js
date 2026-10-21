// API layer. Your original backend config + health check are kept as-is.
// Mock data is used until the backend endpoints exist: set VITE_USE_MOCK=false in frontend/.env to go live.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

export async function getHealth() {
  const response = await fetch(`${API_BASE}/health`);
  if (!response.ok) throw new Error("Backend health check failed");
  return response.json();
}

export const mockDocs = [
  { id: 'TEST-IMMUT-01', title: 'Immutability Verification Doc', category: 'Invoice', by: 'Tester', date: '10/20/2026', version: 'v1', status: 'Under Review', findings: 0, corrections: 1 },
  { id: 'TEST-IMMUT-01', title: 'Immutability Verification Doc', category: 'Invoice', by: 'Tester', date: '10/20/2026', version: 'v1', status: 'Under Review', findings: 0, corrections: 1 },
  { id: 'DOC-404-UNREAD', title: 'Damaged Warehouse Delivery Receipt', category: 'Other', by: 'Sarah Chen', date: '10/20/2026', version: 'v1', status: 'Processing', findings: 2,
    issues: [
      { title: 'Low Document Readability / Insufficient Text', rule: 'LOW_TEXT', field: 'raw_text', severity: 'High', detail: 'Document produced only 46 characters of extractable text. Scanned or low-resolution image requires manual reviewer inspection.', evidence: { text_length: 46 }, action: 'Inspect the document image directly in the preview pane. Re-upload a higher resolution file or enter fields manually.' },
      { title: 'Mandatory Field Missing: Document Title', rule: 'REQ_FIELD_MISSING', field: 'document_title', severity: 'High', detail: 'Mandatory field "Document Title" could not be identified from unreadable scan text.', action: 'Enter title manually or request fresh scan.' } ] },
  { id: 'DOC-8841-PASS', title: 'Acme Cloud Services - Monthly Hosting', category: 'Invoice', by: 'Sarah Chen', date: '10/17/2026', version: 'v1', status: 'Approved', findings: 0 },
  { id: 'DOC-901-MISS', title: 'Professional Competency Credential - D. Sullivan', category: 'Certificate', by: 'Sarah Chen', date: '10/19/2026', version: 'v1', status: 'Correction Required', findings: 2,
    issues: [{ title: 'Mandatory Field Missing: Issue Date', rule: 'REQ_FIELD_MISSING', field: 'issue_date', severity: 'High', detail: 'The mandatory field "Issue Date" for document type "Certificate" could not be identified during extraction.', action: 'Request an updated copy with the issue date visible.' }] },
  { id: 'DOC-9022-ARITH', title: 'Apex Hardware Supplies - Server Racks & PDU', category: 'Invoice', by: 'Sarah Chen', date: '10/19/2026', version: 'v1', status: 'Under Review', findings: 1,
    issues: [{ title: 'Amount Mismatch', rule: 'ARITH_TOTAL', field: 'total', severity: 'High', detail: 'Subtotal + tax does not equal the extracted total.', evidence: { subtotal: 1000, tax: 180, total: 1250, difference: 70 }, action: 'Verify invoice values and any additional charges.' }] },
]
export const mockAudit = [
  { actor: 'Jane Doe', role: 'Submitter', type: 'Document Uploaded', text: 'Audit trail initial upload test.', doc: 'test_audit_1792518013294', time: '10/20/2026, 11:10:13 PM' },
  { actor: 'Marcus Vance', role: 'Reviewer', type: 'Correction Requested', text: 'Correction requested by Reviewer Marcus Vance: "Missing official issue date. Please request an updated copy."', doc: 'doc_demo_cert_02', time: '10/20/2026, 10:57 PM' },
  { actor: 'Dr. Evelyn Reed', role: 'Approver', type: 'Document Approved', text: 'Approved: "Verified against active SaaS contract and budget authorization."', doc: 'doc_demo_arith_01', time: '10/20/2026, 10:57 PM' },
  { actor: 'Verification Rule Engine', role: 'Admin', type: 'Verification Completed', text: 'Verification engine evaluated 2 rules (1 issues flagged).', doc: 'doc_demo_arith_03', time: '10/19/2026, 10:57:54 PM' },
  { actor: 'Extraction Service', role: 'Admin', type: 'Extraction Completed', text: 'Document extraction finished with status: Completed. Extracted 7 structured fields.', doc: 'doc_demo_arith_03', time: '10/19/2026, 10:57:54 PM' },
]
export const mockTests = [
  ['Invoice Field Extraction', 'Extraction'], ['Required-Field Validation', 'Verification'], ['Invoice Arithmetic Precision', 'Verification'],
  ['Missing Field Detection', 'Verification'], ['Correction Immutability', 'Audit'], ['Submitter Cannot Self-Approve', 'RBAC'],
  ['Audit Trail Persistence', 'Audit'], ['Unreadable Doc Not Auto-Approved', 'Safety'], ['Dashboard Counts From Data', 'Dashboard'],
].map(([name, tag], i) => ({ name, tag, ms: 1 + (i % 3), passed: true }))

async function call(path, opts, fallback) {
  if (USE_MOCK) return fallback
  const r = await fetch(API_BASE + path, opts)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText)
  return r.json()
}
export const listRequests = () => call('/requests', {}, mockDocs)
export const getHistory = () => call('/requests/all/history', {}, mockAudit)
export const getSummary = () => call('/dashboard/summary', {}, null)
export const uploadDocument = (form) => call('/requests', { method: 'POST', body: form }, { ok: true })
export const decide = (id, body) => call(`/requests/${id}/decisions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { ok: true })
export const runTests = () => call('/health', {}, mockTests)