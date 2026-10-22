const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

// Demo identity sent as X-User / X-Role headers. Not real authentication.
export const session = { user: "demo-reviewer", role: "Reviewer" };

// Values the backend accepts for /decision
export const DECISIONS = {
  approve: "approve",
  reject: "reject",
  request_correction: "request_correction"
};

export const arr = (x) =>
  Array.isArray(x) ? x : x?.items ?? x?.results ?? x?.requests ?? x?.events ?? [];

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "X-User": session.user,
        "X-Role": session.role.toLowerCase(),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error(
      `Cannot reach backend at ${API_BASE}. Start FastAPI and check CORS for this frontend port.`
    );
  }

  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    let detail = typeof data === "object" && data !== null ? data.detail || data.message : data;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join("; ");
    throw new Error(
      typeof detail === "string" ? detail : `Request failed with status ${response.status}`
    );
  }
  return data;
}

const send = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
const id = encodeURIComponent;

/* ---------- mapping backend data to what the screens expect ---------- */
const PO_PREFIX = "PO__"; // backend has no document "kind", so PO files are marked by name
const isPo = (d) => (d.original_filename || "").startsWith(PO_PREFIX);
const clean = (n) => (n || "").replace(PO_PREFIX, "");
const utc = (s) => (s && !/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? `${s}Z` : s);

const LABELS = {
  total: "Total amount", supplier: "Supplier", invoice_number: "Invoice number",
  date: "Invoice date", purchase_order: "Purchase order", subtotal: "Subtotal", tax: "Tax"
};
const KEYS = Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [v, k]));
const ORDER = Object.keys(LABELS); // total first, so it is the "amount" field
const STATUS = {
  submitted: "Submitted", under_review: "Under review", approved: "Approved",
  rejected: "Rejected", correction_requested: "Correction requested"
};
const DECISION_ACTIONS = ["approve", "reject", "request_correction"];

function toChecks(result) {
  return (result?.findings || []).map((f) => {
    const flagged = f.status === "flag";
    const cannotVerify = /cannot verify/i.test(f.message || "");
    return {
      rule: f.rule_id,
      type: !flagged ? "passed" : f.rule_id === "required_field" ? "missing" : cannotVerify ? "unreadable" : "inconsistent",
      message: f.message,
      field: f.field,
      evidence: f.expected_total != null
        ? `expected ${f.expected_total}, found ${f.observed_total}, difference ${f.difference}`
        : undefined
    };
  });
}

function build(req, docs = [], events = []) {
  const sorted = [...docs].sort((a, b) => a.id - b.id);
  const invoices = sorted.filter((d) => !isPo(d));
  const pos = sorted.filter(isPo);
  const inv = invoices.at(-1);
  const po = pos.at(-1);
  const ef = inv?.extracted_fields || {};
  const raw = ef.fields || {};

  const fixes = {};
  events
    .filter((e) => e.action === "field_corrected" && e.details?.document_id === inv?.id)
    .sort((a, b) => a.id - b.id)
    .forEach((e) => { fixes[e.details.field] = e.details.new_value; });

  const fields = ORDER.filter((k) => k in raw).map((k) => ({
    name: LABELS[k],
    value: fixes[k] ?? raw[k].value,
    original_value: raw[k].value,
    source: raw[k].source === "regex_text_match" ? "Text match" : raw[k].source,
    page: raw[k].evidence?.page,
    file: clean(inv?.original_filename),
    snippet: raw[k].evidence?.snippet
    // confidence intentionally omitted: backend value is a fixed 0.9, not a real OCR score
  }));

  const checks = toChecks(inv?.verification_result);
  const flags = checks.filter((c) => c.type !== "passed");

  // Latest Gemini suggestion saved for the current invoice (stored as an audit event).
  const stored = events
    .filter((e) => e.action === "ai_suggestion_generated" && e.details?.document_id === inv?.id)
    .sort((a, b) => b.id - a.id)[0];
  const ai = stored ? {
    decision: stored.details.action,
    reason: stored.details.explanation,
    key_findings: stored.details.key_findings || [],
    model: stored.details.model,
    adjusted: !!stored.details.adjusted,
    created_at: utc(stored.created_at)
  } : null;

  const poAmount = po?.extracted_fields?.fields?.total;
  const last = events
    .filter((e) => DECISION_ACTIONS.includes(e.action))
    .sort((a, b) => b.id - a.id)[0];

  return {
    id: req.id,
    title: req.title,
    supplier: fixes.supplier ?? raw.supplier?.value ?? req.title,
    invoice_number: fixes.invoice_number ?? raw.invoice_number?.value ?? "",
    total_amount: fixes.total ?? raw.total?.value ?? "—",
    status: STATUS[req.status] || req.status,
    submitter: req.submitter,
    created_at: utc(req.created_at),
    extraction_status: inv ? ef.extraction_status || "unknown" : "no_document",
    open_flags: flags.length,
    fields,
    checks,
    documents: sorted.map((d) => ({
      id: d.id,
      name: clean(d.original_filename),
      kind: isPo(d) ? "po" : "invoice",
      version: (isPo(d) ? pos : invoices).indexOf(d) + 1,
      is_current: d === inv || d === po
    })),
    reference: po
      ? { amount: poAmount?.value ?? "—", source: `${clean(po.original_filename)}${poAmount?.evidence?.page ? ` · page ${poAmount.evidence.page}` : ""}` }
      : null,
    ai_suggestion: ai,
    decision: last
      ? { decision: last.action, actor: last.actor, created_at: utc(last.created_at), reason: last.details?.reason }
      : null
  };
}

