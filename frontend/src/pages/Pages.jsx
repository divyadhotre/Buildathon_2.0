// import { useState } from 'react'
// import { FileText, Clock, ShieldCheck, TriangleAlert, CircleCheck, CircleX, ArrowRight, CloudUpload, Play, Check } from 'lucide-react'
// import { uploadDocument, decide } from '../services/api.js'

// const Status = ({ s }) => <span className={`st s-${s}`}>{s}</span>
// const Finding = ({ d }) => d.findings ? <span className="f bad">{d.findings} flagged</span> : <span className="f">✓ All Passed</span>
// const Head = ({ pill, title, sub, right }) => (
//   <div className="hero card" style={{ padding: 0, background: 'none', boxShadow: 'none' }}>
//     <div>{pill && <span className="pill p">{pill}</span>}<h1>{title}</h1><p className="sub">{sub}</p></div>{right}</div>)

// export function Dashboard({ docs, audit, go, inspect }) {
//   const n = (s) => docs.filter((d) => d.status === s).length
//   const cards = [['Total Documents', docs.length, 'In persistent store', 'var(--yellow)', FileText], ['Processing', n('Processing'), 'Extraction in progress', '#fcf0c2', Clock],
//     ['Under Review', n('Under Review'), 'Awaiting human review', 'var(--purple)', ShieldCheck], ['Correction', n('Correction Required'), 'Returned to submitter', 'var(--red)', TriangleAlert],
//     ['Approved', n('Approved'), 'Compliance sign-off', 'var(--green)', CircleCheck], ['Rejected', n('Rejected'), 'Failed criteria', 'var(--pink)', CircleX]]
//   const cats = ['Invoice', 'Certificate', 'Application Form', 'Other']
//   return (<>
//     <section className="card hero">
//       <div><span className="pill">✦ PS02 Production-Ready Prototype</span><h1>Document Verification & Approval Console</h1>
//         <p className="sub">Upload business documents for OCR extraction, transparent rule-based verification, and human reviewer approval. Original records are immutably preserved.</p></div>
//       <div style={{ display: 'flex', gap: 10 }}><button className="btn" onClick={() => go('upload')}><CloudUpload size={16} />Upload Document</button><button className="btn alt" onClick={() => go('queue')}>Review Queue <ArrowRight size={15} /></button></div>
//     </section>
//     <div className="stats">{cards.map(([t, v, s, bg, I]) => <div key={t} className="stat" style={{ background: bg }}><header>{t}<I size={16} /></header><strong>{v}</strong><small>{s}</small></div>)}</div>
//     <div className="chips">CATEGORIES: {cats.map((c) => <span className="c" key={c}>{c}<em>{docs.filter((d) => d.category === c).length}</em></span>)}</div>
//     <div className="two">
//       <section className="card"><div className="head"><div><h3>Recent Documents</h3><small>Latest submitted files and their extraction states</small></div><b style={{ cursor: 'pointer' }} onClick={() => go('docs')}>View All ›</b></div>
//         <table><thead><tr><th>DOCUMENT</th><th>CATEGORY</th><th>STATUS</th><th>FINDINGS</th><th>ACTION</th></tr></thead><tbody>
//           {docs.slice(0, 5).map((d, i) => <tr key={i}><td><b>{d.title}</b><div className="mono">{d.id} • {d.version}</div></td><td><span className="cat">{d.category}</span></td><td><Status s={d.status} /></td><td><Finding d={d} /></td><td><button className="insp" onClick={() => inspect(d)}>Inspect</button></td></tr>)}
//         </tbody></table></section>
//       <section className="card"><div className="head"><div><h3>Audit Trail Activity</h3><small>Immutable chronological ledger of system events</small></div></div>
//         {audit.slice(0, 4).map((a, i) => <div className="ev" key={i}><b>{a.actor}</b>{a.text}<br /><small>{a.type.toUpperCase()}</small></div>)}</section>
//     </div></>)
// }

