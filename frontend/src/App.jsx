import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertCircle, Bell, ChevronDown, ClipboardCheck, FileText, History,
  LayoutDashboard, Menu, Settings as Cog, ShieldCheck, UploadCloud, X
} from "lucide-react";
import * as api from "./services/api.js";
import {
  Dashboard, Upload, MyDocuments, PendingReview, AuditTrail, Reports, Settings, view, isPending
} from "./pages/index.jsx";
import "./styles.css";

const NAV = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["upload", "Upload Document", UploadCloud],
  ["documents", "My Documents", FileText],
  ["review", "Pending Review", ClipboardCheck],
  ["audit", "Audit Trail", History],
  ["reports", "Reports & AI Evaluation", Activity],
  ["settings", "Settings", Cog]
];
const PAGES = { dashboard: Dashboard, upload: Upload, documents: MyDocuments, review: PendingReview, audit: AuditTrail, reports: Reports, settings: Settings };

const USERS = { Submitter: "demo-submitter", Reviewer: "demo-reviewer", Approver: "demo-approver" };
const readPage = () => (PAGES[location.hash.replace("#", "")] ? location.hash.replace("#", "") : "dashboard");

export default function App() {
  const [page, setPage] = useState(readPage);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [role, setRole] = useState("Reviewer");
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);

  const user = USERS[role];
  api.session.role = role;
  api.session.user = user;

  const reload = useCallback(() => {
    setLoading(true);
    api.listRequests()
      .then((x) => { setRequests(api.arr(x)); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    const onHash = () => setPage(readPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [reload]);

  const go = (p) => { location.hash = p; setMenu(false); setNotice(""); };
  const ctx = {
    requests, loading, error, reload, go, role, user, selectedId,
    setRole: (r) => { setRole(r); },
    notify: setNotice,
    open: (id) => { setSelectedId(id); go("review"); }
  };

  const Page = PAGES[page];
  const title = NAV.find((n) => n[0] === page)[1];
  const pendingCount = requests.map(view).filter(isPending).length;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-logo"><ShieldCheck size={25} /></div>
          <div><div className="brand-name">Docu<span>Verify</span></div><div className="brand-subtitle">DOCUMENT INTELLIGENCE</div></div>
          <button className="icon-button mobile-close" onClick={() => setMenu(false)} aria-label="Close menu"><X size={19} /></button>
        </div>
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="nav-list">
          {NAV.map(([id, label, Icon]) => (
            <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => go(id)}>
              <Icon size={18} /><span>{label}</span>
              {id === "review" && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note"><ShieldCheck size={20} />
            <div><strong>Human-led decisions</strong><p>AI assists. People approve.</p></div></div>
          <div className="profile">
            <div className="avatar">{role.slice(0, 2).toUpperCase()}</div>
            <div><strong>{user}</strong><small>{role} workspace</small></div><ChevronDown size={16} />
          </div>
        </div>
      </aside>
      {menu && <button className="mobile-scrim" onClick={() => setMenu(false)} aria-label="Close navigation" />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{title}</strong></div>
          <div className="topbar-right">
            <span className="preview-badge">{error ? "● Backend offline" : "● Connected"}</span>
            <button className="icon-button" onClick={() => go("review")} aria-label="Pending reviews"><Bell size={19} /></button>
          </div>
        </header>
        <div className="page-content">
          {notice && (
            <div className="notice" role="status"><AlertCircle size={18} /><span>{notice}</span>
              <button onClick={() => setNotice("")} aria-label="Dismiss"><X size={16} /></button></div>
          )}
          <Page ctx={ctx} />
          <footer className="footer"><span>DocuVerify · Document Verification & Approval</span><span>AI findings are suggestions. Decisions are human.</span></footer>
        </div>
      </main>
    </div>
  );
}