/* ---------- API functions ---------- */
export const getHealth = () => apiRequest("/health");

export async function listRequests() {
  const requests = arr(await apiRequest("/api/requests?limit=100"));
  return Promise.all(
    requests.map(async (r) => {
      const docs = await apiRequest(`/api/requests/${id(r.id)}/documents`).catch(() => []);
      return build(r, arr(docs));
    })
  );
}

export async function getRequest(requestId) {
  const [req, docs, events] = await Promise.all([
    apiRequest(`/api/requests/${id(requestId)}`),
    apiRequest(`/api/requests/${id(requestId)}/documents`),
    apiRequest(`/api/audit?request_id=${id(requestId)}`)
  ]);
  return build(req, arr(docs), arr(events));
}

export const getRequestDocuments = (requestId) =>
  apiRequest(`/api/requests/${id(requestId)}/documents`);

export const createRequest = (p = {}) =>
  apiRequest("/api/requests", send("POST", {
    title: p.supplier || "Invoice review",
    submitter: session.user,
    notes: p.notes
  }));

// kind: "invoice" | "po"
export function uploadDocument(requestId, file, kind = "invoice") {
  const upload = kind === "po"
    ? new File([file], PO_PREFIX + file.name, { type: file.type })
    : file;
  const formData = new FormData();
  formData.append("file", upload);
  return apiRequest(`/api/requests/${id(requestId)}/documents`, { method: "POST", body: formData });
}

export function decide(requestId, decision, reason, actor = session.user, extra = {}) {
  return apiRequest(
    `/api/requests/${id(requestId)}/decision`,
    send("POST", {
      decision: DECISIONS[decision] || decision, actor, reason,
      override_reason: extra.override_reason, review_seconds: extra.review_seconds
    })
  );
}

export const correctField = (requestId, label, value, reason) =>
  apiRequest(
    `/api/requests/${id(requestId)}/corrections`,
    send("POST", { field: KEYS[label] || label, value: String(value), reason })
  );

// Asks the backend to run Gemini. It only stores a suggestion; it never decides.
export const requestAiSuggestion = (requestId) =>
  apiRequest(`/api/requests/${id(requestId)}/ai-suggestion`, { method: "POST" });

export async function getAuditHistory(requestId) {
  const events = arr(await apiRequest(`/api/audit${requestId ? `?request_id=${id(requestId)}` : ""}`));
  return events.map((e) => {
    const d = e.details || {};
    return {
      id: e.id,
      request_id: e.request_id,
      actor: e.actor,
      action: e.action,
      timestamp: utc(e.created_at),
      decision: DECISION_ACTIONS.includes(e.action) ? STATUS[d.new_status] || d.new_status : undefined,
      reason: [
        d.reason,
        d.explanation && `AI suggested ${d.action}: ${d.explanation}`,
        d.error && `AI suggestion failed: ${d.error}`,
        d.override_reason && `Override of AI suggestion (${d.ai_suggestion}): ${d.override_reason}`
      ].filter(Boolean).join(" — ") || undefined,
      field: d.field && LABELS[d.field],
      previous_value: d.previous_value,
      new_value: d.new_value
    };
  });
}

// No /api/evaluation endpoint exists yet, so Reports shows "not measured".
export const getEvaluation = () => apiRequest("/api/evaluation");

export const fileUrl = (doc) => (doc ? `${API_BASE}/api/documents/${id(doc.id)}/file` : "");

export { API_BASE };