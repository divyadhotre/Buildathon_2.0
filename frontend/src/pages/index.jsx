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

function DocTable({ rows, onOpen }) {
  if (!rows.length) return <Empty>No documents found.</Empty>;
  return (
    <div className="table-wrap">
      <table className="documents-table">
        <thead><tr><th>DOCUMENT</th><th>SUPPLIER</th><th>AMOUNT</th><th>FLAGS</th><th>STATUS</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onOpen(r.id)}>
              <td><div className="document-cell"><FileText size={19} /><div><strong>{r.id}</strong><small>{r.ref}</small></div></div></td>
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
  return (
    <section>
      <Head eyebrow="YOUR WORKSPACE AT A GLANCE" title="Document Overview"
        sub="Review documents with evidence, context, and accountability."
        right={<button className="primary-button" onClick={() => ctx.go("upload")}><Plus size={17} /> Submit a document</button>} />
      <div className="info-banner">
        <div className="banner-icon"><ShieldCheck size={22} /></div>
        <div><strong>Evidence-first verification</strong>
          <p>Invoices are compared with an approved purchase order when one exists. AI findings are suggestions, not final decisions.</p></div>
      </div>
      <StateBox ctx={ctx} />
      <div className="metric-grid">
        <Metric icon={FileText} label="Total documents" value={rows.length} note="Stored in the database" />
        <Metric icon={Clock3} label="Awaiting review" value={pending.length} note="Need a human decision" />
        <Metric icon={CheckCircle2} label="Approved" value={count("approved")} note="Approved by a reviewer" />
        <Metric icon={AlertCircle} label="With open flags" value={pending.filter((r) => r.flags).length} note="Inspect before deciding" />
      </div>
      <div className="section-heading">
        <div><h2>Recent documents</h2><p>Open a document to inspect its evidence.</p></div>
        <button className="text-button" onClick={() => ctx.go("documents")}>View all <ArrowRight size={16} /></button>
      </div>
      <DocTable rows={rows.slice(0, 5)} onOpen={ctx.open} />
      <div className="bottom-grid">
        <div className="panel"><h3>Evidence before conclusions</h3>
          <p className="muted-text">Without an approved PO the system reports only missing fields, format errors and internal inconsistencies — never an unsupported amount mismatch.</p></div>
        <div className="panel"><h3>Document lifecycle</h3>
          <p className="muted-text">Uploaded → Extracted → Verified → In Review → Approved / Rejected</p>
          <button className="text-button" onClick={() => ctx.go("audit")}>Open audit trail <ArrowRight size={16} /></button></div>
      </div>
    </section>
  );
}

/* ---------- 2. Upload ---------- */
const checkFile = (f) =>
  !f ? "" : !/\.pdf$/i.test(f.name) ? `${f.name}: only PDF files are supported.`
    : f.size === 0 ? `${f.name}: file is empty.` : f.size > 10 * 1024 * 1024 ? `${f.name}: file is larger than 10 MB.` : "";

function Drop({ file, set, title, hint }) {
  return (
    <label className="dropzone">
      <input type="file" accept=".pdf,application/pdf" onChange={(e) => set(e.target.files?.[0] || null)} />
      <UploadCloud size={26} /><strong>{file ? file.name : title}</strong><span>{hint}</span>
    </label>
  );
}

