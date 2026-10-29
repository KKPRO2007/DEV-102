import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { z } from 'zod'
import { AlertTriangle, Ban, Bot, Check, CornerDownRight, Globe, Loader2, MonitorPlay, RefreshCw, Search, Send, Undo2, X } from 'lucide-react'
import type { Severity, Violation } from '../lib/types'
import { monitorApi, type MonitorSession, type SessionDetail } from '../lib/api'
import { STATUS_LABEL, VIOLATION_META, formatClock, groupVisits, timeAgo, useNow } from '../lib/monitorUtils'
import { watchScreen, type ScreenState } from '../lib/live'
import { RiskBadge, SEVERITY_STYLES, SeverityBadge } from './RiskBadge'
import { FakeWebcam } from './StudentTile'

type Notify = (kind: 'success' | 'error' | 'info', message: string) => void
type Tab = 'overview' | 'timeline' | 'browsing'

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return
  const els = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (!els.length) return
  const first = els[0]
  const last = els[els.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('textarea,input,select')?.focus()
  }, [])
  // Portalled so it is not trapped inside the drawer's transformed container.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center p-4"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
        trapTab(e, ref.current)
      }}
    >
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id={id} className="font-heading text-lg font-semibold text-text">{title}</h2>
        {children}
      </motion.div>
    </div>,
    document.body,
  )
}

const warnSchema = z.string().trim().min(5, 'Write at least 5 characters.').max(200, 'Keep it under 200 characters.')
const TEMPLATES = [
  'Please keep your face centred in the camera frame.',
  'Another person is visible in your camera. Please make sure you are alone.',
  'AI tools are not permitted in this exam. Close that tab immediately.',
  'Please keep the exam window in focus.',
]

export function WarnDialog({ targets, onSend, onClose }: { targets: MonitorSession[]; onSend: (message: string) => Promise<void>; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    const parsed = warnSchema.safeParse(message)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Invalid message.'); return }
    setBusy(true)
    setError(null)
    try {
      await onSend(parsed.data)
      onClose()
    } catch {
      setError('Could not send the warning. Check your connection and retry.')
      setBusy(false)
    }
  }
  const who = targets.length === 1 ? targets[0].candidateName : `${targets.length} candidates`
  return (
    <ModalShell title={`Send warning to ${who}`} onClose={onClose}>
      <p className="mt-1 text-sm text-muted">The message appears on the candidate's exam screen and counts as a recorded warning.</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {TEMPLATES.map((t) => <button key={t} type="button" onClick={() => { setMessage(t); setError(null) }} className="rounded-full bg-soft px-3 py-1 text-xs text-text hover:bg-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">{t.split('. ')[0].replace(/\.$/, '')}</button>)}
      </div>
      <label className="mt-4 block text-sm font-medium text-text">Message
        <textarea value={message} onChange={(e) => { setMessage(e.target.value); setError(null) }} rows={3} maxLength={200} aria-invalid={Boolean(error)} className="mt-1 w-full resize-none rounded-xl border border-border p-3 text-sm focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/20" />
      </label>
      <div className="mt-1 flex justify-between text-xs"><span role="alert" className="text-danger">{error}</span><span className="tabular-nums text-muted">{message.length}/200</span></div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-text hover:bg-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30">Cancel</button>
        <button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl bg-cta px-5 py-2 text-sm font-semibold text-slate-900 hover:brightness-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-cta/40 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send warning
        </button>
      </div>
    </ModalShell>
  )
}

const REASONS = ['Confirmed use of an AI assistant', 'Impersonation or face mismatch', 'Repeated policy violations', 'Other misconduct']

