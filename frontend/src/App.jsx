import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, CloudUpload, FileText, SquareCheckBig, ShieldCheck, History, FlaskConical, Search, RotateCcw, Sparkles } from 'lucide-react'
import { listRequests, getHistory, mockTests, runTests } from './services/api.js'
import { Dashboard, Upload, Repository, Queue, Results, Audit, Tests } from './pages/Pages.jsx'

const USERS = { Submitter: 'Sarah Chen', Reviewer: 'Marcus Vance', Approver: 'Dr. Evelyn Reed' }
const NAV = [
  ['dashboard', 'Dashboard', LayoutGrid], ['upload', 'Upload Document', CloudUpload], ['docs', 'My Documents', FileText],
  ['queue', 'Review Queue', SquareCheckBig], ['results', 'Verification Results', ShieldCheck],
  ['audit', 'History & Audit Trail', History], ['tests', 'System Tests', FlaskConical],
]

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [role, setRole] = useState('Approver')
  const [docs, setDocs] = useState([])
  const [audit, setAudit] = useState([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState('')

  const load = () => { listRequests().then(setDocs); getHistory().then(setAudit) }
  useEffect(load, [])
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2500) }
  const inspect = (d) => { setSelected(d); setPage('results') }

  const shown = useMemo(() => docs.filter((d) => (d.title + d.id + d.by).toLowerCase().includes(q.toLowerCase())), [docs, q])
  const pending = shown.filter((d) => ['Under Review', 'Processing', 'Correction Required'].includes(d.status))
  const ctx = { docs: shown, pending, audit, role, inspect, go: setPage, selected, notify, tests: mockTests, runTests }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><div className="logo"><ShieldCheck size={22} /></div>
          <div><b>DocVerify AI</b><span className="tag">PS02</span><small>Verification & Review</small></div></div>
        <div className="role">ACTIVE ROLE<div><b><span className="dot" />{role}</b><span>{USERS[role]}</span></div></div>
        <nav>{NAV.map(([k, label, Icon]) => (
          <button key={k} className={page === k ? 'on' : ''} onClick={() => setPage(k)}><Icon size={18} />{label}
            {k === 'queue' && <span className="badge">{pending.length}</span>}{k === 'tests' && <span className="badge">9/9</span>}</button>))}</nav>
        <div className="hitl"><b><Sparkles size={13} /> Human-in-the-Loop</b>Automated checks and AI assist reviewers. Final decisions stay with authorized humans.</div>
      </aside>
      <div className="main">
        <header className="top">
          <div><h2>DocVerify AI</h2><small>Document Verification & Approval System</small></div>
          <label className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by tracking code, vendor, or title..." /></label>
          <div className="seg">{Object.keys(USERS).map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r}</button>)}</div>
          <button className="ghost" onClick={() => { setQ(''); load(); notify('Demo reset') }}><RotateCcw size={15} />Reset Demo</button>
        </header>
        <main className="page">
          {page === 'dashboard' && <Dashboard {...ctx} />}
          {page === 'upload' && <Upload {...ctx} />}
          {page === 'docs' && <Repository {...ctx} />}
          {page === 'queue' && <Queue {...ctx} />}
          {page === 'results' && <Results {...ctx} />}
          {page === 'audit' && <Audit {...ctx} />}
          {page === 'tests' && <Tests {...ctx} />}
        </main>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
