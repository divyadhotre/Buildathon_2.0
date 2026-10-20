import { useEffect, useState } from "react";
import {
  Activity, ArrowUpRight, BadgeCheck, Bell, CheckCircle2, ChevronRight,
  CircleAlert, Clock3, FileCheck2, FileText, LayoutDashboard, Search,
  ShieldCheck, UploadCloud, Users
} from "lucide-react";
import { getHealth } from "./services/api";

const sampleItems = [
  { id: "INV-1042", supplier: "Northstar Supplies", amount: "₹24,780.00", status: "Needs review", tone: "amber", issue: "Subtotal and tax need review", initials: "NS" },
  { id: "INV-1041", supplier: "Aster Office Systems", amount: "₹8,450.00", status: "In review", tone: "blue", issue: "Required fields extracted", initials: "AO" },
  { id: "INV-1039", supplier: "Bluepeak Logistics", amount: "₹16,200.00", status: "Approved", tone: "green", issue: "Human decision recorded", initials: "BL" }
];

function Status({ tone, children }) {
  return <span className={`status status-${tone}`}><span className="status-dot" />{children}</span>;
}

export default function App() {
  const [health, setHealth] = useState("checking");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    getHealth()
      .then(() => setHealth("connected"))
      .catch(() => setHealth("offline"));
  }, []);

  const filtered = sampleItems.filter((item) =>
    `${item.id} ${item.supplier} ${item.status}`.toLowerCase().includes(query.toLowerCase())
  );

  function handleDemoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice(`Selected "${file.name}". Upload API is not connected yet; this is a UI scaffold.`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={22} /></div>
          <div><strong>DocuSure<span> AI</span></strong><small>DOCUMENT OPERATIONS</small></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          <a className="nav-item active" href="#overview"><LayoutDashboard size={18} />Overview</a>
          <a className="nav-item" href="#requests"><FileText size={18} />Document reviews <span className="nav-count">3</span></a>
          <a className="nav-item" href="#upload"><UploadCloud size={18} />Submit document</a>
          <a className="nav-item" href="#history"><Activity size={18} />Audit history</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="security-card"><ShieldCheck size={18} /><div><b>Human-led decisions</b><p>Flags support reviewers. They do not approve documents automatically.</p></div></div>
          <div className="user-profile"><div className="avatar">DD</div><div><b>Demo Reviewer</b><small>Prototype workspace</small></div><ChevronRight size={16} /></div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb">Workspace <ChevronRight size={14} /> <b>Overview</b></div>
          <div className="top-actions">
            <span className={`connection ${health}`}><span />{health === "connected" ? "API connected" : health === "offline" ? "API offline" : "Checking API"}</span>
            <button className="icon-button" aria-label="Notifications"><Bell size={18} /></button>
            <div className="avatar small">DD</div>
          </div>
        </header>

        <section className="page-heading">
          <div><div className="eyebrow">DOCUMENT CONTROL CENTER</div><h1>Good evening, team.</h1><p>One place to review documents, understand flags and record accountable decisions.</p></div>
          <a className="primary-button" href="#upload"><UploadCloud size={17} /> Submit invoice</a>
        </section>

        <section className="notice-bar"><div className="notice-icon"><CircleAlert size={18} /></div><div><b>Prototype workspace</b><p>Sample records below are illustrative UI data. Upload, OCR and review APIs are not wired up yet.</p></div><span className="prototype-tag">DEMO DATA</span></section>

        <section className="stats-grid">
          <div className="stat-card"><div className="stat-top"><span>Total requests</span><div className="stat-icon slate"><FileText size={18} /></div></div><div className="stat-value">24</div><div className="stat-foot">Illustrative sample count</div></div>
          <div className="stat-card"><div className="stat-top"><span>Needs review</span><div className="stat-icon amber"><CircleAlert size={18} /></div></div><div className="stat-value">06</div><div className="stat-foot"><span className="dot-amber" /> Flags need human attention</div></div>
          <div className="stat-card"><div className="stat-top"><span>In review</span><div className="stat-icon blue"><Clock3 size={18} /></div></div><div className="stat-value">04</div><div className="stat-foot">Awaiting reviewer action</div></div>
          <div className="stat-card"><div className="stat-top"><span>Approved</span><div className="stat-icon green"><BadgeCheck size={18} /></div></div><div className="stat-value">14</div><div className="stat-foot">Human decision required</div></div>
        </section>

        <section className="content-grid">
          <div className="panel requests-panel" id="requests">
            <div className="panel-heading"><div><h2>Recent document reviews</h2><p>Track status and open the next review.</p></div><button className="text-button" onClick={() => setNotice("The complete review queue will be connected when the requests API is implemented.")}>View all <ArrowUpRight size={15} /></button></div>
            <div className="table-tools"><div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoice or supplier..." /></div><span className="table-count">{filtered.length} sample records</span></div>
            <div className="review-list">
              {filtered.map((item) => <div className="review-row" key={item.id}>
                <div className="file-icon"><FileText size={19} /></div>
                <div className="review-main"><b>{item.supplier}</b><small>{item.id} · Invoice</small><span className="mobile-issue">{item.issue}</span></div>
                <div className="review-issue">{item.issue}</div>
                <div className="review-end"><b>{item.amount}</b><Status tone={item.tone}>{item.status}</Status></div>
                <button className="row-action" aria-label={`Open ${item.id}`} onClick={() => setNotice(`${item.id} is sample data. Detail and decision APIs are not implemented yet.`)}><ChevronRight size={18} /></button>
              </div>)}
              {filtered.length === 0 && <div className="empty-state">No sample records match that search.</div>}
            </div>
            <div className="panel-footer"><span><Users size={15} /> Human review stays in control</span><span>Illustrative data</span></div>
          </div>

          <div className="right-column">
            <div className="panel upload-panel" id="upload">
              <div className="panel-heading"><div><h2>Submit a document</h2><p>Start a new invoice review.</p></div><div className="upload-heading-icon"><UploadCloud size={19} /></div></div>
              <label className="drop-zone"><input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleDemoUpload} /><div className="upload-circle"><UploadCloud size={22} /></div><b>Choose an invoice file</b><span>PDF, PNG or JPG · Max size will be enforced by API</span><span className="browse-label">Browse files</span></label>
              {notice && <div className="inline-notice">{notice}</div>}
              <div className="upload-note"><ShieldCheck size={16} /><span>Use synthetic sample documents only. Secure upload is not implemented yet.</span></div>
            </div>
            <div className="panel principles-panel">
              <div className="principle-title"><CheckCircle2 size={18} /><h2>Review principles</h2></div>
              <div className="principle"><div className="principle-number">01</div><div><b>Evidence before conclusions</b><p>Show the field, check result and source evidence together.</p></div></div>
              <div className="principle"><div className="principle-number">02</div><div><b>Corrections stay traceable</b><p>Keep extracted values separate from reviewer edits.</p></div></div>
              <div className="principle"><div className="principle-number">03</div><div><b>People make decisions</b><p>Automation flags issues; authorized humans decide.</p></div></div>
            </div>
          </div>
        </section>

        <footer className="footer" id="history"><span><FileCheck2 size={15} /> DocuSure AI · Buildathon 2.0 prototype</span><span><span className="footer-dot" /> Foundation scaffold · not production-ready</span></footer>
      </main>
    </div>
  );
}