function TerminateDialog({ session, onConfirm, onClose }: { session: MonitorSession; onConfirm: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState(REASONS[0])
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const go = async () => {
    setBusy(true)
    setError(false)
    try { await onConfirm(reason); onClose() } catch { setError(true); setBusy(false) }
  }
  return (
    <ModalShell title={`Terminate ${session.candidateName}'s session?`} onClose={onClose}>
      <div className="mt-3 flex gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-text">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
        This ends the exam for this candidate immediately and they cannot resume. It is recorded against your account.
      </div>
      <label className="mt-4 block text-sm font-medium text-text">Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-white p-2.5 text-sm focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/20">
          {REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-sm font-medium text-text">Type <span className="font-mono font-semibold">TERMINATE</span> to confirm
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-xl border border-border p-2.5 font-mono text-sm focus:border-danger focus:outline-none focus:ring-4 focus:ring-danger/20" />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-danger">Could not terminate the session. Please retry.</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-text hover:bg-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30">Keep session</button>
        <button onClick={() => void go()} disabled={typed !== 'TERMINATE' || busy} className="flex items-center gap-2 rounded-xl bg-danger px-5 py-2 text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-danger/40 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Terminate session
        </button>
      </div>
    </ModalShell>
  )
}

/** Simulated screen capture (mock data): question pane, palette driven by progress, and an AI window when flagged. */
function FakeScreen({ progress, aiOpen, live }: { progress: number; aiOpen: boolean; live: boolean }) {
  const answered = Math.round((progress / 100) * 40)
  return (
    <div role="img" aria-label={`Simulated screen view. ${aiOpen ? 'An AI assistant window is open.' : 'Exam window in focus.'}`} className="relative aspect-video overflow-hidden rounded-xl border border-border bg-white text-[10px] shadow-inner">
      <div className="flex h-6 items-center gap-2 bg-primary px-3 text-white"><span className="font-semibold">DEV102 Secure Exam</span><span className="ml-auto tabular-nums">Q {Math.min(40, answered + 1)} / 40</span></div>
      <div className="grid h-[calc(100%-1.5rem)] grid-cols-[1fr_84px]">
        <div className="space-y-2 p-3">
          <div className="h-2 w-2/5 rounded bg-slate-200" />
          <div className="h-2 w-full rounded bg-slate-200" />
          <div className="h-2 w-3/4 rounded bg-slate-200" />
          <div className="space-y-1.5 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`flex items-center gap-2 rounded border px-2 py-1.5 ${i === 1 ? 'border-accent bg-soft' : 'border-border'}`}>
                <span className={`h-2.5 w-2.5 rounded-full border ${i === 1 ? 'border-accent bg-accent' : 'border-slate-300'}`} /><span className="h-1.5 w-2/3 rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
        <div className="border-l border-border p-2">
          <div className="grid grid-cols-5 gap-1">
            {Array.from({ length: 40 }, (_, i) => <span key={i} className={`aspect-square rounded-sm ${i < answered ? 'bg-success/70' : i === answered ? 'bg-accent' : 'bg-slate-200'}`} />)}
          </div>
        </div>
      </div>
      {aiOpen && (
        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="absolute bottom-3 right-3 w-[48%] overflow-hidden rounded-lg border-2 border-danger bg-white shadow-xl">
          <div className="flex items-center gap-1 bg-danger px-2 py-1 font-semibold text-white"><Bot className="h-3 w-3" aria-hidden="true" />AI assistant tab (flagged)</div>
          <div className="space-y-1 p-2"><div className="h-1.5 w-full rounded bg-slate-200" /><div className="h-1.5 w-4/5 rounded bg-slate-200" /><div className="h-1.5 w-2/3 rounded bg-slate-200" /></div>
        </motion.div>
      )}
      {live && <span className="absolute left-2 top-8 inline-flex items-center gap-1 rounded bg-slate-900/70 px-1.5 py-0.5 font-semibold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />LIVE</span>}
      {live && <motion.span aria-hidden="true" className="absolute h-3 w-3 rounded-full border-2 border-slate-700 bg-white/70" animate={{ left: ['22%', '34%', '28%', '40%', '22%'], top: ['40%', '48%', '58%', '50%', '40%'] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />}
    </div>
  )
}

interface DrawerProps {
  session: MonitorSession | null
  onClose: () => void
  onSendWarning: (session: MonitorSession, message: string) => Promise<void>
  onTerminate: (session: MonitorSession, reason: string) => Promise<void>
  onSessionPatch: (session: MonitorSession) => void
  notify: Notify
}

const SCREEN_MESSAGE: Record<ScreenState, string> = {
  connecting: "Connecting to the candidate's screen…",
  live: 'Live',
  unavailable: "The candidate's app is not sharing a screen right now.",
  ended: 'The screen connection ended.',
}

/** Live view of the candidate's screen over WebRTC; stopping or closing the drawer hangs up. */
function LiveScreen({ sessionId, candidateName }: { sessionId: string; candidateName: string }) {
  const [watching, setWatching] = useState(false)
  const [state, setState] = useState<ScreenState>('connecting')
  const [listening, setListening] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!watching || !video) return
    const stop = watchScreen(sessionId, (stream) => { video.srcObject = stream }, setState)
    return () => {
      stop()
      video.srcObject = null
    }
  }, [watching, sessionId])

  if (!watching) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl bg-slate-900 text-sm text-slate-300">
        <p>See {candidateName}&apos;s screen as it is now.</p>
        <button onClick={() => { setState('connecting'); setWatching(true) }} className="inline-flex items-center gap-2 rounded-xl bg-cta px-4 py-2 font-semibold text-slate-900 hover:brightness-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-cta/40">
          <MonitorPlay className="h-4 w-4" aria-hidden="true" />Watch screen
        </button>
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-xl bg-slate-950">
      <div className="flex items-center justify-between gap-3 bg-slate-900 px-3 py-2 text-xs text-white">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          {state === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />}
          Screen · {SCREEN_MESSAGE[state]}
        </span>
<button onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setListening(!v.muted) } }} aria-pressed={listening} className="rounded-md px-2 py-1 font-semibold hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">{listening ? 'Mute' : 'Listen'}</button>
        <button onClick={() => setWatching(false)} aria-label="Stop watching the screen" className="rounded-md p-1 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <video ref={videoRef} autoPlay muted playsInline aria-label={`Live screen of ${candidateName}`} className={`aspect-video w-full bg-black object-contain ${state === 'live' ? '' : 'hidden'}`} />
      {state !== 'live' && <p role="status" className="flex aspect-video items-center justify-center gap-2 text-sm text-slate-300">{state === 'connecting' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{SCREEN_MESSAGE[state]}</p>}
    </div>
  )
}

