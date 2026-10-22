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
const fieldLabel = (key) => LABELS[key] || key.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const displayFieldValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!item || typeof item !== "object") return String(item);
      if (item.description != null) {
        const quantity = item.quantity != null ? `${item.quantity} × ` : "";
        const unitPrice = item.unit_price != null ? ` @ ${item.unit_price}` : "";
        const amount = item.amount != null ? ` = ${item.amount}` : "";
        return `${quantity}${item.description}${unitPrice}${amount}`;
      }
      return Object.entries(item)
        .filter(([key]) => key !== "evidence")
        .map(([key, part]) => `${fieldLabel(key)}: ${part}`)
        .join(", ");
    }).join("; ");
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return value;
};
const STATUS = {
  submitted: "Submitted", under_review: "Under review", pending_approval: "Pending approval", approved: "Approved",
  rejected: "Rejected", correction_requested: "Correction requested"
};
const DECISION_ACTIONS = ["approve", "reject", "request_correction", "reviewer_recommendation"];

function toChecks(result) {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  return findings.filter((f) => f && typeof f === "object").map((f) => {
    const status = f.status || "inconclusive";
    return {
      rule: f.rule_id,
      type: status === "pass" ? "passed"
        : status === "flag" ? f.category === "missing_information" ? "missing" : "inconsistent"
          : status === "not_performed" ? "not_performed" : "uncertain",
      status,
      category: f.category,
      message: f.message,
      field: f.field,
      evidence: f.evidence ?? (f.expected_total != null
        ? `expected ${f.expected_total}, found ${f.observed_total}, difference ${f.difference}`
        : undefined)
    };
  });
}

function build(req, docs = [], events = [], includeExtractedText = false) {
  const sorted = [...docs].sort((a, b) => a.id - b.id);
  const invoices = sorted.filter((d) => !isPo(d));
  const pos = sorted.filter(isPo);
  const inv = invoices.at(-1);
  const po = pos.at(-1);
  const ef = inv?.extracted_fields || {};
  const raw = ef.fields && typeof ef.fields === "object" && !Array.isArray(ef.fields) ? ef.fields : {};
  const documentType = typeof ef.document_type === "string"
    ? ef.document_type : inv?.verification_result?.document_type || "unknown";

  const fixes = {};
  events
    .filter((e) => e.action === "field_corrected" && e.details?.document_id === inv?.id)
    .sort((a, b) => a.id - b.id)
    .forEach((e) => { fixes[e.details.field] = e.details.new_value; });

  const fieldKeys = documentType === "invoice"
    ? [...ORDER.filter((k) => k in raw), ...Object.keys(raw).filter((k) => !ORDER.includes(k))]
    : Object.keys(raw);
  const fields = fieldKeys.map((k) => {
    const field = raw[k] && typeof raw[k] === "object" ? raw[k] : {};
    return {
      name: fieldLabel(k),
      key: k,
      value: displayFieldValue(fixes[k] ?? field.value),
      original_value: displayFieldValue(field.value),
      confidence: typeof field.confidence === "number" ? field.confidence : undefined,
      source: field.source === "regex_text_match" ? "Text match" : field.source,
      page: field.evidence?.page,
      file: clean(inv?.original_filename),
      snippet: field.evidence?.snippet
    };
  });

  const checks = toChecks(inv?.verification_result);
  const flags = checks.filter((c) => c.type !== "passed");
  const classificationConfidence = ef.classification_confidence ?? inv?.verification_result?.classification_confidence ?? 0;

  // Latest Gemini suggestion saved for the current invoice (stored as an audit event).
  const stored = events
    .filter((e) => ["ai_suggestion_generated", "ai_human_review_required", "ai_suggestion_failed"].includes(e.action) && e.details?.document_id === inv?.id)
    .sort((a, b) => b.id - a.id)[0];
  const ai = stored ? {
    decision: stored.details.action,
    reason: stored.details.error || stored.details.explanation,
    key_findings: stored.details.key_findings || [],
    document_identification: stored.details.document_identification,
    model: stored.details.model,
    adjusted: !!stored.details.adjusted,
    human_review_required: !!stored.details.human_review_required,
    suggestion_available: stored.action !== "ai_suggestion_failed" && stored.details.suggestion_available === true,
    unavailable: stored.action === "ai_suggestion_failed",
    created_at: utc(stored.created_at)
  } : null;
  const correctionEvent = [...events]
    .filter((event) => event.action === "request_correction")
    .sort((a, b) => b.id - a.id)[0];
  const reviewerEvent = [...events]
    .filter((event) => event.action === "reviewer_recommendation")
    .sort((a, b) => b.id - a.id)[0];

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
    extracted_text: includeExtractedText && typeof inv?.extracted_text === "string"
      ? inv.extracted_text : "",
    document_type: documentType,
    classification_confidence: typeof classificationConfidence === "number" ? classificationConfidence : 0,
    classification_evidence: ef.classification_evidence ?? null,
    has_document: !!inv,
    document_count: sorted.length,
    document_filename: inv?.original_filename ? clean(inv.original_filename) : null,
    verification_status: inv?.verification_result?.status ?? "unknown",
    open_flags: flags.length,
    fields,
    checks,
    documents: sorted.map((d) => ({
      id: d.id,
      name: clean(d.original_filename),
      kind: isPo(d) ? "po" : d.extracted_fields?.document_type || d.verification_result?.document_type || "unknown",
      version: (isPo(d) ? pos : invoices).indexOf(d) + 1,
      is_current: d === inv || d === po
    })),
    reference: po
      ? { amount: poAmount?.value ?? "—", source: `${clean(po.original_filename)}${poAmount?.evidence?.page ? ` · page ${poAmount.evidence.page}` : ""}` }
      : null,
    ai_suggestion: ai,
    correction_reason: correctionEvent?.details?.reason || null,
    reviewer_recommendation: reviewerEvent?.details?.decision || null,
    decision: last
      ? { decision: last.details?.decision || last.action, actor: last.actor, created_at: utc(last.created_at), reason: last.details?.reason }
      : null
  };
}