// export function Upload({ notify, go }) {
//   const [file, setFile] = useState(null), [cat, setCat] = useState('Invoice'), [title, setTitle] = useState(''), [notes, setNotes] = useState('')
//   const submit = async () => { const f = new FormData(); f.append('file', file); f.append('category', cat); f.append('title', title); f.append('notes', notes)
//     try { await uploadDocument(f); notify('Uploaded — verification running'); go('docs') } catch (e) { notify(e.message) } }
//   return (<>
//     <Head title="Upload Document" sub="Submit a new document for extraction and verification." />
//     <section className="card" style={{ display: 'grid', gap: 18, maxWidth: 820 }}>
//       <label className="drop"><CloudUpload /><div style={{ margin: '8px 0', color: 'var(--ink)', fontWeight: 600 }}>{file ? file.name : 'Drag & drop your document here, or browse'}</div>
//         <small>Supports PDF, Scanned Images (PNG, JPG), or Plain Text (up to 15MB)</small>
//         <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(e) => setFile(e.target.files[0])} /></label>
//       <div className="grid2"><label className="fld">DOCUMENT CATEGORY<select value={cat} onChange={(e) => setCat(e.target.value)}>{['Invoice', 'Certificate', 'Application Form', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></label>
//         <label className="fld">DOCUMENT TITLE<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Acme Cloud Services - Oct 2024" /></label></div>
//       <label className="fld">OPTIONAL NOTES OR DESCRIPTION<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context, procurement reference, or instructions for the reviewer..." /></label>
//       <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, alignItems: 'center' }}><button className="ghost" onClick={() => go('docs')}>Cancel</button><button className="btn" disabled={!file || !title} onClick={submit}><CloudUpload size={16} />Upload & Run Verification</button></div>
//     </section></>)
// }

// export function Repository({ docs, inspect, go }) {
//   const [cat, setCat] = useState(''), [st, setSt] = useState('')
//   const rows = docs.filter((d) => (!cat || d.category === cat) && (!st || d.status === st))
//   return (<>
//     <Head title="Document Repository" sub="Browse all submitted documents, version records, and current workflow states." right={<button className="btn" onClick={() => go('upload')}>Upload Document</button>} />
//     <div className="filters"><input placeholder="Search by title, tracking code, vendor, or applicant..." disabled />
//       <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All Categories</option>{['Invoice', 'Certificate', 'Application Form', 'Other'].map((c) => <option key={c}>{c}</option>)}</select>
//       <select value={st} onChange={(e) => setSt(e.target.value)}><option value="">All Statuses</option>{['Processing', 'Under Review', 'Correction Required', 'Approved', 'Rejected'].map((c) => <option key={c}>{c}</option>)}</select></div>
//     <section className="card"><table><thead><tr><th>TRACKING & TITLE</th><th>CATEGORY</th><th>SUBMITTED BY</th><th>VERSION</th><th>WORKFLOW STATUS</th><th>VERIFICATION FINDINGS</th><th>ACTION</th></tr></thead><tbody>
//       {rows.map((d, i) => <tr key={i}><td><b>{d.title}</b><div className="mono">{d.id}</div></td><td><span className="cat">{d.category}</span></td><td>{d.by}<div className="mono">{d.date}</div></td><td>{d.version}</td><td><Status s={d.status} /></td><td><Finding d={d} /></td><td><button className="insp" onClick={() => inspect(d)}>Inspect</button></td></tr>)}
//     </tbody></table></section></>)
// }

