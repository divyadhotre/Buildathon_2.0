// import { useCallback, useEffect, useState } from "react";
// import {
//   Activity, AlertCircle, Bell, ChevronDown, ClipboardCheck, FileText, History,
//   LayoutDashboard, Menu, Settings as Cog, ShieldCheck, UploadCloud, X
// } from "lucide-react";
// import * as api from "./services/api.js";
// import {
//   Dashboard, Upload, MyDocuments, PendingReview, AuditTrail, Reports, Settings, view
// } from "./pages/index.jsx";
// import "./styles.css";

// const NAV = [
//   ["dashboard", "Dashboard", LayoutDashboard],
//   ["upload", "Upload Document", UploadCloud],
//   ["documents", "My Documents", FileText],
//   ["review", "Pending Review", ClipboardCheck],
//   ["reports", "AI Testing", Activity],
//   ["audit", "Audit Trail", History]
// ];
// const PAGE_TITLES = { ...Object.fromEntries(NAV.map(([id, label]) => [id, label])), settings: "Settings" };
// const PAGES = { dashboard: Dashboard, upload: Upload, documents: MyDocuments, review: PendingReview, audit: AuditTrail, reports: Reports, settings: Settings };

// const USERS = { Submitter: "demo-submitter", Reviewer: "demo-reviewer", Approver: "demo-approver" };
// const readPage = () => (PAGES[location.hash.replace("#", "")] ? location.hash.replace("#", "") : "dashboard");

// export default function App() {
//   const [page, setPage] = useState(readPage);
//   const [requests, setRequests] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState("");
//   const [selectedId, setSelectedId] = useState(null);
//   const [resubmitId, setResubmitId] = useState(null);
//   const [role, setRole] = useState("Reviewer");
//   const [notice, setNotice] = useState("");
//   const [menu, setMenu] = useState(false);

//   const user = USERS[role];
//   api.session.role = role;
//   api.session.user = user;

//   const reload = useCallback(() => {
//     setLoading(true);
//     api.listRequests()
//       .then((x) => { setRequests(api.arr(x)); setError(""); })
//       .catch((e) => setError(e.message))
//       .finally(() => setLoading(false));
//   }, []);

//   useEffect(() => {
//     reload();
//     const onHash = () => setPage(readPage());
//     window.addEventListener("hashchange", onHash);
//     return () => window.removeEventListener("hashchange", onHash);
//   }, [reload]);

//   const go = (p) => { location.hash = p; setMenu(false); setNotice(""); };
//   const ctx = {
//     requests, loading, error, reload, go, role, user, selectedId, resubmitId,
//     setRole: (r) => { setRole(r); },
//     clearResubmission: () => setResubmitId(null),
//     resubmit: (id) => { setResubmitId(id); go("upload"); },
//     notify: setNotice,
//     open: (id) => { setSelectedId(id); go("review"); },
//     openAudit: (id) => { setSelectedId(id); go("audit"); }
//   };

//   const Page = PAGES[page];
//   const title = PAGE_TITLES[page];
//   const reviewStage = role === "Approver" ? "Pending approval" : "Under review";
//   const pendingCount = requests.map(view).filter((request) =>
//     request.status === reviewStage && request.submitter !== user
//   ).length;