/* ---------- API functions ---------- */
export const getHealth = () => apiRequest("/health");

export async function listRequests() {
  const requests = arr(await apiRequest("/api/requests?limit=100"));
  return Promise.all(
    requests.map(async (r) => {
      const [docs, events] = await Promise.all([
        apiRequest(`/api/requests/${id(r.id)}/documents`),
        r.status === "correction_requested"
          ? apiRequest(`/api/audit?request_id=${id(r.id)}`)
          : Promise.resolve([])
      ]);
      return build(r, arr(docs), arr(events));
    })
  );
}

export async function getRequest(requestId) {
  const [req, docs, events] = await Promise.all([
    apiRequest(`/api/requests/${id(requestId)}`),
    apiRequest(`/api/requests/${id(requestId)}/documents`),
    apiRequest(`/api/audit?request_id=${id(requestId)}`)
  ]);
  return build(req, arr(docs), arr(events), true);
}

export const getRequestDocuments = (requestId) =>
  apiRequest(`/api/requests/${id(requestId)}/documents`);

export const createRequest = (p = {}) =>
  apiRequest("/api/requests", send("POST", {
    title: p.title || p.supplier || "Document review",
    submitter: session.user,
    notes: p.notes
  }));

// kind: "document" | "po"
export function uploadDocument(requestId, file, kind = "document") {
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
      decision: DECISION_ACTIONS.includes(e.action)
        ? STATUS[d.new_status] || d.new_status || d.decision
        : undefined,
      reason: [
        d.reason,
        d.explanation && (e.action === "ai_human_review_required"
          ? `AI did not recommend an action: ${d.explanation}`
          : d.action
            ? `AI suggested ${d.action}: ${d.explanation}`
            : `Evidence summary: ${d.explanation}`),
        d.error && `AI suggestion failed: ${d.error}`,
        d.override_reason && `Override of AI suggestion (${d.ai_suggestion}): ${d.override_reason}`
      ].filter(Boolean).join(" — ") || undefined,
      field: d.field && LABELS[d.field],
      previous_value: d.previous_value,
      new_value: d.new_value
    };
  });
}

// Evaluation results are fetched from the backend; the UI never estimates them.
export const getEvaluation = () => apiRequest("/api/evaluation");
export const getAiStatus = () => apiRequest("/api/ai/status");

export const fileUrl = (doc) => (doc ? `${API_BASE}/api/documents/${id(doc.id)}/file` : "");

export { API_BASE };