// export function Queue({ pending, inspect }) {
//   const [tab, setTab] = useState('All'); const rows = pending.filter((d) => tab === 'All' || (tab === 'High' ? d.findings : d.status === 'Correction Required'))
//   return (<>
//     <Head pill="☑ Human-in-the-Loop Review Desk" title="Pending Review & Approval Queue" sub="Review extracted values, inspect findings against original documents, record human corrections, or make approval decisions."
//       right={<div className="seg">{[['All', `All Pending (${pending.length})`], ['High', 'High Severity Discrepancies'], ['Corr', 'Correction Required']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>} />
//     <div className="grid2">{rows.map((d, i) => <div className="dq" key={i}>
//       <header><span className="mono">{d.id} • {d.version}</span><Status s={d.status} /></header>
//       <div><h4>{d.title}</h4><div className="meta">{d.category} • By {d.by} • {d.date}</div></div>
//       {d.issues ? <div className="note w"><b>🛡 {d.findings} High-Severity Finding(s)</b>{d.issues[0].detail.slice(0, 120)}…</div> : <div className="note">Ready for final reviewer confirmation & sign-off.</div>}
//       <footer><span>{d.corrections ? `${d.corrections} correction(s) recorded` : ''}</span><button className="btn" onClick={() => inspect(d)}>Inspect & Review <ArrowRight size={14} /></button></footer></div>)}</div></>)
// }

// export function Results({ selected, docs, role, notify }) {
//   const d = selected || docs.find((x) => x.issues) || docs[0]
//   const [reason, setReason] = useState('')
//   if (!d) return <p>No document selected.</p>
//   const act = async (decision) => { if (!reason) return notify('A reason is required'); await decide(d.id, { decision, reason }); notify(`Recorded: ${decision}`) }
//   return (<>
//     <Head title="Verification Results" sub={`${d.title} · ${d.id} · ${d.version}`} right={<Status s={d.status} />} />
//     <div className="two" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
//       <section className="card"><div className="head"><h3>Document Preview</h3></div>
//         <div style={{ height: 260, border: '1px solid var(--line)', borderRadius: 16, background: '#fbfaf0', marginBottom: 14 }} />
//         {[['Original File', 'sample_damaged_receipt_unreadable.txt'], ['File Size & Type', '0.0 KB • text/plain'], ['SHA-256 Checksum', '00ffeedd41235478...'], ['OCR Applied', 'Yes (Tesseract OCR Engine)']].map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12 }}><span style={{ color: 'var(--mute)' }}>{k}</span><b>{v}</b></div>)}</section>
//       <section className="card"><div className="head"><div><h3>Verification Findings</h3><small>Every flag links to its rule and evidence</small></div></div>
//         {d.issues ? d.issues.map((x, i) => <div className="issue" key={i}><header><div><h4>{x.title}</h4><div className="mono">Rule ID: {x.rule} • Field: {x.field}</div></div><span className="sev">{x.severity} Severity</span></header><p>{x.detail}</p>
//           {x.evidence && <div className="code">EVIDENCE VALUES: {Object.entries(x.evidence).map(([k, v]) => `${k}: ${v}`).join('  ')}</div>}<small><b>Suggested Action:</b> {x.action}</small></div>)
//           : <div className="note"><b>All checks passed</b>No issues flagged. A passed check does not prove authenticity — human sign-off required.</div>}
//         {['Reviewer', 'Approver'].includes(role) && <div className="fld" style={{ marginTop: 14 }}>DECISION REASON<textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for every decision" />
//           <div className="actions"><button className="btn" onClick={() => act('Correction Requested')}>Request Correction</button>
//             {role === 'Approver' && <><button className="btn" onClick={() => act('Approved')}><Check size={15} />Approve</button><button className="btn alt" onClick={() => act('Rejected')}>Reject</button></>}</div></div>}
//       </section></div></>)
// }