//   return (
//     <div className="app-shell">
//       <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
//         <div className="brand">
//           <div className="brand-logo"><ShieldCheck size={25} /></div>
//           <div><div className="brand-name">Docu<span>Verify</span></div><div className="brand-subtitle">DOCUMENT INTELLIGENCE</div></div>
//           <button className="icon-button mobile-close" onClick={() => setMenu(false)} aria-label="Close menu"><X size={19} /></button>
//         </div>
//         <p className="sidebar-label">WORKSPACE</p>
//         <nav className="nav-list">
//           {NAV.map(([id, label, Icon]) => (
//             <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => go(id)}>
//               <Icon size={18} /><span>{label}</span>
//               {id === "review" && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
//             </button>
//           ))}
//         </nav>
//         <div className="sidebar-bottom">
//           <div className="security-note"><ShieldCheck size={20} />
//             <div><strong>Human-led decisions</strong><p>AI assists. People approve.</p></div></div>
//           <div className="profile">
//             <div className="avatar">{role.slice(0, 2).toUpperCase()}</div>
//             <div><strong>{user}</strong><small>{role} workspace</small></div><ChevronDown size={16} />
//           </div>
//         </div>
//       </aside>
//       {menu && <button className="mobile-scrim" onClick={() => setMenu(false)} aria-label="Close navigation" />}

//       <main className="main-area">
//         <header className="topbar">
//           <button className="icon-button mobile-menu-button" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20} /></button>
//           <div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{title}</strong></div>
//           <div className="topbar-right">
//             <span className="preview-badge">{loading ? "● Connecting…" : error ? "● Backend offline" : "● Connected"}</span>
//             <button className="icon-button" onClick={() => go("review")} aria-label="Pending reviews"><Bell size={19} /></button>
//             <button className={`settings-control ${page === "settings" ? "active" : ""}`} onClick={() => go("settings")} aria-label="Settings and role assignment">
//               <Cog size={16} /><span>Settings</span><span className="role-pill">{role}</span>
//             </button>
//           </div>
//         </header>
//         <div className="page-content">
//           {notice && (
//             <div className="notice" role="status"><AlertCircle size={18} /><span>{notice}</span>
//               <button onClick={() => setNotice("")} aria-label="Dismiss"><X size={16} /></button></div>
//           )}
//           <Page ctx={ctx} />
//           <footer className="footer"><span>DocuVerify · Document Verification & Approval</span><span>AI findings are suggestions. Decisions are human.</span></footer>
//         </div>
//       </main>
//     </div>
//   );
// }


import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bell,
  ChevronDown,
  ClipboardCheck,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Sun,
  Eye,
  EyeOff,
  ArrowLeft,
  Settings as Cog,
  ShieldCheck,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";

import * as api from "./services/api.js";

import {
  Dashboard,
  Upload,
  MyDocuments,
  PendingReview,
  AuditTrail,
  Reports,
  Settings,
  view,
} from "./pages/index.jsx";

import "./styles.css";

/* --------------------------------------------------
   ROLE CONFIGURATION
-------------------------------------------------- */

const USERS = {
  Submitter: "demo-submitter",
  Reviewer: "demo-reviewer",
  Approver: "demo-approver",
};

const ROLE_DETAILS = {
  Submitter: {
    title: "Submitter Workspace",
    description:
      "Upload documents, track their status, and respond to review requests.",
    icon: UploadCloud,
    pages: [
      ["dashboard", "Dashboard", LayoutDashboard],
      ["upload", "Upload Document", UploadCloud],
      ["documents", "My Documents", FileText],
    ],
  },

  Reviewer: {
    title: "Reviewer Workspace",
    description:
      "Inspect extracted information, verify issues, and request corrections.",
    icon: ClipboardCheck,
    pages: [
      ["dashboard", "Dashboard", LayoutDashboard],
      ["documents", "Documents", FileText],
      ["review", "Pending Review", ClipboardCheck],
      ["reports", "AI Testing", Activity],
      ["audit", "Audit Trail", History],
    ],
  },

  Approver: {
    title: "Approver Workspace",
    description:
      "Review completed checks and record final approval decisions.",
    icon: ShieldCheck,
    pages: [
      ["dashboard", "Dashboard", LayoutDashboard],
      ["review", "Pending Approval", ClipboardCheck],
      ["documents", "Documents", FileText],
      ["audit", "Audit Trail", History],
      ["reports", "AI Testing", Activity],
      ["settings", "Settings", Cog],
    ],
  },
};

