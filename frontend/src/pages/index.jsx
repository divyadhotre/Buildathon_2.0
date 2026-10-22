import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle, ArrowRight, Check, CheckCircle2, Clock3, FileCheck2,
  FileText, Plus, Search, UploadCloud, X, Activity, ShieldCheck
} from "lucide-react";
import * as api from "../services/api.js";

/* ---------- helpers ---------- */
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
const FINAL = ["approved", "rejected"];
export const view = (r) => ({
  id: r.id ?? r.request_id,
  supplier: r.supplier ?? r.supplier_name ?? r.title ?? "—",
  ref: r.invoice_number ?? r.reference ?? "",
  date: r.created_at ?? r.date,
  amount: r.total_amount ?? r.amount ?? "—",
  status: r.status ?? "—",
  document_type: r.document_type ?? "unknown",
  has_document: !!r.has_document,
  document_count: r.document_count ?? 0,
  document_filename: r.document_filename ?? null,
  extraction_status: r.extraction_status ?? "unknown",
  verification_status: r.verification_status ?? "unknown",
  flags: r.open_flags ?? r.flags_count ?? 0,
  submitter: r.submitter
});
export const isPending = (r) => !FINAL.includes(slug(r.status));
const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const pct = (c) => (c == null ? "—" : `${Math.round(c <= 1 ? c * 100 : c)}%`);
const num = (v) => parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
const money = (n) => (Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—");
const src = (f) => (f ? `${f.source || "OCR"}${f.file ? ` · ${f.file}` : ""}${f.page ? ` · page ${f.page}` : ""}` : "—");

const Status = ({ v }) => <span className={`status st-${slug(v)}`}>{v || "—"}</span>;
const Empty = ({ children }) => <div className="empty">{children}</div>;
const Head = ({ eyebrow, title, sub, right }) => (
  <div className="page-heading heading-row">
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{sub}</p></div>
    {right}
  </div>
);
const Metric = ({ icon: I, label, value, note }) => (
  <article className="metric-card">
    <div className="metric-icon"><I size={20} /></div>
    <p className="metric-label">{label}</p><h2>{value}</h2><p className="metric-note">{note}</p>
  </article>
);

const WORKFLOW_STEPS = [
  ["Submit", "A submitter provides the original or corrected document."],
  ["Verify & AI Suggestion", "Extraction, supported checks, and advisory AI run for the current version."],
  ["Review", "A reviewer inspects evidence and records a recommendation or correction request."],
  ["Approve", "An approver records the final approval or rejection."]
];

function WorkflowProgress({ request, go, open, openAudit }) {
  const final = request && FINAL.includes(slug(request.status));
  const verificationComplete = request?.extraction_status === "success"
    && request.verification_status !== "unknown";
  const correction = slug(request?.status) === "correction-requested";
  const pendingApproval = slug(request?.status) === "pending-approval";
  const activeStep = !request?.has_document || correction ? 0
    : !verificationComplete ? 1
      : pendingApproval ? 3
        : final ? WORKFLOW_STEPS.length : 2;
  const actionLabel = !request ? "Submit a document"
    : !request.has_document ? "Start new submission"
      : correction ? "View correction request"
      : final ? "View audit history" : "Open review";
  return (
    <div className="workflow-panel panel">
      <div className="section-heading">
        <div><p className="eyebrow">LIVE WORKFLOW</p><h2>{request ? `Request ${request.id}` : "Start a document review"}</h2>
          <p>{request
            ? `${request.supplier} · ${request.status}${request.has_document ? ` · ${request.document_count} document${request.document_count === 1 ? "" : "s"}` : " · awaiting upload"}`
            : "No requests yet. Submit a document to begin."}</p></div>
        {request && <Status v={request.status} />}
      </div>
      <ol className="workflow-steps" aria-label="Document workflow progress">
        {WORKFLOW_STEPS.map(([title, description], index) => {
          const complete = final || index < activeStep;
          const current = !final && index === activeStep;
          const state = complete ? "complete" : current ? "current" : "pending";
          const stepDescription = index === 0 && correction
            ? `Correction requested: ${request.correction_reason || "Review the request and upload a corrected document."}`
            : index === 0 && request?.has_document
            ? request.document_filename || description
            : index === 1 && request?.has_document
              ? request.verification_status === "unknown"
                ? "Verification results are not available yet."
                : `${request.extraction_status === "failed" ? "Extraction failed" : `Extraction ${request.extraction_status}`} · verification ${request.verification_status}${request.ai_suggestion?.suggestion_available ? " · AI suggestion available" : ""}`
              : index === 2 && request
                ? final
                  ? `Decision recorded: ${request.status}`
                    : pendingApproval ? "Reviewer recommendation recorded; awaiting approver."
                      : correction ? "Returned to submitter for correction."
                        : "Waiting for reviewer inspection."
                : index === 3 && final
                    ? `Final status: ${request.status}. Audit events remain available.`
                    : index === 3 && pendingApproval
                      ? "Awaiting the approver's final decision."
                    : description;
          return (
            <li className={`workflow-step ${state}`} key={title} aria-current={current ? "step" : undefined}>
              <span className="workflow-number">{complete ? <Check size={15} /> : index + 1}</span>
              <div><div className="workflow-step-heading"><strong>{title}</strong><span>{complete ? "Complete" : current ? "Current" : "Next"}</span></div>
                <p>{stepDescription}</p></div>
            </li>
          );
        })}
      </ol>
      <div className="workflow-footer">
        <p>{request && !request.has_document
          ? "No document is attached to this request."
          : request?.has_document && !final
          ? correction
            ? "The submitter owns the next action: replace the document on this same request. Prior versions and the correction reason remain in the audit trail."
            : pendingApproval
              ? "The reviewer completed their stage. Only an approver can record the final decision."
              : "A reviewer inspects the evidence and can recommend approval, recommend rejection, or request a correction."
          : final
            ? "The final human decision and full audit history are retained."
            : "Role permissions are enforced by the backend. Selecting a role never records or approves a decision."}</p>
        <button className="primary-button" onClick={() => {
          if (!request || !request.has_document) return go("upload");
          if (correction) return go("documents");
          if (final) return openAudit(request.id);
          return open(request.id);
        }}>
          {actionLabel}<ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function DocTable({ rows, onOpen }) {
  if (!rows.length) return <Empty>No documents found.</Empty>;
  return (
    <div className="table-wrap">
      <table className="documents-table">
        <thead><tr><th>DOCUMENT</th><th>TYPE</th><th>SUPPLIER / TITLE</th><th>AMOUNT</th><th>FINDINGS</th><th>STATUS</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onOpen(r.id)}>
              <td><div className="document-cell"><FileText size={19} /><div><strong>{r.id}</strong><small>{r.document_filename || r.ref || (r.document_count ? `${r.document_count} attached` : "No file uploaded")}</small></div></div></td>
              <td><span className="status">{String(r.document_type).replaceAll("_", " ")}</span></td>
              <td>{r.supplier}<small className="table-sub">{fmt(r.date)}</small></td>
              <td>{r.amount}</td>
              <td>{r.flags ? <span className="flag-count">{r.flags} open</span> : <span className="muted-text">None</span>}</td>
              <td><Status v={r.status} /></td>
              <td><ArrowRight size={16} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const StateBox = ({ ctx }) =>
  ctx.error ? (
    <div className="notice err"><AlertCircle size={18} /><span>{ctx.error}</span><button className="text-button" onClick={ctx.reload}>Retry</button></div>
  ) : ctx.loading ? <Empty>Loading documents…</Empty> : null;

/* ---------- 1. Dashboard ---------- */
export function Dashboard({ ctx }) {
  const rows = ctx.requests.map(view);
  const pending = rows.filter(isPending);
  const count = (s) => rows.filter((r) => slug(r.status) === s).length;
  const ready = !ctx.loading && !ctx.error;
  const recent = [...rows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const actionable = pending.filter((r) => r.has_document);
  const focus = actionable.length
    ? [...actionable].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0]
    : pending.length
      ? [...pending].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0]
    : recent[0];
  const documentCount = rows.reduce((total, row) => total + row.document_count, 0);
  return (
    <section>
      <Head eyebrow="YOUR WORKSPACE AT A GLANCE" title="Document Overview"
        sub="Review documents with evidence, context, and accountability."
        right={<button className="primary-button" onClick={() => ctx.go("upload")}><Plus size={17} /> Submit a document</button>} />
      <div className="info-banner">
        <div className="banner-icon"><ShieldCheck size={22} /></div>
        <div><strong>Evidence-first verification</strong>
          <p>Documents are classified from extracted text. Only supported checks run, and AI findings remain suggestions for human reviewers.</p></div>
      </div>
      <StateBox ctx={ctx} />
      <div className="metric-grid">
        <Metric icon={FileText} label="Uploaded documents" value={ready ? documentCount : "—"} note="Files attached to requests" />
        <Metric icon={Clock3} label="Awaiting review" value={ready ? pending.length : "—"} note="Need a human decision" />
        <Metric icon={CheckCircle2} label="Approved" value={ready ? count("approved") : "—"} note="Final human decisions" />
        <Metric icon={AlertCircle} label="With open findings" value={ready ? pending.filter((r) => r.flags).length : "—"} note="Inspect before deciding" />
      </div>
      {ready && <WorkflowProgress request={focus} go={ctx.go} open={ctx.open} openAudit={ctx.openAudit} />}
      <div className="section-heading">
        <div><h2>Recent documents</h2><p>Open a document to inspect its evidence.</p></div>
        <button className="text-button" onClick={() => ctx.go("documents")}>View all <ArrowRight size={16} /></button>
      </div>
      {ready && <DocTable rows={rows.slice(0, 5)} onOpen={ctx.open} />}
      <div className="bottom-grid">
        <div className="panel"><h3>Evidence before conclusions</h3>
          <p className="muted-text">When no related purchase order is attached, the system reports only supported missing fields, format errors, and internal inconsistencies — never an unsupported amount mismatch.</p></div>
        <div className="panel"><h3>Document lifecycle</h3>
          <p className="muted-text">Submit → evidence checks and optional AI suggestion → authorized human decision → final status and audit history.</p>
          <button className="text-button" onClick={() => ctx.go("audit")}>Open audit trail <ArrowRight size={16} /></button></div>
      </div>
    </section>
  );
}

/* ---------- 2. Upload ---------- */
const checkFile = (f) =>
  !f ? "" : !/\.(pdf|png|jpe?g|txt|docx)$/i.test(f.name) ? `${f.name}: upload a PDF, PNG, JPEG, TXT or DOCX file.`
    : f.size === 0 ? `${f.name}: file is empty.` : f.size > 10 * 1024 * 1024 ? `${f.name}: file is larger than 10 MB.` : "";

function Drop({ file, set, title, hint }) {
  return (
    <label className="dropzone">
      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,application/pdf,image/png,image/jpeg,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => set(e.target.files?.[0] || null)} />
      <UploadCloud size={26} /><strong>{file ? file.name : title}</strong><span>{hint}</span>
    </label>
  );
}

export function Upload({ ctx }) {
  const [supplier, setSupplier] = useState("");
  const [inv, setInv] = useState(null);
  const [po, setPo] = useState(null);
  const [includePo, setIncludePo] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const resubmission = ctx.resubmitId
    ? ctx.requests.map(view).find((request) => request.id === ctx.resubmitId)
    : null;

  async function submit(e) {
    e.preventDefault();
    if (ctx.role !== "Submitter") return setErr("Switch to Submitter before uploading or resubmitting a document.");
    if (resubmission && slug(resubmission.status) !== "correction-requested") {
      return setErr("This request is no longer awaiting a correction. Refresh the page and review its current status.");
    }
    const m = !inv ? "Select a document file first." : checkFile(inv) || (includePo ? checkFile(po) || (!po ? "Select the related purchase order." : "") : "");
    if (m) return setErr(m);
    setBusy(true); setErr("");
    let rid;
    try {
      if (resubmission) {
        rid = resubmission.id;
      } else {
        const r = await api.createRequest({
          supplier: supplier.trim() || undefined,
          title: supplier.trim() ? `${supplier.trim()} document review` : "Document review"
        });
        rid = r.id ?? r.request_id;
      }
      await api.uploadDocument(rid, inv);
      if (!resubmission && includePo && po) await api.uploadDocument(rid, po, "po");
      if (resubmission) ctx.clearResubmission();
      ctx.notify(
        resubmission
          ? `Corrected document uploaded to request ${rid}. Extraction, verification, and AI review were rerun.`
          : `Request ${rid} submitted. Extraction, verification, and AI review have run.`
      );
      ctx.reload(); ctx.open(rid);
    } catch (x) {
      setErr(rid ? `Request ${rid} was saved, but an upload failed: ${x.message}. Open it from My Documents to retry.` : x.message);
      ctx.reload();
    } finally { setBusy(false); }
  }

  return (
    <section>
      <Head eyebrow="START A NEW REVIEW" title="Submit a document" sub="Upload a supported document for text-based classification and evidence-led review." />
      {resubmission && <div className="notice">
        <AlertCircle size={18} />
        <span><strong>Resubmitting request {resubmission.id}.</strong> {resubmission.correction_reason || "Replace the previous document with the corrected version."} A new document version will be processed on the same request.</span>
        <button className="text-button" onClick={ctx.clearResubmission}>Cancel</button>
      </div>}
      {ctx.role !== "Submitter" && (
        <div className="notice">
          <AlertCircle size={18} />
          <span>You are uploading as {ctx.user}. You will not be able to review this request later. Switch to Submitter first.</span>
          <button onClick={() => ctx.setRole("Submitter")}>Switch</button>
        </div>
      )}
      <div className="submit-grid">
        <form className="panel upload-form" onSubmit={submit}>
          <div className="info-banner"><ShieldCheck size={20} /><div><strong>Any document type</strong>
            <p>The document type and readable fields are detected from its contents. No category selection is required.</p></div></div>
          {!resubmission && <>
            <label htmlFor="sup">Document title or organization (optional)</label>
            <input id="sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Aster Supplies contract" />
          </>}
          <label>{resubmission ? "Corrected document *" : "Document file *"}</label>
          <Drop file={inv} set={setInv} title={resubmission ? "Choose corrected document" : "Choose document"} hint="PDF, PNG, JPEG, TXT or DOCX · up to 10 MB" />
          {!resubmission && <>
            <label className="checkbox-row"><input type="checkbox" checked={includePo} onChange={(e) => setIncludePo(e.target.checked)} />
              Attach a related purchase order for optional invoice comparison</label>
          </>}
          {!resubmission && includePo && <>
            <label>Related purchase order (optional)</label>
            <Drop file={po} set={setPo} title="Choose purchase order" hint="Supported document formats · compared only when readable totals are available" />
            {!po && <p className="form-hint">No PO attached: no unsupported purchase-order amount mismatch will be claimed.</p>}
          </>}
          {err && <p className="error-message">{err}</p>}
          <div className="form-footer">
            <p>Classification and AI suggestions are advisory. An authorised human retains the decision.</p>
            <button className="primary-button" disabled={busy || ctx.role !== "Submitter"}>{busy ? "Uploading…" : resubmission ? "Resubmit corrected document" : "Submit for verification"}</button>
          </div>
        </form>
        <div className="panel">
          <h3>What happens next</h3>
          {[["Extract", "Text is extracted and a likely document type is classified."], ["Verify", "Only supported, document-specific checks are run."],
                ["Review", "An authorized reviewer or approver makes the human decision."], ["Audit", "Recorded events show available actors, times, and reasons."]].map(([t, d], i) => (
            <div className="process-step" key={t}><span>{i + 1}</span><div><strong>{t}</strong><p>{d}</p></div></div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- 3. My Documents ---------- */
export function MyDocuments({ ctx }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState("");
  const all = ctx.requests.map(view).filter((request) =>
    ctx.role !== "Submitter" || request.submitter === ctx.user
  );
  const rows = all.filter((r) =>
    `${r.id} ${r.supplier} ${r.ref}`.toLowerCase().includes(q.toLowerCase()) && (!st || r.status === st));
  const statuses = [...new Set(all.map((r) => r.status))];
  const correctionRequests = all.filter((request) =>
    slug(request.status) === "correction-requested"
  );
  return (
    <section>
      <Head eyebrow="DOCUMENT WORKFLOW" title={ctx.role === "Submitter" ? "My Documents" : "Document Repository"} sub="Search submitted documents of every detected type and open their review details." />
      {correctionRequests.length > 0 && <div className="panel">
        <h2>Corrections requested ({correctionRequests.length})</h2>
        <p className="muted-text">These requests are waiting for the submitter to provide a corrected document.</p>
        {correctionRequests.map((request) => (
          <div className="correction-card" key={request.id}>
            <div><strong>Request {request.id} · {request.document_filename || request.supplier}</strong>
              <p>{request.correction_reason || "Review the audit history for the requested correction."}</p></div>
            <button className="primary-button" onClick={() => ctx.resubmit(request.id)}>
              Upload correction <ArrowRight size={15} />
            </button>
          </div>
        ))}
      </div>}
      <div className="review-toolbar">
        <div className="search-field"><Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID, supplier or invoice number" /></div>
        <select value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <StateBox ctx={ctx} />
      {!ctx.loading && !ctx.error && (all.length ? <DocTable rows={rows} onOpen={ctx.open} /> :
        <Empty>No documents yet. <button className="text-button" onClick={() => ctx.go("upload")}>Submit your first document</button></Empty>)}
    </section>
  );
}

/* ---------- 4. Pending Review (+ detail used by My Documents too) ---------- */
export function PendingReview({ ctx }) {
  const queueStatus = ctx.role === "Approver" ? "pending-approval" : "under-review";
  const queue = ctx.requests.map(view).filter((request) =>
    slug(request.status) === queueStatus
    && request.submitter !== ctx.user
  );
  const id = ctx.selectedId ?? queue[0]?.id;
  return (
    <section>
      <Head eyebrow={ctx.role === "Approver" ? "APPROVER QUEUE" : "REVIEWER QUEUE"}
        title={ctx.role === "Approver" ? "Pending Approval" : "Pending Review"}
        sub={ctx.role === "Approver"
          ? "Review the reviewer's recommendation and record the final decision."
          : "Inspect evidence and AI assistance, then recommend approval/rejection or request a correction."} />
      <StateBox ctx={ctx} />
      <div className="review-layout">
        <aside className="queue">
          <p className="eyebrow">{ctx.role === "Approver" ? "AWAITING APPROVAL" : "AWAITING REVIEW"} ({queue.length})</p>
          {queue.length ? queue.map((r) => (
            <button key={r.id} className={`queue-item ${r.id === id ? "on" : ""}`} onClick={() => ctx.open(r.id)}>
              <strong>{r.id}</strong><span>{r.supplier}</span><Status v={r.status} />
              {r.flags > 0 && <em>{r.flags} open finding{r.flags > 1 ? "s" : ""}</em>}
            </button>
          )) : <Empty>Nothing waiting for review.</Empty>}
        </aside>
        {id ? <ReviewDetail key={id} id={id} ctx={ctx} /> : <Empty>Select a document from the queue.</Empty>}
      </div>
    </section>
  );
}

function ReviewDetail({ id, ctx }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [comment, setComment] = useState("");
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [openedAt] = useState(() => Date.now());

  const load = useCallback(
    () => api.getRequest(id)
      .then((r) => { setD(r); setErr(""); return r; })
      .catch((e) => { setErr(e.message); return null; }), [id]);
  useEffect(() => { load(); }, [load]);

  if (err && !d) return <div className="panel"><p className="error-message">{err}</p><button className="ghost" onClick={load}>Retry</button></div>;
  if (!d) return <div className="panel muted-text">Loading request…</div>;

  const fields = d.fields || [];
  const checks = d.checks || [];
  const current = (kind) => (d.documents || []).filter((x) => x.is_current !== false && (kind === "po" ? x.kind === "po" : x.kind !== "po")).pop();
  const invDoc = current("invoice");
  const invoiceType = d.document_type === "invoice" && d.classification_confidence >= 0.65;
  const amount = invoiceType ? fields.find((f) => /total|amount/i.test(f.name)) : null;
  const ref = invoiceType ? d.reference || d.po || null : null;
  const diff = num(amount?.value) - num(ref?.amount);
  const lowConf = amount && (amount.confidence <= 1 ? amount.confidence * 100 : amount.confidence) < 80;
  const url = api.fileUrl(invDoc);
  const isImg = /\.(png|jpe?g)$/i.test(invDoc?.name || "");
  const isPdf = /\.pdf$/i.test(invDoc?.name || "");
  const bb = amount?.bbox;

  const failed = /fail/.test(slug(d.status)) || /fail/.test(slug(d.extraction_status));
  const final = FINAL.includes(slug(d.status));
  const own = d.submitter && d.submitter === ctx.user;
  const reviewerStage = ctx.role === "Reviewer" && slug(d.status) === "under-review";
  const approverStage = ctx.role === "Approver" && slug(d.status) === "pending-approval";
  const canAct = (reviewerStage || approverStage) && !own;
  const canSuggest = !final && (
    (own && slug(d.status) === "correction-requested")
    || reviewerStage
    || approverStage
  );
  const why = final ? "A final decision is already recorded."
    : own ? `This request was submitted by ${d.submitter}, which is your current user, so you cannot decide it. Switch the role in Settings (for example to Approver) to review it.`
    : !canAct ? "Your role cannot record decisions."
    : failed ? "Extraction failed: Approve is disabled. You can still reject or request a correction."
    : slug(d.status) === "correction-requested" ? "Waiting for the submitter to upload a corrected document."
    : slug(d.status) === "pending-approval" && ctx.role === "Reviewer" ? "The reviewer recommendation is recorded. An approver must make the final decision."
    : slug(d.status) === "under-review" && ctx.role === "Approver" ? "An approver can act only after a reviewer records a recommendation."
    : "";

  const ai = d.ai_suggestion;
  const aiKey = ai?.decision && Object.keys(api.DECISIONS).find((k) => k === ai.decision || api.DECISIONS[k] === ai.decision);
  const recommendationDiffers = approverStage
    && d.reviewer_recommendation
    && d.reviewer_recommendation !== "request_correction";

  async function decide(key) {
    if (!comment.trim()) return ctx.notify("A reviewer comment is required.");
    const differs = (aiKey && aiKey !== key)
      || (approverStage && d.reviewer_recommendation && d.reviewer_recommendation !== key);
    if (differs && !override.trim()) return ctx.notify("You disagree with the AI or reviewer recommendation. Add an override reason.");
    setBusy(true);
    try {
      await api.decide(id, key, comment.trim(), ctx.user, {
        override_reason: differs ? override.trim() : undefined,
        review_seconds: Math.round((Date.now() - openedAt) / 1000)
      });
      ctx.notify("Decision recorded."); setComment(""); setOverride("");
      await load(); ctx.reload();
    } catch (e) { ctx.notify(e.message); } finally { setBusy(false); }
  }

  async function generate() {
    setAiBusy(true); setAiErr("");
    try { await api.requestAiSuggestion(id); await load(); }
    catch (e) {
      const refreshed = await load();
      setAiErr(
        refreshed?.ai_suggestion?.unavailable && refreshed.ai_suggestion.reason === e.message
          ? ""
          : e.message
      );
    } finally { setAiBusy(false); }
  }

  async function saveEdit() {
    if (!edit.reason.trim()) return ctx.notify("Add a reason for the correction.");
    try { await api.correctField(id, edit.name, edit.value, edit.reason.trim()); setEdit(null); await load(); ctx.notify("Correction saved. Original value is kept."); }
    catch (e) { ctx.notify(e.message); }
  }

  return (
    <div className="detail">
      <div className="panel">
        {err && <div className="notice err"><AlertCircle size={18} /><span>{err}</span><button className="text-button" onClick={load}>Retry</button></div>}
        <div className="detail-header">
          <div className="document-icon"><FileText size={23} /></div>
          <div><p className="eyebrow">{d.id ?? id}</p><h2>{d.supplier ?? d.supplier_name ?? "Document review"}</h2>
            <p className="muted-text">Submitted by {d.submitter || "—"} · {fmt(d.created_at)}</p></div>
          <Status v={d.status} />
        </div>
        <div className="check uncertain">
          <div><span className="check-type">classification</span><strong>Detected type: {String(d.document_type || "unknown").replaceAll("_", " ")}</strong>
            <em>Type-match score: {d.document_type === "unknown" ? "no supported match" : pct(d.classification_confidence)}</em></div>
          <p>{d.classification_evidence || "No supporting classification evidence is available."}</p>
          {d.document_type === "unknown" && d.extraction_status === "success" && (
            <small>Text was extracted, but the local rules did not match a supported type. This is not Gemini's confidence; readable unknown documents can still receive an AI review.</small>
          )}
        </div>
        {d.extracted_text && <details className="snippet extracted-text">
          <summary>View extracted text evidence</summary>
          <pre>{d.extracted_text}</pre>
        </details>}
        {failed && <div className="notice err"><AlertCircle size={18} /><span>Extraction failed. Retry on the backend or review manually. Approval is disabled.</span></div>}

        <h3>Original document</h3>
        <div className="preview">
          {!url ? <Empty>No file stored for this request.</Empty> : isImg ? (
            <div className="imgbox"><img src={url} alt="Original invoice" />
              {Array.isArray(bb) && <i className="hl" title="Extracted amount" style={{ left: `${bb[0] * 100}%`, top: `${bb[1] * 100}%`, width: `${bb[2] * 100}%`, height: `${bb[3] * 100}%` }} />}</div>
          ) : isPdf ? <iframe title="Original document" src={`${url}#page=${amount?.page || 1}`} />
            : <div className="download-preview"><FileText size={30} /><p>Preview this file using its extracted text evidence above.</p>
              <a href={url} target="_blank" rel="noreferrer">Open or download original file</a></div>}
        </div>
        {invDoc && <p className="form-hint">{invDoc.name} · version {invDoc.version ?? 1}{amount?.page ? ` · amount found on page ${amount.page}` : ""}{!isImg && url ? " · highlight shown for images only" : ""}</p>}

        {invoiceType && <>
          <h3 className="subsection-title">Invoice amount evidence</h3>
          <div className="compare">
            <div><span>Extracted invoice amount</span><strong>{amount?.value ?? "—"}</strong><small>Source: {src(amount)}</small></div>
            <div><span>Purchase order amount</span><strong>{ref?.amount ?? "—"}</strong><small>Source: {ref ? ref.source || ref.name || "Related purchase order" : "No related purchase order attached"}</small></div>
            <div className={ref && diff ? "warn" : ""}><span>Difference</span><strong>{ref ? money(diff) : "—"}</strong><small>Extraction match score: {pct(amount?.confidence)}</small></div>
          </div>
          {!ref && <p className="form-hint">No related purchase order is attached, so no amount mismatch is claimed.</p>}
          {lowConf && <p className="form-hint warn-text">Extraction match score is low. Check the amount in the original.</p>}
          {amount?.snippet && (
            <div className="snippet">
              <small>Evidence from the document{amount.page ? ` (page ${amount.page})` : ""}</small>
              <pre>{amount.snippet}</pre>
            </div>
          )}
        </>}

        <h3 className="subsection-title">Extracted fields</h3>
        {invoiceType && <p className="form-hint">Confidence is a text-pattern match score, not an OCR accuracy guarantee.</p>}
        {fields.length ? (
          <div className="table-wrap"><table className="documents-table fields">
            <thead><tr><th>FIELD</th><th>EXTRACTED (ORIGINAL)</th><th>CURRENT</th><th>MATCH SCORE</th><th>SOURCE</th><th>EVIDENCE</th><th /></tr></thead>
            <tbody>{fields.map((f) => {
              const orig = f.original_value ?? f.value;
              const changed = f.original_value != null && f.original_value !== f.value;
              const editing = edit?.name === (f.key || f.name);
              return (
                <tr key={f.name} className="static">
                  <td>{f.name}</td><td>{orig ?? <em className="muted-text">missing</em>}</td>
                  <td>{editing ? <input value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} /> : <strong className={changed ? "changed" : ""}>{f.value ?? "—"}</strong>}</td>
                  <td>{pct(f.confidence)}</td><td>{src(f)}</td>
                  <td>{f.snippet ? <details className="field-evidence"><summary>View source</summary><pre>{f.snippet}</pre></details> : "—"}</td>
                  <td>{editing ? (<div className="inline-edit"><input placeholder="Reason" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
                    <button className="text-button" onClick={saveEdit}>Save</button><button className="text-button" onClick={() => setEdit(null)}>Cancel</button></div>)
                    : canAct && <button className="text-button" onClick={() => setEdit({ name: f.key || f.name, value: f.value ?? "", reason: "" })}>Correct</button>}</td>
                </tr>);
            })}</tbody></table></div>
        ) : <Empty>{invoiceType ? "No invoice fields were extracted." : "No generic structured fields are configured for this document type. Review the original and available evidence."}</Empty>}

        <h3 className="subsection-title">Verification checks</h3>
        {checks.length ? checks.map((c, i) => (
          <div className={`check ${slug(c.type)}`} key={i}>
            <div><span className="check-type">{c.type || "check"}</span><strong>{c.rule || c.name}</strong>
              {c.severity && <em>{c.severity} severity</em>}</div>
            <p>{c.message || c.reason}</p>
            {(c.field || c.evidence) && <small>Field: {c.field || "—"} · Evidence: {typeof c.evidence === "object" ? JSON.stringify(c.evidence) : c.evidence || "—"}</small>}
          </div>
        )) : <Empty>No checks have run for this request.</Empty>}
      </div>

      <div className="panel decision-panel">
        <div className="workflow-context">
          <div><span>Current stage</span><strong>{d.status}</strong></div>
          <div><span>Acting role</span><strong>{ctx.role}</strong></div>
          <div><span>Next permitted action</span><strong>{canAct ? failed ? "Reject or request correction" : "Record a reasoned human decision" : "No decision action available"}</strong></div>
        </div>
        {approverStage && d.reviewer_recommendation && <div className="notice">
          <AlertCircle size={18} />
          <span>Reviewer recommendation: <strong>{d.reviewer_recommendation.replaceAll("_", " ")}</strong>. An override reason is required if you choose a different final decision.</span>
        </div>}
        <h3>AI suggestion</h3>
        {aiBusy ?         <p className="muted-text">AI is reviewing the available document text, extracted fields and checks…</p>
          : ai ? (
            <div className={`ai-box ${ai.unavailable ? "ai-unavailable" : ""}`}>
              <strong>{ai.unavailable ? "AI review unavailable" : ai.suggestion_available
                ? ai.decision
                  ? `Suggested: ${ai.decision.replaceAll("_", " ")}`
                  : ai.model?.startsWith("Built-in")
                    ? "Evidence summary — human review required"
                    : "AI review complete — human decision required"
                : "Human review required — no AI action recommended"}</strong>
              <p>{ai.reason}</p>
              {ai.document_identification && <p><strong>AI document identification:</strong> {ai.document_identification}</p>}
              {ai.key_findings?.length > 0 && <ul>{ai.key_findings.map((k, i) => <li key={i}>{k}</li>)}</ul>}
              <small>{ai.suggestion_available
                ? `${ai.model?.startsWith("Built-in") ? "" : "Advisory analysis only · "}${ai.model || ""} · ${fmt(ai.created_at)}${ai.adjusted ? " · action withheld by a safety rule" : ""}`
                : `AI review unavailable · ${fmt(ai.created_at)}`}</small>
            </div>
          ) : <p className="muted-text">No suggestion yet. Generate one as a second opinion.</p>}
        {aiErr && <div className="notice err" role="alert"><AlertCircle size={18} /><span>{aiErr}</span></div>}
        <button className="ghost" disabled={!canSuggest || aiBusy} onClick={generate}>
          {aiBusy ? "Generating…" : ai ? "Regenerate suggestion" : "Generate AI suggestion"}
        </button>
        {own && !final && <p className="form-hint">You can request an advisory AI analysis for your own upload. Only an authorized reviewer can make the final decision.</p>}

        <h3 className="subsection-title">Human decision</h3>
        {d.decision && <div className="human-box"><strong>{d.decision.decision}</strong> by {d.decision.actor} · {fmt(d.decision.created_at || d.decision.at)}<p>{d.decision.reason}</p></div>}
        <label htmlFor="c">Reviewer comment *</label>
        <textarea id="c" rows={4} disabled={!canAct} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Explain your decision or the correction needed" />
        {(aiKey || recommendationDiffers) && <><label htmlFor="o">Override reason (needed if you disagree with the AI or reviewer recommendation)</label>
          <textarea id="o" rows={2} disabled={!canAct} value={override} onChange={(e) => setOverride(e.target.value)} /></>}
        {why && <div className="notice"><AlertCircle size={18} /><span>{why}</span></div>}
        <div className="decision-buttons">
          <button className="decision approve" disabled={!canAct || busy || failed} onClick={() => decide("approve")}><Check size={16} /> {approverStage ? "Final approve" : "Recommend approval"}</button>
          <button className="decision reject" disabled={!canAct || busy} onClick={() => decide("reject")}><X size={16} /> {approverStage ? "Final reject" : "Recommend rejection"}</button>
          {reviewerStage && <button className="decision correction" disabled={!canAct || busy} onClick={() => decide("request_correction")}><FileCheck2 size={16} /> Request correction</button>}
        </div>
        <p className="form-hint">{reviewerStage
          ? "The server re-checks reviewer permissions. A reviewer recommendation is not the final decision."
          : approverStage
            ? "The server re-checks approver permissions. This is the final decision stage."
            : "Only the role assigned to the current workflow stage can act."}</p>
      </div>
    </div>
  );
}

/* ---------- 5. Audit Trail ---------- */
export function AuditTrail({ ctx }) {
  const [rid, setRid] = useState(ctx.selectedId || "");
  const [ev, setEv] = useState(null);
  const [err, setErr] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setEv(null);
    setErr("");
    api.getAuditHistory(rid || undefined).then((x) => { setEv(api.arr(x)); setErr(""); }).catch((e) => setErr(e.message));
  }, [rid, retry]);
  const rows = (ev || []).map((e) => ({
    id: e.id,
    time: e.timestamp ?? e.created_at ?? e.time, action: e.action ?? e.event_type ?? e.type, user: e.actor ?? e.user,
    req: e.request_id, decision: e.decision, reason: e.reason ?? e.comment, field: e.field,
    prev: e.previous_value ?? e.old_value, next: e.new_value ?? e.corrected_value
  })).sort((a, b) => a.id - b.id);
  const steps = [["Uploaded", /upload/], ["Extracted", /extract/], ["Verified", /verif|check/], ["In Review", /review/], ["Approved / Rejected", /approv|reject/]];
  return (
    <section>
      <Head eyebrow="TRACEABILITY & ACCOUNTABILITY" title="Audit Trail" sub="Who did what, when, and why — including previous and corrected values."
        right={<select value={rid} onChange={(e) => setRid(e.target.value)}>
          <option value="">All requests</option>{ctx.requests.map(view).map((r) => <option key={r.id} value={r.id}>{r.id} — {r.supplier}</option>)}</select>} />
      {err && <div className="notice err"><AlertCircle size={18} /><span>{err}</span><button className="text-button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
      {rid && <div className="steps">{steps.map(([l, re]) => {
        const done = rows.some((r) => re.test(slug(r.action)));
        return <div key={l} className={done ? "done" : ""}>{done ? <Check size={14} /> : <Clock3 size={14} />}{l}</div>;
      })}</div>}
      <div className="panel">
        {ev === null && !err ? <p className="muted-text">Loading events…</p> : !rows.length ? <Empty>No audit events recorded yet.</Empty> : (
          <div className="timeline">{rows.map((r, i) => (
            <div className="timeline-item" key={i}>
              <div className="timeline-marker">{i + 1}</div>
              <div>
                <strong>{r.action}</strong>{r.decision && <Status v={r.decision} />}
                <p>{r.user || "system"} · {fmt(r.time)}{!rid && r.req ? ` · request ${r.req}` : ""}</p>
                {r.reason && <p>Reason: {r.reason}</p>}
                {(r.prev != null || r.next != null) && <p className="diff">{r.field || "Value"}: <s>{String(r.prev ?? "—")}</s> → <b>{String(r.next ?? "—")}</b></p>}
              </div>
            </div>))}</div>)}
      </div>
    </section>
  );
}

/* ---------- 6. Reports & AI Evaluation ---------- */
export function Reports() {
  const [m, setM] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    setM(null);
    api.getEvaluation()
      .then(setM)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const measured = m?.total_invoices != null;
  const v = (x, suffix = "") => (x == null ? "—" : `${x}${suffix}`);
  const acc = (x) => (x == null ? null : x <= 1 ? Math.round(x * 1000) / 10 : x);
  const a = m?.avg_review_seconds_assisted, b = m?.avg_review_seconds_manual;
  const n = m?.review_time_samples || {};
  const both = a != null && b != null && b > 0;
  const prev = m?.previous;
  return (
    <section>
      <Head eyebrow="EVALUATION & MEASUREMENT" title="AI Testing & Impact" sub="Measured results only. Nothing here is estimated." />
      <div className="info-banner"><Activity size={22} />
        <div><strong>{loading ? "Loading evaluation" : measured ? "Measured on a synthetic labelled test set" : err ? "Evaluation data unavailable" : "Not measured yet"}</strong>
          <p>{loading ? "Fetching measured evaluation results." : measured ? `${m.test_set}. Run on ${fmt(m.generated_at)}.` : err || "Run `python evaluation/run_evaluation.py` in the backend folder to measure the pipeline."}</p>
          {err && <button className="text-button" onClick={load}>Retry</button>}</div></div>
      <div className="metric-grid">
        <Metric icon={FileText} label="Test invoices" value={v(m?.total_invoices)} note="Labelled ground truth" />
        <Metric icon={CheckCircle2} label="Correctly detected issues" value={v(m?.detected_issues)} note="Injected issues that were flagged" />
        <Metric icon={AlertCircle} label="Missed issues" value={v(m?.missed_issues)} note="Injected issues not flagged" />
        <Metric icon={Activity} label="False alerts" value={v(m?.false_alerts)} note="Flags with no real issue" />
      </div>
      <div className="impact-grid">
        <div className="panel"><h3>Field extraction accuracy</h3>
          <div className="big">{acc(m?.extraction_accuracy) == null ? "—" : `${acc(m.extraction_accuracy)}%`}</div>
          <p className="muted-text">{m?.fields_evaluated ? `${m.fields_evaluated} printed fields compared with ground truth.` : "Compare extracted fields with the values printed in the document."}</p>
          {m?.per_field_accuracy && <p className="muted-text">{Object.entries(m.per_field_accuracy).map(([k, x]) => `${k} ${acc(x)}%`).join(" · ")}</p>}
          {prev?.extraction_accuracy != null && <p className="muted-text">Previous run ({fmt(prev.generated_at)}): {acc(prev.extraction_accuracy)}% accuracy, {prev.false_alerts} false alerts.</p>}</div>
        <div className="panel"><h3>Average review time</h3>
          <div className="comparison-grid">
            <div><span>Without AI suggestion</span><strong>{v(b, " s")}</strong><small>{n.manual ?? 0} decisions</small></div>
            <div><span>With AI suggestion</span><strong>{v(a, " s")}</strong><small>{n.assisted ?? 0} decisions</small></div>
          </div>
          <p className="muted-text">{both
            ? `Measured difference: ${Math.round(((b - a) / b) * 100)}%${Math.min(n.assisted, n.manual) < 5 ? " (very small sample, treat with caution)" : ""}.`
            : "No improvement figure is shown until decisions exist in both groups."}</p></div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}><h3>Test data & methodology</h3>
        <p className="muted-text">{m?.methodology || "Run the evaluation script to see the test set and method."}</p>
        <p className="muted-text">Review time = seconds from opening a request to recording the decision (browser timer, sessions over 30 minutes ignored). "With AI suggestion" = the reviewer generated a Gemini suggestion before deciding.</p></div>
      {m?.failures?.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}><h3>Representative errors</h3>
          {m.failures.slice(0, 6).map((f) => <p className="muted-text" key={f.file}><strong>{f.file}</strong> — {f.problems.join("; ")}</p>)}</div>
      )}
    </section>
  );
}

/* ---------- 7. Settings ---------- */
export function Settings({ ctx }) {
  const [health, setHealth] = useState("");
  const [aiStatus, setAiStatus] = useState(null);
  const [aiError, setAiError] = useState("");
  useEffect(() => {
    api.getAiStatus()
      .then((status) => { setAiStatus(status); setAiError(""); })
      .catch((e) => setAiError(e.message));
  }, []);
  const rules = [["Submitter", "Create requests and upload documents", "Cannot record reviewer decisions"],
    ["Reviewer", "Inspect evidence, correct fields, request correction, approve or reject", "Cannot decide own submissions"],
    ["Approver", "Same review, correction, and decision actions as Reviewer", "Cannot decide own submissions"]];
  return (
    <section>
      <Head eyebrow="PROFILE & ACCESS" title="Settings" sub="Demo identity and role permissions." />
      <div className="impact-grid">
        <div className="panel"><h3>Profile</h3>
          <div className="field-row"><span>User</span><strong>{ctx.user}</strong></div>
          <label htmlFor="role">Demo role</label>
          <select id="role" value={ctx.role} onChange={(e) => ctx.setRole(e.target.value)}>
            {["Submitter", "Reviewer", "Approver"].map((r) => <option key={r}>{r}</option>)}</select>
          <p className="form-hint">Switching role changes the demo identity and available actions; it never records a decision. A reviewer or approver must enter a review comment and explicitly select Approve, Reject, or Request correction. The backend enforces permissions. This workflow has one authorized human decision stage, not a separate second approval.</p></div>
        <div className="panel"><h3>Backend connection</h3>
          <p className="muted-text">{api.API_BASE}</p>
          <button className="ghost" onClick={() => api.getHealth().then(() => setHealth("Backend is reachable.")).catch((e) => setHealth(e.message))}>Check connection</button>
          {health && <p className="form-hint">{health}</p>}
          <h3 className="subsection-title">AI suggestion service</h3>
          {aiError ? <p className="error-message">{aiError}</p> : aiStatus
            ? <p className="form-hint">{aiStatus.configured
              ? `API key is present · ${aiStatus.model}. This confirms configuration only; Gemini availability, key permissions and quota are confirmed by a successful request.`
              : "Gemini is not configured. The built-in evidence summary remains available; add GEMINI_API_KEY to enable model-generated suggestions."}</p>
            : <p className="muted-text">Checking AI service configuration…</p>}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}><h3>Role permissions</h3>
        <p className="form-hint">Reviewer and Approver have the same decision permissions in the current backend workflow.</p>
        <div className="table-wrap"><table className="documents-table fields"><thead><tr><th>ROLE</th><th>CAN</th><th>LIMIT</th></tr></thead>
          <tbody>{rules.map(([r, c, l]) => <tr className="static" key={r}><td><strong>{r}</strong></td><td>{c}</td><td>{l}</td></tr>)}</tbody></table></div></div>
    </section>
  );
}