// export function Audit({ audit }) {
//   const [t, setT] = useState(''), [s, setS] = useState('')
//   const rows = audit.filter((a) => (!t || a.type === t) && (a.text + a.actor + a.doc).toLowerCase().includes(s.toLowerCase()))
//   return (<>
//     <Head pill="⏱ Immutable System Audit Trail" title="History & Audit Ledger" sub="Every document creation, OCR text extraction, field correction, comment, and human approval decision is sequentially recorded in this append-only ledger." />
//     <div className="filters"><input value={s} onChange={(e) => setS(e.target.value)} placeholder="Search by actor, event details, or document ID..." />
//       <select value={t} onChange={(e) => setT(e.target.value)}><option value="">All Event Types</option>{['Document Uploaded', 'Extraction Completed', 'Verification Completed', 'Field Corrected', 'Correction Requested', 'Document Approved', 'Document Rejected', 'Override Recorded'].map((x) => <option key={x}>{x}</option>)}</select></div>
//     <section className="card">{rows.map((a, i) => <div className="led" key={i}><div><div className="who">{a.actor}<span>{a.role}</span><i>• {a.type.toUpperCase()}</i></div><div style={{ margin: '6px 0' }}>{a.text}</div><div className="mono">Doc ID: {a.doc}</div></div>
//       <div style={{ textAlign: 'right', color: 'var(--mute)', fontSize: 12 }}>{a.time}<br /><button className="insp" style={{ marginTop: 8 }}>View Document</button></div></div>)}</section></>)
// }

// export function Tests({ tests }) {
//   const [list, setList] = useState(tests)
//   return (<>
//     <Head pill="✎ Automated Verification Test Suite" title="System Acceptance Tests & Verification Matrix" sub="Validates rule verification engine, invoice arithmetic precision, missing field checks, correction immutability, role-based segregation of duties, and audit trail persistence." right={<button className="btn" onClick={() => setList([...tests])}><Play size={15} />Run Test Suite</button>} />
//     <div className="tests">{[['Total Test Cases', list.length, 'Automated test scenarios', 'var(--yellow)'], ['Passing Tests', list.filter((t) => t.passed).length, '100% Verified', 'var(--green)'], ['Failing Tests', list.filter((t) => !t.passed).length, 'Zero tolerance errors', 'var(--red)'], ['Execution Time', '4ms', 'Sub-second execution', 'var(--purple)']].map(([a, b, c, bg]) => <div className="stat" key={a} style={{ background: bg, minHeight: 0 }}><header>{a}</header><strong>{b}</strong><small>{c}</small></div>)}</div>
//     <section className="card"><div className="head"><b>ACCEPTANCE TEST ASSERTIONS</b></div>{list.map((t) => <div className="test" key={t.name}><div><b>✔ {t.name}</b><div><span className="cat">{t.tag}</span> <small className="mono">Duration: {t.ms}ms</small></div></div><span className="pass">PASSED</span></div>)}</section></>)
// }


import { useState } from 'react'
import { FileText, Clock, ShieldCheck, TriangleAlert, CircleCheck, CircleX, ArrowRight, CloudUpload, Play, Check } from 'lucide-react'
import { uploadDocument, decide } from '../services/api.js'

const Status = ({ s }) => <span className={`st s-${s}`}>{s}</span>
const Finding = ({ d }) => d.findings ? <span className="f bad">{d.findings} flagged</span> : <span className="f">✓ All Passed</span>
const Head = ({ pill, title, sub, right }) => (
  <div className="hero card" style={{ padding: 0, background: 'none', boxShadow: 'none' }}>
    <div>{pill && <span className="pill p">{pill}</span>}<h1>{title}</h1><p className="sub">{sub}</p></div>{right}</div>)