const PAGES = {
  dashboard: Dashboard,
  upload: Upload,
  documents: MyDocuments,
  review: PendingReview,
  audit: AuditTrail,
  reports: Reports,
  settings: Settings,
};

const PAGE_TITLES = {
  dashboard: "Dashboard",
  upload: "Upload Document",
  documents: "Documents",
  review: "Pending Review",
  audit: "Audit Trail",
  reports: "AI Testing",
  settings: "Settings",
};

const getHashPage = () => {
  const hash = window.location.hash.replace("#", "");
  return PAGES[hash] ? hash : "dashboard";
};

/* --------------------------------------------------
   ROLE SELECTION / LOGIN SCREEN
-------------------------------------------------- */

function Brand() {
  return (
    <div className="login-brand">
      <div className="login-brand-logo"><ShieldCheck size={30} /></div>
      <div>
        <h1>Docu<span>Verify</span></h1>
        <p>DOCUMENT VERIFICATION &amp; APPROVAL</p>
      </div>
    </div>
  );
}

function ThemeButton({ theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button type="button" className="theme-toggle" onClick={onToggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}>
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
      <span>{isDark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

function RoleLogin({ onLogin, theme, onToggleTheme }) {
  const roles = ["Submitter", "Reviewer", "Approver"];
  return (
    <main className="login-screen">
      <div className="login-screen-tools"><ThemeButton theme={theme} onToggle={onToggleTheme} /></div>
      <div className="login-background-shape login-shape-one" />
      <div className="login-background-shape login-shape-two" />
      <section className="login-container">
        <Brand />
        <div className="login-heading">
          <span className="login-eyebrow">WELCOME TO DOCUVERIFY</span>
          <h2>Choose your workspace</h2>
          <p>Select your role to continue to the appropriate document verification workspace.</p>
        </div>
        <div className="role-cards">
          {roles.map((role) => {
            const details = ROLE_DETAILS[role];
            const Icon = details.icon;
            return (
              <button key={role} type="button" className={`role-card role-card-${role.toLowerCase()}`} onClick={() => onLogin(role)}>
                <div className="role-card-top"><div className="role-icon"><Icon size={25} /></div><span className="role-card-arrow" aria-hidden="true">→</span></div>
                <h3>{role}</h3><p>{details.description}</p>
                <span className="role-card-action">Continue as {role}<span aria-hidden="true"> →</span></span>
              </button>
            );
          })}
        </div>
        <div className="login-security-note"><ShieldCheck size={18} /><span>Human-led decisions. AI assists with verification; authorised people make decisions.</span></div>
        <p className="login-demo-note">Demo mode: choose a role, then enter any non-empty username/email and password.</p>
      </section>
    </main>
  );
}

function CredentialLogin({ role, onSubmit, onBack, theme, onToggleTheme }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [formError, setFormError] = useState("");
  const RoleIcon = ROLE_DETAILS[role].icon;

  const submit = (event) => {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setFormError("Enter your email/username and password to continue.");
      return;
    }
    setFormError("");
    onSubmit(role, identifier.trim(), remember);
  };

  return (
    <main className="login-screen">
      <div className="login-screen-tools"><ThemeButton theme={theme} onToggle={onToggleTheme} /></div>
      <div className="login-background-shape login-shape-one" /><div className="login-background-shape login-shape-two" />
      <section className="credential-container">
        <Brand />
        <button type="button" className="back-to-roles" onClick={onBack}><ArrowLeft size={16} /> Back to workspace selection</button>
        <div className="credential-card">
          <div className={`credential-role-icon role-card-${role.toLowerCase()}`}><RoleIcon size={25} /></div>
          <span className="login-eyebrow">{role.toUpperCase()} WORKSPACE</span>
          <h2>Welcome back</h2>
          <p className="credential-intro">Sign in to continue to your {role.toLowerCase()} workspace.</p>
          <form onSubmit={submit}>
            <label htmlFor="login-identifier">Email address or username</label>
            <input id="login-identifier" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Enter email or username" />
            <label htmlFor="login-password">Password</label>
            <div className="password-field">
              <input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
            <div className="login-form-options"><label className="remember-option"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me</label><span className="forgot-password-note">Forgot password? Contact your administrator.</span></div>
            {formError && <p className="login-form-error" role="alert">{formError}</p>}
            <button type="submit" className="credential-submit">Login as {role}<span> →</span></button>
          </form>
          <p className="credential-demo-note"><ShieldCheck size={15} /> Demo login only — credentials are not verified by a server.</p>
        </div>
      </section>
    </main>
  );
}

/* --------------------------------------------------
   MAIN APPLICATION
-------------------------------------------------- */

export default function App() {
  // No workspace is shown until the user selects a role.
  const [role, setRole] = useState(null);
  const [loginRole, setLoginRole] = useState(null);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("docuverify-theme") || "light");

  const [page, setPage] = useState("dashboard");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [resubmitId, setResubmitId] = useState(null);
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);

  const user = role ? USERS[role] : null;
  const roleConfig = role ? ROLE_DETAILS[role] : null;
  const nav = roleConfig ? roleConfig.pages : [];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("docuverify-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");

  // Keep the existing API session contract unchanged.
  // This is demo role selection, not secure authentication.
  api.session.role = role;
  api.session.user = user;

  const allowedPage = (requestedPage, currentRole = role) => {
    if (!currentRole) return "dashboard";

    const allowedPages = ROLE_DETAILS[currentRole].pages.map(
      ([id]) => id
    );

    return allowedPages.includes(requestedPage)
      ? requestedPage
      : "dashboard";
  };

  const reload = useCallback(() => {
    if (!role) return;

    setLoading(true);

    api
      .listRequests()
      .then((result) => {
        setRequests(api.arr(result));
        setError("");
      })
      .catch((err) => {
        setError(err.message || "Unable to connect to the backend.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [role]);

  // Load requests only after a role has been selected.
  useEffect(() => {
    if (!role) return;

    reload();

    const onHashChange = () => {
      const requestedPage = getHashPage();
      const nextPage = allowedPage(requestedPage, role);

      if (nextPage !== requestedPage) {
        window.location.hash = nextPage;
      }

      setPage(nextPage);
      setMenu(false);
    };

    window.addEventListener("hashchange", onHashChange);

    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [role, reload]);

  const go = (requestedPage) => {
    const nextPage = allowedPage(requestedPage);

    setPage(nextPage);
    setMenu(false);
    setNotice("");

    if (window.location.hash !== `#${nextPage}`) {
      window.location.hash = nextPage;
    }
  };

  const handleLogin = (selectedRole) => {
    setLoginRole(selectedRole);
  };

  const handleCredentialSubmit = (selectedRole, identifier) => {
    setLoginIdentifier(identifier);
    setRole(selectedRole);
    setLoginRole(null);
    setPage("dashboard");
    setSelectedId(null);
    setResubmitId(null);
    setNotice("");
    setError("");
    setMenu(false);

    window.location.hash = "dashboard";
  };

  const handleLogout = () => {
    setRole(null);
    setLoginRole(null);
    setLoginIdentifier("");
    setPage("dashboard");
    setRequests([]);
    setSelectedId(null);
    setResubmitId(null);
    setNotice("");
    setError("");
    setLoading(false);
    setMenu(false);

    // Clear the current page from the URL.
    window.location.hash = "";
  };

  const ctx = {
    requests,
    loading,
    error,
    reload,
    go,
    role,
    user,
    selectedId,
    resubmitId,

    // Retains compatibility with existing page components.
    setRole: (nextRole) => {
      if (USERS[nextRole]) {
        handleLogin(nextRole);
      }
    },

    clearResubmission: () => setResubmitId(null),

    resubmit: (id) => {
      if (role !== "Submitter") {
        setNotice("Only a submitter can resubmit a document.");
        return;
      }

      setResubmitId(id);
      go("upload");
    },

    notify: setNotice,

    open: (id) => {
      setSelectedId(id);
      go("review");
    },

    openAudit: (id) => {
      setSelectedId(id);
      go("audit");
    },
  };

  // Display the role selection screen before entering a workspace.
  if (!role && loginRole) {
    return <CredentialLogin role={loginRole} onSubmit={handleCredentialSubmit}
      onBack={() => setLoginRole(null)} theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (!role) {
    return <RoleLogin onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme} />;
  }

  const Page = PAGES[page] || Dashboard;
  const title = PAGE_TITLES[page] || "Dashboard";

  const reviewStage =
    role === "Approver" ? "Pending approval" : "Under review";

  const pendingCount = requests
    .map(view)
    .filter(
      (request) =>
        request.status === reviewStage && request.submitter !== user
    ).length;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-logo">
            <ShieldCheck size={25} />
          </div>

          <div>
            <div className="brand-name">
              Docu<span>Verify</span>
            </div>
            <div className="brand-subtitle">
              DOCUMENT INTELLIGENCE
            </div>
          </div>

          <button
            className="icon-button mobile-close"
            onClick={() => setMenu(false)}
            aria-label="Close menu"
          >
            <X size={19} />
          </button>
        </div>

        <p className="sidebar-label">YOUR WORKSPACE</p>

        <div className="workspace-role-label">
          <UserRound size={16} />
          <span>{role} Workspace</span>
        </div>

        <nav className="nav-list">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              <span>{label}</span>

              {id === "review" && pendingCount > 0 && (
                <span className="nav-count">{pendingCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="security-note">
            <ShieldCheck size={20} />
            <div>
              <strong>Human-led decisions</strong>
              <p>AI assists. People approve.</p>
            </div>
          </div>

          <div className="profile">
            <div className="avatar">
              {role.slice(0, 2).toUpperCase()}
            </div>

            <div className="profile-details">
              <strong>{loginIdentifier || user}</strong>
              <small>{role} workspace</small>
            </div>

            <ChevronDown size={16} />
          </div>

          <button
            type="button"
            className="logout-button"
            onClick={handleLogout}
          >
            <LogOut size={17} />
            <span>Log out / Switch role</span>
          </button>
        </div>
      </aside>

      {menu && (
        <button
          className="mobile-scrim"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu-button"
            onClick={() => setMenu(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <div className="breadcrumb">
            <span>{role} Workspace</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>

          <div className="topbar-right">
            <span className="preview-badge">
              {loading
                ? "● Connecting…"
                : error
                  ? "● Backend offline"
                  : "● Connected"}
            </span>

            {role !== "Submitter" && (
              <button
                className="icon-button"
                onClick={() => go("review")}
                aria-label="Open pending reviews"
                title="Pending reviews"
              >
                <Bell size={19} />
              </button>
            )}

            {role === "Approver" && (
              <button
                className={`settings-control ${
                  page === "settings" ? "active" : ""
                }`}
                onClick={() => go("settings")}
                aria-label="Settings"
              >
                <Cog size={16} />
                <span>Settings</span>
                <span className="role-pill">{role}</span>
              </button>
            )}

            <ThemeButton theme={theme} onToggle={toggleTheme} />
            <button
              type="button"
              className="header-logout-button"
              onClick={handleLogout}
              title="Log out and switch role"
            >
              <LogOut size={16} />
              <span>Switch role</span>
            </button>
          </div>
        </header>

        <div className="page-content">
          {notice && (
            <div className="notice" role="status">
              <AlertCircle size={18} />
              <span>{notice}</span>

              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <Page ctx={ctx} />

          <footer className="footer">
            <span>DocuVerify · Document Verification &amp; Approval</span>
            <span>
              AI findings are suggestions. Decisions are human.
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}