export function Upload({ ctx }) {
  const [supplier, setSupplier] = useState("");
  const [inv, setInv] = useState(null);
  const [po, setPo] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const m = !inv ? "Select an invoice file first." : checkFile(inv) || checkFile(po);
    if (m) return setErr(m);
    setBusy(true); setErr("");
    let rid;
    try {
      const r = await api.createRequest({ supplier: supplier.trim() || undefined, type: "invoice" });
      rid = r.id ?? r.request_id;
      await api.uploadDocument(rid, inv, "invoice");
      if (po) await api.uploadDocument(rid, po, "po");
      ctx.notify(`Request ${rid} submitted. Extraction and checks have run.`);
      ctx.reload(); ctx.open(rid);
    } catch (x) {
      setErr(rid ? `Request ${rid} was saved, but an upload failed: ${x.message}. Open it from My Documents to retry.` : x.message);
      ctx.reload();
    } finally { setBusy(false); }
  }

  return (
    <section>
      <Head eyebrow="START A NEW REVIEW" title="Submit a document" sub="Upload an invoice and, if you have one, its approved purchase order." />
      {ctx.role !== "Submitter" && (
        <div className="notice">
          <AlertCircle size={18} />
          <span>You are uploading as {ctx.user}. You will not be able to review this request later. Switch to Submitter first.</span>
          <button onClick={() => ctx.setRole("Submitter")}>Switch</button>
        </div>
      )}
      <div className="submit-grid">
        <form className="panel upload-form" onSubmit={submit}>
          <label htmlFor="sup">Supplier name (optional)</label>
          <input id="sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Aster Supplies" />
          <label>Invoice file *</label>
          <Drop file={inv} set={setInv} title="Choose invoice" hint="PDF only · up to 10 MB" />
          <label>Purchase order (optional)</label>
          <Drop file={po} set={setPo} title="Choose approved PO" hint="Used as the reference for expected amount" />
          {!po && <p className="form-hint">No PO attached: only missing fields, format errors and internal inconsistencies will be flagged.</p>}
          {err && <p className="error-message">{err}</p>}
          <div className="form-footer">
            <p>AI findings assist the reviewer. They never approve an invoice.</p>
            <button className="primary-button" disabled={busy}>{busy ? "Uploading…" : "Submit for verification"}</button>
          </div>
        </form>
        <div className="panel">
          <h3>What happens next</h3>
          {[["Extract", "Fields are read from the file with OCR."], ["Verify", "Required fields, totals and PO reference are checked."],
            ["Review", "A reviewer approves, rejects or requests correction."], ["Audit", "Every step is recorded with user and time."]].map(([t, d], i) => (
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
  const all = ctx.requests.map(view);
  const rows = all.filter((r) =>
    `${r.id} ${r.supplier} ${r.ref}`.toLowerCase().includes(q.toLowerCase()) && (!st || r.status === st));
  const statuses = [...new Set(all.map((r) => r.status))];
  return (
    <section>
      <Head eyebrow="DOCUMENT WORKFLOW" title="My Documents" sub="Search every submitted invoice and open its details." />
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
  const queue = ctx.requests.map(view).filter(isPending);
  const id = ctx.selectedId ?? queue[0]?.id;
  return (
    <section>
      <Head eyebrow="REVIEWER QUEUE" title="Pending Review" sub="Check the original document, the evidence and the AI suggestion, then record your decision." />
      <StateBox ctx={ctx} />
      <div className="review-layout">
        <aside className="queue">
          <p className="eyebrow">AWAITING DECISION ({queue.length})</p>
          {queue.length ? queue.map((r) => (
            <button key={r.id} className={`queue-item ${r.id === id ? "on" : ""}`} onClick={() => ctx.open(r.id)}>
              <strong>{r.id}</strong><span>{r.supplier}</span><Status v={r.status} />
              {r.flags > 0 && <em>{r.flags} flag{r.flags > 1 ? "s" : ""}</em>}
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
    () => api.getRequest(id).then((r) => { setD(r); setErr(""); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (err && !d) return <div className="panel"><p className="error-message">{err}</p><button className="ghost" onClick={load}>Retry</button></div>;
  if (!d) return <div className="panel muted-text">Loading request…</div>;

  const fields = d.fields || [];
  const checks = d.checks || [];
  const current = (kind) => (d.documents || []).filter((x) => x.is_current !== false && (kind === "po" ? x.kind === "po" : x.kind !== "po")).pop();
  const invDoc = current("invoice");
  const amount = fields.find((f) => /total|amount/i.test(f.name));
  const ref = d.reference || d.po || null;
  const diff = num(amount?.value) - num(ref?.amount);
  const lowConf = amount && (amount.confidence <= 1 ? amount.confidence * 100 : amount.confidence) < 80;
  const url = api.fileUrl(invDoc);
  const isImg = /\.(png|jpe?g)$/i.test(invDoc?.name || "");
  const bb = amount?.bbox;

  const failed = /fail/.test(slug(d.status)) || /fail/.test(slug(d.extraction_status));
  const final = FINAL.includes(slug(d.status));
  const own = d.submitter && d.submitter === ctx.user;
  const canAct = ["Reviewer", "Approver"].includes(ctx.role) && !final && !own;
  const why = final ? "A final decision is already recorded."
    : own ? `This request was submitted by ${d.submitter}, which is your current user, so you cannot decide it. Switch the role in Settings (for example to Approver) to review it.`
    : !canAct ? "Your role cannot record decisions."
    : failed ? "Extraction failed: Approve is disabled. You can still reject or request a correction." : "";

  const ai = d.ai_suggestion;
  const aiKey = ai?.decision && Object.keys(api.DECISIONS).find((k) => k === ai.decision || api.DECISIONS[k] === ai.decision);

  async function decide(key) {
    if (!comment.trim()) return ctx.notify("A reviewer comment is required.");
    const differs = aiKey && aiKey !== key;
    if (differs && !override.trim()) return ctx.notify("You disagree with the AI suggestion. Add an override reason.");
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
    catch (e) { setAiErr(e.message); } finally { setAiBusy(false); }
  }

  async function saveEdit() {
    if (!edit.reason.trim()) return ctx.notify("Add a reason for the correction.");
    try { await api.correctField(id, edit.name, edit.value, edit.reason.trim()); setEdit(null); await load(); ctx.notify("Correction saved. Original value is kept."); }
    catch (e) { ctx.notify(e.message); }
  }

  return (
    <div className="detail">
      <div className="panel">
        <div className="detail-header">
          <div className="document-icon"><FileText size={23} /></div>
          <div><p className="eyebrow">{d.id ?? id}</p><h2>{d.supplier ?? d.supplier_name ?? "Supplier not identified"}</h2>
            <p className="muted-text">Submitted by {d.submitter || "—"} · {fmt(d.created_at)}</p></div>
          <Status v={d.status} />
        </div>
        {failed && <div className="notice err"><AlertCircle size={18} /><span>Extraction failed. Retry on the backend or review manually. Approval is disabled.</span></div>}

        <h3>Original invoice</h3>
        <div className="preview">
          {!url ? <Empty>No file stored for this request.</Empty> : isImg ? (
            <div className="imgbox"><img src={url} alt="Original invoice" />
              {Array.isArray(bb) && <i className="hl" title="Extracted amount" style={{ left: `${bb[0] * 100}%`, top: `${bb[1] * 100}%`, width: `${bb[2] * 100}%`, height: `${bb[3] * 100}%` }} />}</div>
          ) : <iframe title="Original invoice" src={`${url}#page=${amount?.page || 1}`} />}
        </div>
        {invDoc && <p className="form-hint">{invDoc.name} · version {invDoc.version ?? 1}{amount?.page ? ` · amount found on page ${amount.page}` : ""}{!isImg && url ? " · highlight shown for images only" : ""}</p>}

        <h3 className="subsection-title">Amount evidence</h3>
        <div className="compare">
          <div><span>Extracted invoice amount</span><strong>{amount?.value ?? "—"}</strong><small>Source: {src(amount)}</small></div>
          <div><span>Expected PO amount</span><strong>{ref?.amount ?? "—"}</strong><small>Source: {ref ? ref.source || ref.name || "Approved PO" : "No approved reference"}</small></div>
          <div className={ref && diff ? "warn" : ""}><span>Difference</span><strong>{ref ? money(diff) : "—"}</strong><small>OCR confidence: {pct(amount?.confidence)}</small></div>
        </div>
        {!ref && <p className="form-hint">No approved PO linked, so no amount mismatch is claimed.</p>}
        {lowConf && <p className="form-hint warn-text">OCR confidence is low. A digit may be misread — check the highlighted amount in the original.</p>}
        {amount?.snippet && (
          <div className="snippet">
            <small>Evidence from the document{amount.page ? ` (page ${amount.page})` : ""}</small>
            <pre>{amount.snippet}</pre>
          </div>
        )}

        <h3 className="subsection-title">Extracted fields</h3>
        {fields.length ? (
          <div className="table-wrap"><table className="documents-table fields">
            <thead><tr><th>FIELD</th><th>EXTRACTED (ORIGINAL)</th><th>CURRENT</th><th>CONFIDENCE</th><th>SOURCE</th><th /></tr></thead>
            <tbody>{fields.map((f) => {
              const orig = f.original_value ?? f.value;
              const changed = f.original_value != null && f.original_value !== f.value;
              const editing = edit?.name === f.name;
              return (
                <tr key={f.name} className="static">
                  <td>{f.name}</td><td>{orig ?? <em className="muted-text">missing</em>}</td>
                  <td>{editing ? <input value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} /> : <strong className={changed ? "changed" : ""}>{f.value ?? "—"}</strong>}</td>
                  <td>{pct(f.confidence)}</td><td>{src(f)}</td>
                  <td>{editing ? (<div className="inline-edit"><input placeholder="Reason" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
                    <button className="text-button" onClick={saveEdit}>Save</button><button className="text-button" onClick={() => setEdit(null)}>Cancel</button></div>)
                    : canAct && <button className="text-button" onClick={() => setEdit({ name: f.name, value: f.value ?? "", reason: "" })}>Correct</button>}</td>
                </tr>);
            })}</tbody></table></div>
        ) : <Empty>No fields extracted yet.</Empty>}

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
        <h3>AI suggestion</h3>
        {aiBusy ? <p className="muted-text">Gemini is analysing the extracted fields and checks…</p>
          : ai ? (
            <div className="ai-box">
              <strong>Suggested: {ai.decision.replaceAll("_", " ")}</strong>
              <p>{ai.reason}</p>
              {ai.key_findings?.length > 0 && <ul>{ai.key_findings.map((k, i) => <li key={i}>{k}</li>)}</ul>}
              <small>Suggestion only · {ai.model} · {fmt(ai.created_at)}{ai.adjusted ? " · adjusted by a safety rule" : ""}</small>
            </div>
          ) : <p className="muted-text">No suggestion yet. Generate one as a second opinion.</p>}
        {aiErr && <p className="error-message">{aiErr}</p>}
        <button className="ghost" disabled={!canAct || aiBusy} onClick={generate}>
          {aiBusy ? "Generating…" : ai ? "Regenerate suggestion" : "Generate AI suggestion"}
        </button>

        <h3 className="subsection-title">Human decision</h3>
        {d.decision && <div className="human-box"><strong>{d.decision.decision}</strong> by {d.decision.actor} · {fmt(d.decision.created_at || d.decision.at)}<p>{d.decision.reason}</p></div>}
        <label htmlFor="c">Reviewer comment *</label>
        <textarea id="c" rows={4} disabled={!canAct} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Explain your decision or the correction needed" />
        {aiKey && <><label htmlFor="o">Override reason (needed if you disagree with the AI)</label>
          <textarea id="o" rows={2} disabled={!canAct} value={override} onChange={(e) => setOverride(e.target.value)} /></>}
        {why && <div className="notice"><AlertCircle size={18} /><span>{why}</span></div>}
        <div className="decision-buttons">
          <button className="decision approve" disabled={!canAct || busy || failed} onClick={() => decide("approve")}><Check size={16} /> Approve</button>
          <button className="decision reject" disabled={!canAct || busy} onClick={() => decide("reject")}><X size={16} /> Reject</button>
          <button className="decision correction" disabled={!canAct || busy} onClick={() => decide("request_correction")}><FileCheck2 size={16} /> Request correction</button>
        </div>
        <p className="form-hint">The server re-checks permissions. This screen only hides what you cannot do.</p>
      </div>
    </div>
  );
}

/* ---------- 5. Audit Trail ---------- */
export function AuditTrail({ ctx }) {
  const [rid, setRid] = useState(ctx.selectedId || "");
  const [ev, setEv] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setEv(null);
    api.getAuditHistory(rid || undefined).then((x) => { setEv(api.arr(x)); setErr(""); }).catch((e) => setErr(e.message));
  }, [rid]);
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
      {err && <div className="notice err"><AlertCircle size={18} /><span>{err}</span></div>}
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
  useEffect(() => { api.getEvaluation().then(setM).catch((e) => setErr(e.message)); }, []);
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
        <div><strong>{measured ? "Measured on a synthetic labelled test set" : "Not measured yet"}</strong>
          <p>{measured ? `${m.test_set}. Run on ${fmt(m.generated_at)}.` : err || "Run `python evaluation/run_evaluation.py` in the backend folder to measure the pipeline."}</p></div></div>
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
  const rules = [["Submitter", "Create requests, upload and replace files, answer corrections", "Cannot decide any request"],
    ["Reviewer", "Inspect evidence, correct fields, request correction, approve or reject", "Cannot decide own submissions"],
    ["Approver", "Everything a reviewer can do, plus final decisions and summaries", "Cannot decide own submissions"]];
  return (
    <section>
      <Head eyebrow="PROFILE & ACCESS" title="Settings" sub="Demo identity and role permissions." />
      <div className="impact-grid">
        <div className="panel"><h3>Profile</h3>
          <div className="field-row"><span>User</span><strong>{ctx.user}</strong></div>
          <label htmlFor="role">Demo role</label>
          <select id="role" value={ctx.role} onChange={(e) => ctx.setRole(e.target.value)}>
            {["Submitter", "Reviewer", "Approver"].map((r) => <option key={r}>{r}</option>)}</select>
          <p className="form-hint">Switching role changes what the buttons allow. The backend still enforces every rule.</p></div>
        <div className="panel"><h3>Backend connection</h3>
          <p className="muted-text">{api.API_BASE}</p>
          <button className="ghost" onClick={() => api.getHealth().then(() => setHealth("Backend is reachable.")).catch((e) => setHealth(e.message))}>Check connection</button>
          {health && <p className="form-hint">{health}</p>}</div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}><h3>Role permissions</h3>
        <div className="table-wrap"><table className="documents-table fields"><thead><tr><th>ROLE</th><th>CAN</th><th>LIMIT</th></tr></thead>
          <tbody>{rules.map(([r, c, l]) => <tr className="static" key={r}><td><strong>{r}</strong></td><td>{c}</td><td>{l}</td></tr>)}</tbody></table></div></div>
    </section>
  );
}