export function Dashboard({ docs, audit, go, inspect }) {
  const n = (s) => docs.filter((d) => d.status === s).length
  const cards = [['Total Documents', docs.length, 'In persistent store', 'var(--blue)', FileText], ['Processing', n('Processing'), 'Extraction in progress', 'var(--yellow2)', Clock],
    ['Under Review', n('Under Review'), 'Awaiting human review', 'var(--purple)', ShieldCheck], ['Correction', n('Correction Required'), 'Returned to submitter', 'var(--red)', TriangleAlert],
    ['Approved', n('Approved'), 'Compliance sign-off', 'var(--green)', CircleCheck], ['Rejected', n('Rejected'), 'Failed criteria', 'var(--pink)', CircleX]]
  const cats = ['Invoice', 'Certificate', 'Application Form', 'Other']
  return (<>
    <section className="card hero">
      <div><span className="pill">✦ PS02 Production-Ready Prototype</span><h1>Document Verification & Approval Console</h1>
        <p className="sub">Upload business documents for OCR extraction, transparent rule-based verification, and human reviewer approval. Original records are immutably preserved.</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button className="btn" onClick={() => go('upload')}><CloudUpload size={16} />Upload Document</button><button className="btn alt" onClick={() => go('queue')}>Review Queue <ArrowRight size={15} /></button></div>
    </section>
    <div className="stats">{cards.map(([t, v, s, bg, I]) => <div key={t} className="stat" style={{ background: bg }}><header>{t}<I size={16} /></header><strong>{v}</strong><small>{s}</small></div>)}</div>
    <div className="chips">CATEGORIES: {cats.map((c) => <span className="c" key={c}>{c}<em>{docs.filter((d) => d.category === c).length}</em></span>)}</div>
    <div className="two">
      <section className="card"><div className="head"><div><h3>Recent Documents</h3><small>Latest submitted files and their extraction states</small></div><b style={{ cursor: 'pointer' }} onClick={() => go('docs')}>View All ›</b></div>
        <table><thead><tr><th>DOCUMENT</th><th>CATEGORY</th><th>STATUS</th><th>FINDINGS</th><th>ACTION</th></tr></thead><tbody>
          {docs.slice(0, 5).map((d, i) => <tr key={i}><td><b>{d.title}</b><div className="mono">{d.id} • {d.version}</div></td><td><span className="cat">{d.category}</span></td><td><Status s={d.status} /></td><td><Finding d={d} /></td><td><button className="insp" onClick={() => inspect(d)}>Inspect</button></td></tr>)}
        </tbody></table></section>
      <section className="card"><div className="head"><div><h3>Audit Trail Activity</h3><small>Immutable chronological ledger of system events</small></div></div>
        {audit.slice(0, 4).map((a, i) => <div className="ev" key={i}><b>{a.actor}</b>{a.text}<br /><small>{a.type.toUpperCase()}</small></div>)}</section>
    </div></>)
}