export function SessionDrawer({ session, onClose, ...rest }: DrawerProps) {
  const ref = useRef<HTMLElement>(null)
  return (
    <AnimatePresence>
      {session && (
        <>
          <motion.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
          <motion.aside
            key="panel"
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={`Session details for ${session.candidateName}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            onKeyDown={(e) => {
              if (!ref.current?.contains(e.target as Node)) return
              if (e.key === 'Escape') onClose()
              trapTab(e, ref.current)
            }}
            className="fixed inset-y-0 right-0 z-50 flex w-[min(960px,100vw)] flex-col bg-soft shadow-2xl"
          >
            <DrawerBody session={session} onClose={onClose} {...rest} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function DrawerBody({ session, onClose, onSendWarning, onTerminate, onSessionPatch, notify }: DrawerProps & { session: MonitorSession }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [warnOpen, setWarnOpen] = useState(false)
  const [termOpen, setTermOpen] = useState(false)
  const [aiOnly, setAiOnly] = useState(false)
  const [q, setQ] = useState('')
  const [logView, setLogView] = useState<'activity' | 'entries'>('activity')
  const now = useNow(1000)
  const closeRef = useRef<HTMLButtonElement>(null)
  const loadedOnce = useRef(false)
  const sid = session.id
  const lastId = session.lastViolation?.id
  const live = session.status === 'LIVE'

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => prev?.focus?.()
  }, [])

  const load = useCallback(async (silent: boolean) => {
    if (!silent) { setDetail(null); setFailed(false) }
    try { setDetail(await monitorApi.getSessionDetail(sid)); setFailed(false) } catch { if (!silent) setFailed(true) }
  }, [sid])
  // Reload silently whenever the live session reports a new violation.
  useEffect(() => {
    void load(loadedOnce.current)
    loadedOnce.current = true
  }, [load, lastId])

  const review = async (v: Violation, verdict: 'CONFIRMED' | 'OVERRULED') => {
    try {
      const r = await monitorApi.reviewViolation(v.id, verdict)
      setDetail((d) => (d ? { ...d, violations: d.violations.map((x) => (x.id === v.id ? r.violation : x)) } : d))
      onSessionPatch(r.session)
      notify('success', verdict === 'CONFIRMED' ? 'Penalty confirmed' : 'Penalty overruled and risk score reduced')
    } catch {
      notify('error', 'Could not save your review. Please try again.')
    }
  }

  const violations = useMemo(() => (detail ? detail.violations.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : []), [detail])
  const logs = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (detail?.logs ?? []).filter((l) => (!aiOnly || l.flaggedAi) && (!term || `${l.url} ${l.title} ${l.query ?? ''}`.toLowerCase().includes(term))).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }, [detail, aiOnly, q])
  const visits = useMemo(() => {
    const term = q.trim().toLowerCase()
    return groupVisits(detail?.logs ?? []).filter((v) => (!aiOnly || v.ai) && (!term || `${v.site} ${v.url} ${v.queries.map((x) => x.text).join(' ')}`.toLowerCase().includes(term)))
  }, [detail, aiOnly, q])
  const aiCount = detail?.logs.filter((l) => l.flaggedAi).length ?? 0
  const bySeverity = useMemo(() => {
    const m: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
    violations.forEach((v) => { m[v.severity] += 1 })
    return m
  }, [violations])
  const elapsedMin = Math.max(0, Math.round((now - Date.parse(session.startedAt)) / 60000))

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'timeline', label: 'Violation timeline', count: detail?.violations.length },
    { id: 'browsing', label: 'Browsing & search log', count: detail?.logs.length },
  ]

  return (
    <>
      <header className="flex items-center gap-4 border-b border-border bg-white p-5">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-900"><FakeWebcam hue={session.hue} frame="NORMAL" photo={session.photoUrl} className="h-full w-full" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-xl font-semibold text-text">{session.candidateName}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted"><span className="font-mono">{session.userId}</span><span aria-hidden="true">·</span>{STATUS_LABEL[session.status]}</p>
        </div>
        <RiskBadge score={session.riskScore} />
        <button onClick={() => setWarnOpen(true)} disabled={!live} className="flex items-center gap-1.5 rounded-xl bg-cta px-4 py-2 text-sm font-semibold text-slate-900 hover:brightness-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-cta/40 disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" aria-hidden="true" />Warn</button>
        <button onClick={() => setTermOpen(true)} disabled={!live} className="flex items-center gap-1.5 rounded-xl border border-danger px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/5 focus:outline-none focus-visible:ring-4 focus-visible:ring-danger/30 disabled:cursor-not-allowed disabled:opacity-40"><Ban className="h-4 w-4" aria-hidden="true" />Terminate</button>
        <button ref={closeRef} onClick={onClose} aria-label="Close session details" className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-soft hover:text-text focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30"><X className="h-5 w-5" /></button>
      </header>

      <div role="tablist" aria-label="Session sections" className="flex gap-1 border-b border-border bg-white px-5">
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)} className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${tab === t.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-muted hover:text-text'}`}>
            {t.label}{t.count !== undefined && <span className="rounded-full bg-soft px-1.5 text-xs tabular-nums">{t.count}</span>}
            {t.id === 'browsing' && aiCount > 0 && <span className="rounded-full bg-danger px-1.5 text-xs text-white">{aiCount} AI</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-5">
        {failed ? (
          <div role="alert" className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-text">
            <span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-danger" />Could not load this session's records.</span>
            <button onClick={() => void load(false)} className="flex items-center gap-1 font-semibold text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"><RefreshCw className="h-4 w-4" />Retry</button>
          </div>
        ) : tab === 'overview' ? (
          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-2">
              {live ? (
                <LiveScreen sessionId={session.id} candidateName={session.candidateName} />
              ) : (
                <>
                  <FakeScreen progress={session.progress} aiOpen={session.aiOpen && live} live={live} />
                  <p className="text-xs text-muted">Simulated screen preview (mock data). Updated at last activity.</p>
                </>
              )}
            </div>
            <div className="space-y-4">
              <div className="overflow-hidden rounded-xl bg-slate-900"><FakeWebcam hue={session.hue} frame={session.frame} photo={session.photoUrl} className="aspect-[4/3] w-full" /></div>
              <dl className="grid grid-cols-2 gap-2">
                {[['Progress', `${Math.round(session.progress)}%`], ['Warnings', String(session.warnings)], ['Violations', String(session.violationCount)], ['Time elapsed', `${elapsedMin} min`]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-white p-3 ring-1 ring-border"><dt className="text-xs text-muted">{k}</dt><dd className="font-heading text-lg font-semibold tabular-nums text-text">{v}</dd></div>
                ))}
              </dl>
              <div className="rounded-xl bg-white p-4 ring-1 ring-border">
                <h3 className="mb-3 text-sm font-semibold text-text">Violations by severity</h3>
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).map((s) => (
                  <div key={s} className="mb-2 flex items-center gap-2 text-xs last:mb-0">
                    <span className="w-14 text-muted">{SEVERITY_STYLES[s].label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-border"><div className={`h-full ${SEVERITY_STYLES[s].bar}`} style={{ width: `${Math.min(100, bySeverity[s] * 20)}%` }} /></div>
                    <span className="w-4 text-right tabular-nums text-text">{bySeverity[s]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : detail === null ? (
          <ul className="space-y-3" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <li key={i} className="h-16 animate-pulse rounded-xl bg-white" />)}</ul>
        ) : tab === 'timeline' ? (
          violations.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-border bg-white py-16 text-center text-sm text-muted"><div><Check className="mx-auto mb-2 h-8 w-8 text-success" /><p className="font-semibold text-text">Clean session so far</p>No violations recorded for this candidate.</div></div>
          ) : (
            <ol className="relative space-y-3 border-l-2 border-border pl-6">
              {violations.map((v) => (
                <li key={v.id} className="relative rounded-xl bg-white p-4 ring-1 ring-border">
                  <span className={`absolute -left-[31px] top-5 h-3 w-3 rounded-full ring-4 ring-soft ${SEVERITY_STYLES[v.severity].bar}`} aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-text">{VIOLATION_META[v.code].label}</span>
                    <SeverityBadge severity={v.severity} />
                    {v.reviewed && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${v.reviewed === 'CONFIRMED' ? 'bg-danger/10 text-danger' : 'bg-slate-100 text-muted'}`}>{v.reviewed === 'CONFIRMED' ? 'Penalty confirmed' : 'Overruled'}</span>}
                    <time dateTime={v.at} className="ml-auto text-xs tabular-nums text-muted">{formatClock(v.at)} · {timeAgo(v.at, now)}</time>
                  </div>
                  <p className="mt-1 text-sm text-muted">{v.message}</p>
                  {v.evidenceUrl && <img src={v.evidenceUrl} alt={`Evidence: ${VIOLATION_META[v.code].label}`} loading="lazy" className="mt-3 max-h-64 w-full rounded-lg border border-border bg-soft object-contain" />}
                  {!v.reviewed && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => void review(v, 'CONFIRMED')} className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1 text-xs font-semibold text-white hover:bg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"><Check className="h-3.5 w-3.5" aria-hidden="true" />Confirm penalty</button>
                      <button onClick={() => void review(v, 'OVERRULED')} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs font-semibold text-text hover:bg-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"><Undo2 className="h-3.5 w-3.5" aria-hidden="true" />Overrule</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative min-w-[220px] flex-1">
                <span className="sr-only">Search browsing log</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search URL, title or query" className="w-full rounded-xl border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/20" />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text"><input type="checkbox" checked={aiOnly} onChange={(e) => setAiOnly(e.target.checked)} className="h-4 w-4 accent-primary-600" />AI sites only</label>
              <div className="flex rounded-lg bg-soft p-0.5" role="group" aria-label="Browsing view">
                {([['activity', 'Activity'], ['entries', 'All entries']] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={logView === id} onClick={() => setLogView(id)} className={`rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${logView === id ? 'bg-white text-primary shadow-sm' : 'text-muted hover:text-text'}`}>{label}</button>
                ))}
              </div>
            </div>
            {logView === 'activity' ? (
              visits.length === 0 ? (
                <div className="grid place-items-center rounded-xl border border-dashed border-border bg-white py-16 text-center text-sm text-muted">{detail.logs.length === 0 ? 'This candidate has not opened any exam tabs yet.' : 'No entries match your filters.'}</div>
              ) : (
                <ol className="space-y-2" aria-label="Sites opened and what was typed on them">
                  {visits.map((v) => (
                    <li key={v.key} className={`rounded-xl bg-white p-3 ring-1 ${v.ai ? 'border-l-4 border-danger ring-danger/20' : 'border-l-4 border-transparent ring-border'}`}>
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${v.ai ? 'bg-danger text-white' : 'bg-soft text-muted'}`}>{v.ai ? <Bot className="h-4 w-4" aria-hidden="true" /> : <Globe className="h-4 w-4" aria-hidden="true" />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text">{v.returned ? <>Switched back to <span className="font-semibold">{v.site}</span></> : <><span className="font-semibold">{v.site}</span> opened</>}{v.ai && <span className="ml-2 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">AI site</span>}</p>
                          <p className="truncate font-mono text-xs text-muted">{v.url}</p>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-muted">{formatClock(v.at)}</span>
                      </div>
                      {v.queries.length > 0 && (
                        <ul className="mt-2 space-y-1.5 pl-11">
                          {v.queries.map((x) => (
                            <li key={x.id} className="flex items-start gap-2 text-sm">
                              <CornerDownRight className={`mt-0.5 h-4 w-4 shrink-0 ${v.ai ? 'text-danger' : 'text-muted'}`} aria-hidden="true" />
                              <p className="min-w-0 flex-1 text-text"><span className="text-muted">{v.ai ? 'Typed' : 'Searched'}:</span> <span className="font-medium">“{x.text}”</span></p>
                              <span className="shrink-0 text-xs tabular-nums text-muted">{formatClock(x.at)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )
            ) : logs.length === 0 ? (
              <div className="grid place-items-center rounded-xl border border-dashed border-border bg-white py-16 text-center text-sm text-muted">{detail.logs.length === 0 ? 'This candidate has not opened any exam tabs yet.' : 'No entries match your filters.'}</div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl bg-white ring-1 ring-border">
                {logs.map((l) => (
                  <li key={l.id} className={`flex gap-3 p-3 ${l.flaggedAi ? 'border-l-4 border-danger bg-danger/5' : 'border-l-4 border-transparent'}`}>
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${l.flaggedAi ? 'bg-danger text-white' : 'bg-soft text-muted'}`}>{l.flaggedAi ? <Bot className="h-4 w-4" aria-label="AI site" /> : <Globe className="h-4 w-4" aria-hidden="true" />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text">{l.title}</p>
                      <p className="truncate font-mono text-xs text-muted">{l.url}</p>
                      {l.query && <p className="mt-1 text-xs text-text">Query: <span className="font-medium">“{l.query}”</span></p>}
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums text-muted">{formatClock(l.at)}{l.flaggedAi && <span className="mt-1 block font-semibold text-danger">Flagged: AI</span>}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {warnOpen && <WarnDialog targets={[session]} onSend={(m) => onSendWarning(session, m)} onClose={() => setWarnOpen(false)} />}
      {termOpen && <TerminateDialog session={session} onConfirm={(r) => onTerminate(session, r)} onClose={() => setTermOpen(false)} />}
    </>
  )
}