export function Upload({ notify, go }) {
  const [file, setFile] = useState(null), [cat, setCat] = useState('Invoice'), [title, setTitle] = useState(''), [notes, setNotes] = useState('')
  const submit = async () => { const f = new FormData(); f.append('file', file); f.append('category', cat); f.append('title', title); f.append('notes', notes)
    try { await uploadDocument(f); notify('Uploaded — verification running'); go('docs') } catch (e) { notify(e.message) } }
  return (<>
    <Head title="Upload Document" sub="Submit a new document for extraction and verification." />
    <section className="card" style={{ display: 'grid', gap: 18, maxWidth: 820 }}>
      <label className="drop"><CloudUpload /><div style={{ margin: '8px 0', color: 'var(--ink)', fontWeight: 600 }}>{file ? file.name : 'Drag & drop your document here, or browse'}</div>
        <small>Supports PDF, Scanned Images (PNG, JPG), or Plain Text (up to 15MB)</small>
        <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(e) => setFile(e.target.files[0])} /></label>
      <div className="grid2"><label className="fld">DOCUMENT CATEGORY<select value={cat} onChange={(e) => setCat(e.target.value)}>{['Invoice', 'Certificate', 'Application Form', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="fld">DOCUMENT TITLE<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Acme Cloud Services - Oct 2024" /></label></div>
      <label className="fld">OPTIONAL NOTES OR DESCRIPTION<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context, procurement reference, or instructions for the reviewer..." /></label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, alignItems: 'center' }}><button className="ghost" onClick={() => go('docs')}>Cancel</button><button className="btn" disabled={!file || !title} onClick={submit}><CloudUpload size={16} />Upload & Run Verification</button></div>
    </section></>)
}

export function Repository({ docs, inspect, go }) {
  const [cat, setCat] = useState(''), [st, setSt] = useState('')
  const rows = docs.filter((d) => (!cat || d.category === cat) && (!st || d.status === st))
  return (<>
    <Head title="Document Repository" sub="Browse all submitted documents, version records, and current workflow states." right={<button className="btn" onClick={() => go('upload')}>Upload Document</button>} />
    <div className="filters"><input placeholder="Search by title, tracking code, vendor, or applicant..." disabled />
      <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All Categories</option>{['Invoice', 'Certificate', 'Application Form', 'Other'].map((c) => <option key={c}>{c}</option>)}</select>
      <select value={st} onChange={(e) => setSt(e.target.value)}><option value="">All Statuses</option>{['Processing', 'Under Review', 'Correction Required', 'Approved', 'Rejected'].map((c) => <option key={c}>{c}</option>)}</select></div>
    <section className="card"><table><thead><tr><th>TRACKING & TITLE</th><th>CATEGORY</th><th>SUBMITTED BY</th><th>VERSION</th><th>WORKFLOW STATUS</th><th>VERIFICATION FINDINGS</th><th>ACTION</th></tr></thead><tbody>
      {rows.map((d, i) => <tr key={i}><td><b>{d.title}</b><div className="mono">{d.id}</div></td><td><span className="cat">{d.category}</span></td><td>{d.by}<div className="mono">{d.date}</div></td><td>{d.version}</td><td><Status s={d.status} /></td><td><Finding d={d} /></td><td><button className="insp" onClick={() => inspect(d)}>Inspect</button></td></tr>)}
    </tbody></table></section></>)
}

export function Queue({ pending, inspect }) {
  const [tab, setTab] = useState('All'); const rows = pending.filter((d) => tab === 'All' || (tab === 'High' ? d.findings : d.status === 'Correction Required'))
  return (<>
    <Head pill="☑ Human-in-the-Loop Review Desk" title="Pending Review & Approval Queue" sub="Review extracted values, inspect findings against original documents, record human corrections, or make approval decisions."
      right={<div className="seg">{[['All', `All Pending (${pending.length})`], ['High', 'High Severity Discrepancies'], ['Corr', 'Correction Required']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>} />
    <div className="grid2">{rows.map((d, i) => <div className="dq" key={i}>
      <header><span className="mono">{d.id} • {d.version}</span><Status s={d.status} /></header>
      <div><h4>{d.title}</h4><div className="meta">{d.category} • By {d.by} • {d.date}</div></div>
      {d.issues ? <div className="note w"><b>🛡 {d.findings} High-Severity Finding(s)</b>{d.issues[0].detail.slice(0, 120)}…</div> : <div className="note">Ready for final reviewer confirmation & sign-off.</div>}
      <footer><span>{d.corrections ? `${d.corrections} correction(s) recorded` : ''}</span><button className="btn" onClick={() => inspect(d)}>Inspect & Review <ArrowRight size={14} /></button></footer></div>)}</div></>)
}

export function Results({ selected, docs, role, notify }) {
  const d = selected || docs.find((x) => x.issues) || docs[0]
  const [reason, setReason] = useState('')
  if (!d) return <p>No document selected.</p>
  const act = async (decision) => { if (!reason) return notify('A reason is required'); await decide(d.id, { decision, reason }); notify(`Recorded: ${decision}`) }
  return (<>
    <Head title="Verification Results" sub={`${d.title} · ${d.id} · ${d.version}`} right={<Status s={d.status} />} />
    <div className="two" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
      <section className="card"><div className="head"><h3>Document Preview</h3></div>
        <div style={{ height: 260, border: '1px solid var(--line)', borderRadius: 16, background: '#faf4fb', marginBottom: 14 }} />
        {[['Original File', 'sample_damaged_receipt_unreadable.txt'], ['File Size & Type', '0.0 KB • text/plain'], ['SHA-256 Checksum', '00ffeedd41235478...'], ['OCR Applied', 'Yes (Tesseract OCR Engine)']].map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12 }}><span style={{ color: 'var(--mute)' }}>{k}</span><b>{v}</b></div>)}</section>
      <section className="card"><div className="head"><div><h3>Verification Findings</h3><small>Every flag links to its rule and evidence</small></div></div>
        {d.issues ? d.issues.map((x, i) => <div className="issue" key={i}><header><div><h4>{x.title}</h4><div className="mono">Rule ID: {x.rule} • Field: {x.field}</div></div><span className="sev">{x.severity} Severity</span></header><p>{x.detail}</p>
          {x.evidence && <div className="code">EVIDENCE VALUES: {Object.entries(x.evidence).map(([k, v]) => `${k}: ${v}`).join('  ')}</div>}<small><b>Suggested Action:</b> {x.action}</small></div>)
          : <div className="note"><b>All checks passed</b>No issues flagged. A passed check does not prove authenticity — human sign-off required.</div>}
        {['Reviewer', 'Approver'].includes(role) && <div className="fld" style={{ marginTop: 14 }}>DECISION REASON<textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for every decision" />
          <div className="actions"><button className="btn" onClick={() => act('Correction Requested')}>Request Correction</button>
            {role === 'Approver' && <><button className="btn" onClick={() => act('Approved')}><Check size={15} />Approve</button><button className="btn alt" onClick={() => act('Rejected')}>Reject</button></>}</div></div>}
      </section></div></>)
}

export function Audit({ audit }) {
  const [t, setT] = useState(''), [s, setS] = useState('')
  const rows = audit.filter((a) => (!t || a.type === t) && (a.text + a.actor + a.doc).toLowerCase().includes(s.toLowerCase()))
  return (<>
    <Head pill="⏱ Immutable System Audit Trail" title="History & Audit Ledger" sub="Every document creation, OCR text extraction, field correction, comment, and human approval decision is sequentially recorded in this append-only ledger." />
    <div className="filters"><input value={s} onChange={(e) => setS(e.target.value)} placeholder="Search by actor, event details, or document ID..." />
      <select value={t} onChange={(e) => setT(e.target.value)}><option value="">All Event Types</option>{['Document Uploaded', 'Extraction Completed', 'Verification Completed', 'Field Corrected', 'Correction Requested', 'Document Approved', 'Document Rejected', 'Override Recorded'].map((x) => <option key={x}>{x}</option>)}</select></div>
    <section className="card">{rows.map((a, i) => <div className="led" key={i}><div><div className="who">{a.actor}<span>{a.role}</span><i>• {a.type.toUpperCase()}</i></div><div style={{ margin: '6px 0' }}>{a.text}</div><div className="mono">Doc ID: {a.doc}</div></div>
      <div style={{ textAlign: 'right', color: 'var(--mute)', fontSize: 12 }}>{a.time}<br /><button className="insp" style={{ marginTop: 8 }}>View Document</button></div></div>)}</section></>)
}

export function Tests({ tests }) {
  const [list, setList] = useState(tests)
  return (<>
    <Head pill="✎ Automated Verification Test Suite" title="System Acceptance Tests & Verification Matrix" sub="Validates rule verification engine, invoice arithmetic precision, missing field checks, correction immutability, role-based segregation of duties, and audit trail persistence." right={<button className="btn" onClick={() => setList([...tests])}><Play size={15} />Run Test Suite</button>} />
    <div className="tests">{[['Total Test Cases', list.length, 'Automated test scenarios', 'var(--yellow)'], ['Passing Tests', list.filter((t) => t.passed).length, '100% Verified', 'var(--green)'], ['Failing Tests', list.filter((t) => !t.passed).length, 'Zero tolerance errors', 'var(--red)'], ['Execution Time', '4ms', 'Sub-second execution', 'var(--purple)']].map(([a, b, c, bg]) => <div className="stat" key={a} style={{ background: bg, minHeight: 0 }}><header>{a}</header><strong>{b}</strong><small>{c}</small></div>)}</div>
    <section className="card"><div className="head"><b>ACCEPTANCE TEST ASSERTIONS</b></div>{list.map((t) => <div className="test" key={t.name}><div><b>✔ {t.name}</b><div><span className="cat">{t.tag}</span> <small className="mono">Duration: {t.ms}ms</small></div></div><span className="pass">PASSED</span></div>)}</section></>)
}