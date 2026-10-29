import { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, CloudOff, Eraser, Flag, Globe, Keyboard, Loader2, Lock, RefreshCw, Send, WifiOff, X } from 'lucide-react'
import { api, type ExamPaper, type ViolationResult } from '../lib/api'
import { startLive } from '../lib/live'
import { getProctor } from '../lib/proctorMock'
import type { BrowsingLog, Question, Severity, ViolationCode } from '../lib/types'
import QuestionPalette, { type PaletteItem } from '../components/QuestionPalette'
import Timer from '../components/Timer'
import BrowserTabs from '../components/BrowserTabs'
import WarningModal, { type WarningInfo, type WarningKind } from '../components/WarningModal'
import WebcamThumb, { type FaceStatus, type LinkQuality } from '../components/WebcamThumb'
import { isAnswered, isNumeric, toNumber, valuesOf } from '../lib/answers'

/* ───────────────────────── policy & helpers ───────────────────────── */

const VIOLATION_META: Record<ViolationCode, { severity: Severity; message: string }> = {
  MULTIPLE_FACES: { severity: 'HIGH', message: 'More than one face was detected in your webcam feed.' },
  NO_FACE: { severity: 'MEDIUM', message: 'No face was detected. Stay visible to the camera.' },
  GAZE_AWAY: { severity: 'LOW', message: 'You appear to be looking away from the screen.' },
  FACE_MISMATCH: { severity: 'HIGH', message: 'The person on camera does not match your verified face.' },
  AI_SITE_OPENED: { severity: 'HIGH', message: 'An AI assistant website was opened in the sandbox browser.' },
  AI_QUERY_DETECTED: { severity: 'HIGH', message: 'A search that looks like an AI prompt or answer lookup was detected.' },
  BLACKLISTED_APP: { severity: 'HIGH', message: 'A blacklisted application was started during the exam.' },
  SCREEN_MIRRORING: { severity: 'HIGH', message: 'Screen mirroring or casting was detected.' },
  MULTI_MONITOR: { severity: 'HIGH', message: 'An additional monitor was connected.' },
  VM_DETECTED: { severity: 'CRITICAL', message: 'A virtual machine environment was detected.' },
  REMOTE_DESKTOP: { severity: 'CRITICAL', message: 'A remote desktop session was detected.' },
  EXTERNAL_DEVICE: { severity: 'MEDIUM', message: 'An unauthorised external device was connected.' },
  CLIPBOARD_USE: { severity: 'MEDIUM', message: 'Copy, cut and paste are not allowed during the exam.' },
  SHORTCUT_BLOCKED: { severity: 'LOW', message: 'A restricted keyboard shortcut was blocked.' },
  SCREEN_SHARE_STOPPED: { severity: 'HIGH', message: 'Screen sharing was stopped. Share your entire screen again.' },
  CAMERA_BLOCKED: { severity: 'HIGH', message: 'Your camera feed was interrupted or covered.' },
  MULTI_LOGIN: { severity: 'CRITICAL', message: 'This account signed in from another device.' },
  NETWORK_LOST: { severity: 'LOW', message: 'Your internet connection was lost.' },
  WINDOW_BLUR: { severity: 'MEDIUM', message: 'The exam window lost focus.' },
  VOICE_DETECTED: { severity: 'MEDIUM', message: 'Talking was detected. Stay silent during the exam.' },
  MIC_BLOCKED: { severity: 'HIGH', message: 'Your microphone is muted or disconnected. Turn it back on.' },
  PHONE_DETECTED: { severity: 'HIGH', message: 'A phone is visible on camera. Put it away out of reach.' },
  NOTES_DETECTED: { severity: 'MEDIUM', message: 'A book or notes are visible on camera. Put them away.' },
}

const FACE_MAP: Partial<Record<ViolationCode, FaceStatus>> = { NO_FACE: 'NO_FACE', MULTIPLE_FACES: 'MULTIPLE_FACES', FACE_MISMATCH: 'FACE_MISMATCH' }
const SEVERITY_DOT: Record<Severity, string> = { LOW: 'bg-slate-400', MEDIUM: 'bg-amber-500', HIGH: 'bg-orange-500', CRITICAL: 'bg-danger' }
const DIFFICULTY_CLS = { EASY: 'bg-green-50 text-success', MEDIUM: 'bg-amber-50 text-amber-700', HARD: 'bg-red-50 text-danger' } as const
const DEDUPE_MS = 4000

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const sectionOf = (q: Question) => q.tags[0] ?? 'General'
const clock = (iso: string | number) => new Date(iso).toLocaleTimeString('en-IN', { hour12: false })

/**
 * Policy: the first `max` MEDIUM/HIGH events warn (the last of them is the final warning).
 * Beyond that a HIGH auto-submits. Any CRITICAL auto-submits. LOW events are only logged.
 */
function decide(severity: Severity, warnings: number, max: number, autoSubmit: boolean): WarningKind | 'none' {
  let kind: WarningKind | 'none' = 'none'
  if (severity === 'CRITICAL') kind = 'submit'
  else if (severity === 'MEDIUM' || severity === 'HIGH') {
    if (warnings <= max) kind = warnings === max ? 'final' : 'warning'
    else kind = severity === 'HIGH' ? 'submit' : 'final'
  }
  return kind === 'submit' && !autoSubmit ? 'final' : kind
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Shuffles inside each section with a per-candidate seed so a resumed session keeps its order. */
function orderQuestions(qs: Question[], shuffle: boolean, seed: string): Question[] {
  if (!shuffle) return qs
  const rand = mulberry32(hashSeed(seed))
  const groups = new Map<string, Question[]>()
  qs.forEach((q) => groups.set(sectionOf(q), [...(groups.get(sectionOf(q)) ?? []), q]))
  return [...groups.values()].flatMap((g) => {
    const a = [...g]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  })
}

/* ───────────────────────── store ───────────────────────── */

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline'
interface ViolationEvent { id: string; code: ViolationCode; severity: Severity; message: string; at: string }

interface ExamState {
  questions: Question[]
  answers: Record<string, string[]>
  /** Raw text typed into numeric answer boxes, by question id. */
  numeric: Record<string, string>
  flagged: Record<string, boolean>
  index: number
  rev: number
  endsAt: number
  save: { status: SaveStatus; at: number | null }
  warnings: number
  events: ViolationEvent[]
  log: BrowsingLog[]
  /** One-way exams only move forward, one question at a time. */
  oneWay: boolean
  init: (paper: ExamPaper, seed: string) => void
  choose: (qid: string, optionId: string, multi: boolean) => void
  type: (qid: string, raw: string) => void
  clear: (qid: string) => void
  toggleFlag: (qid: string) => void
  go: (i: number) => void
}

const useExamStore = create<ExamState>()((set) => ({
  questions: [],
  answers: {},
  numeric: {},
  flagged: {},
  index: 0,
  rev: 0,
  endsAt: 0,
  save: { status: 'idle', at: null },
  warnings: 0,
  events: [],
  log: [],
  oneWay: false,
  init: (paper, seed) =>
    set({
      questions: orderQuestions(paper.questions, paper.exam.settings.shuffle, seed),
      answers: paper.saved.answers,
      numeric: Object.fromEntries(Object.entries(paper.saved.values ?? {}).map(([id, v]) => [id, String(v)])),
      flagged: Object.fromEntries(paper.saved.flagged.map((id) => [id, true])),
      index: 0,
      rev: 0,
      endsAt: Date.now() + paper.remainingSec * 1000,
      save: { status: 'idle', at: null },
      warnings: paper.warningsUsed,
      events: [],
      log: [],
      oneWay: Boolean(paper.exam.settings.oneWay),
    }),
  choose: (qid, optionId, multi) =>
    set((s) => {
      const cur = s.answers[qid] ?? []
      const next = multi ? (cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId]) : [optionId]
      return { answers: { ...s.answers, [qid]: next }, rev: s.rev + 1 }
    }),
  type: (qid, raw) => set((s) => ({ numeric: { ...s.numeric, [qid]: raw.slice(0, 32) }, rev: s.rev + 1 })),
  clear: (qid) => set((s) => ({ answers: { ...s.answers, [qid]: [] }, numeric: { ...s.numeric, [qid]: '' }, rev: s.rev + 1 })),
  toggleFlag: (qid) => set((s) => ({ flagged: { ...s.flagged, [qid]: !s.flagged[qid] }, rev: s.rev + 1 })),
  go: (i) =>
    set((s) => {
      if (s.oneWay && i !== s.index + 1) return {}
      return { index: Math.min(Math.max(i, 0), Math.max(0, s.questions.length - 1)) }
    }),
}))

/* ───────────────────────── screen ───────────────────────── */

export interface SubmitSummary {
  answered: number
  total: number
  flagged: number
  autoSubmitted: boolean
  disqualified?: boolean
  reason?: string
  receiptId: string
  submittedAt?: string
}

interface ExamProps {
  examId: string
  userId: string
  onSubmitted: (summary: SubmitSummary) => void
}

type Phase = 'loading' | 'error' | 'active'
interface Toast { id: string; text: string; tone: 'info' | 'ok' | 'warn' }

export default function Exam({ examId, userId, onSubmitted }: ExamProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paper, setPaper] = useState<ExamPaper | null>(null)
  const [view, setView] = useState<'exam' | 'browser'>('exam')
  const [submitOpen, setSubmitOpen] = useState(false)
  const [forcedReason, setForcedReason] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [activeWarning, setActiveWarning] = useState<WarningInfo | null>(null)
  const [face, setFace] = useState<FaceStatus>('OK')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [serverReachable, setServerReachable] = useState(true)
  const paused = !online || !serverReachable
  const [toasts, setToasts] = useState<Toast[]>([])
  const [helpOpen, setHelpOpen] = useState(false)

  const questions = useExamStore((s) => s.questions)
  const answers = useExamStore((s) => s.answers)
  const numeric = useExamStore((s) => s.numeric)
  const flagged = useExamStore((s) => s.flagged)
  const index = useExamStore((s) => s.index)
  const oneWay = useExamStore((s) => s.oneWay)
  const rev = useExamStore((s) => s.rev)
  const endsAt = useExamStore((s) => s.endsAt)
  const save = useExamStore((s) => s.save)
  const warnings = useExamStore((s) => s.warnings)
  const events = useExamStore((s) => s.events)
  const log = useExamStore((s) => s.log)
  const { choose, type, clear, toggleFlag, go } = useExamStore.getState()

  const stageRef = useRef<HTMLElement>(null)
  const paperRef = useRef<ExamPaper | null>(null)
  const phaseRef = useRef<Phase>('loading')
  const submittingRef = useRef(false)
  const lastEmit = useRef<Partial<Record<ViolationCode, number>>>({})
  const faceTimer = useRef(0)
  const savedRev = useRef(0)
  const inflight = useRef(false)
  const uiRef = useRef({ view, modalOpen: false })
  uiRef.current = { view, modalOpen: submitOpen || forcedReason !== null || activeWarning !== null || paused }
  paperRef.current = paper
  phaseRef.current = phase

  const pushToast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = uid()
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  const load = useCallback(async () => {
    setPhase('loading')
    setLoadError(null)
    try {
      const p = await api.getExamPaper(examId)
      useExamStore.getState().init(p, `${examId}:${userId}`)
      setPaper(p)
      setPhase('active')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the exam paper.')
      setPhase('error')
    }
  }, [examId, userId])

  useEffect(() => {
    void load()
  }, [load])

  /* violation pipeline: every source (native events, DOM events, browser, simulation) lands here */
  const report = useCallback(
    (code: ViolationCode, opts?: { severity?: Severity; message?: string }) => {
      const p = paperRef.current
      if (!p || phaseRef.current !== 'active' || submittingRef.current) return
      const now = Date.now()
      if (now - (lastEmit.current[code] ?? 0) < DEDUPE_MS) return
      lastEmit.current[code] = now

      const severity = opts?.severity ?? VIOLATION_META[code].severity
      const message = opts?.message ?? VIOLATION_META[code].message
      const at = new Date().toISOString()
      const prev = useExamStore.getState()
      useExamStore.setState({ events: [{ id: uid(), code, severity, message, at }, ...prev.events].slice(0, 30) })

      // Proctor-only exams tell the candidate nothing; the event still goes to the proctor below.
      const silent = Boolean(p.exam.settings.proctorOnly)
      const faceState = FACE_MAP[code]
      if (faceState && !silent) {
        setFace(faceState)
        window.clearTimeout(faceTimer.current)
        faceTimer.current = window.setTimeout(() => setFace('OK'), 6000)
      }

      // The server applies the exam's policy and is authoritative. The local rule only runs in
      // mock mode or while offline (the event is queued and replayed on reconnect).
      const applyLocal = () => {
        const { maxWarnings, autoSubmit } = p.exam.settings
        const total = useExamStore.getState().warnings + (severity === 'MEDIUM' || severity === 'HIGH' ? 1 : 0)
        useExamStore.setState({ warnings: total })
        const kind = decide(severity, total, maxWarnings, autoSubmit)
        if (kind === 'none') {
          if (severity === 'LOW') pushToast(`Noted: ${message}`, 'info')
          return
        }
        setActiveWarning((cur) => (cur?.kind === 'submit' ? cur : { id: uid(), code, severity, message, kind, warningNumber: total }))
      }
      const applyServer = (r: ViolationResult) => {
        useExamStore.setState({ warnings: r.warnings })
        if (r.outcome === 'AUTO_SUBMIT' || r.status === 'TERMINATED' || r.status === 'SUBMITTED') {
          setActiveWarning({ id: uid(), code, severity, message, kind: 'submit', warningNumber: r.warnings })
        } else if (r.outcome === 'WARNING') {
          const kind: WarningKind = r.warnings >= r.maxWarnings ? 'final' : 'warning'
          setActiveWarning((cur) => (cur?.kind === 'submit' ? cur : { id: uid(), code, severity, message, kind, warningNumber: r.warnings }))
        } else if (r.outcome !== 'SUPPRESSED') pushToast(`Noted: ${message}`, 'info')
      }
      void api.reportViolation({ examId: p.exam.id, sessionId: p.sessionId, code, severity, message, at }).then((r) => {
        if (silent) return
        if (r) applyServer(r)
        else applyLocal()
      })
    },
    [pushToast],
  )

  /* submit: waits for connectivity, retries, and surfaces failures with a retry button */
  const finalize = useCallback(
    async (auto: boolean, reason?: string, disqualified?: boolean) => {
      const p = paperRef.current
      if (!p || submittingRef.current) return
      submittingRef.current = true
      setSubmitting(true)
      setSubmitError(null)
      setActiveWarning(null)
      if (auto) setForcedReason(reason ?? 'Your exam is being submitted.')

      const s = useExamStore.getState()
      const flaggedIds = s.questions.filter((q) => s.flagged[q.id]).map((q) => q.id)
      const answered = s.questions.filter((q) => isAnswered(q, s.answers, s.numeric)).length
      try {
        while (!navigator.onLine) await wait(1000)
        const res = await api.submitExam({ examId: p.exam.id, answers: s.answers, values: valuesOf(s.questions, s.numeric), flagged: flaggedIds, auto, reason, browsing: s.log })
        const isDisqualified = disqualified || res.status === 'TERMINATED'
        void getProctor().exitKiosk().catch(() => undefined)
        onSubmitted({ answered, total: s.questions.length, flagged: flaggedIds.length, autoSubmitted: auto, disqualified: isDisqualified, reason, receiptId: res.receiptId, submittedAt: res.submittedAt })
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'Submission failed. Please try again.')
        submittingRef.current = false
        setSubmitting(false)
      }
    },
    [onSubmitted],
  )

  /* autosave: debounce, retry on failure, hold while offline */
  const saveNow = useCallback(async (): Promise<void> => {
    const p = paperRef.current
    const s = useExamStore.getState()
    if (!p || inflight.current || s.rev === savedRev.current) return
    if (!navigator.onLine) {
      useExamStore.setState({ save: { status: 'offline', at: s.save.at } })
      return
    }
    inflight.current = true
    const target = s.rev
    useExamStore.setState({ save: { status: 'saving', at: s.save.at } })
    try {
      await api.saveProgress({ examId: p.exam.id, answers: s.answers, values: valuesOf(s.questions, s.numeric), flagged: s.questions.filter((q) => s.flagged[q.id]).map((q) => q.id) })
      savedRev.current = target
      useExamStore.setState({ save: { status: 'saved', at: Date.now() } })
    } catch {
      useExamStore.setState((st) => ({ save: { status: 'error', at: st.save.at } }))
      window.setTimeout(() => void saveNow(), 4000)
    } finally {
      inflight.current = false
    }
  }, [])

  useEffect(() => {
    if (rev === 0) return
    const id = window.setTimeout(() => void saveNow(), 1200)
    return () => window.clearTimeout(id)
  }, [rev, saveNow])

  /* connectivity */
  useEffect(() => {
    const off = () => {
      setOnline(false)
      report('NETWORK_LOST')
      useExamStore.setState((s) => ({ save: { ...s.save, status: 'offline' } }))
    }
    const on = () => {
      setOnline(true)
      pushToast('Back online. Syncing your answers.', 'ok')
      void saveNow()
    }
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    return () => {
      window.removeEventListener('offline', off)
      window.removeEventListener('online', on)
    }
  }, [report, pushToast, saveNow])

  /* offline pause: hold the time left while disconnected; the server gives the same time back on reconnect */
  const pausedLeft = useRef<number | null>(null)
  useEffect(() => {
    if (paused) pausedLeft.current = useExamStore.getState().endsAt - Date.now()
    else if (pausedLeft.current !== null) {
      useExamStore.setState({ endsAt: Date.now() + pausedLeft.current })
      pausedLeft.current = null
    }
  }, [paused])

  /* live channels: socket warnings and terminations, server clock, frames, activity, offline sync */
  useEffect(() => {
    if (phase !== 'active' || !paper) return
    const stop = startLive(paper.sessionId, {
      onWarning: (w) => {
        if (submittingRef.current) return
        if (w.fromMentor) {
          setActiveWarning((cur) => (cur?.kind === 'submit' ? cur : { id: uid(), code: 'WINDOW_BLUR', severity: 'MEDIUM', message: `Message from your invigilator: ${w.message}`, kind: 'warning', warningNumber: useExamStore.getState().warnings }))
          return
        }
        if (w.warnings !== undefined) useExamStore.setState({ warnings: w.warnings })
        const code = w.code ?? 'GAZE_AWAY'
        setActiveWarning((cur) => (cur?.kind === 'submit' ? cur : { id: uid(), code, severity: (w.severity as Severity) ?? VIOLATION_META[code].severity, message: w.message, kind: w.final ? 'final' : 'warning', warningNumber: w.warnings ?? 0 }))
      },
      onEnded: (info) => void finalize(true, info.reason || 'Your exam was submitted by the proctoring system.', info.status === 'TERMINATED'),
      onKicked: (reason) => {
        setLoadError(reason)
        setPhase('error')
      },
      onClock: (remainingSec) => {
        const serverEnd = Date.now() + remainingSec * 1000
        // Only correct drift above 2 s so the countdown does not jitter.
        if (Math.abs(serverEnd - useExamStore.getState().endsAt) > 2000) useExamStore.setState({ endsAt: serverEnd })
      },
      onReinstated: () => {
        setActiveWarning(null)
        pushToast('An invigilator reviewed the flag and reinstated your session.', 'ok')
      },
      onServerReachable: setServerReachable,
    }, { audioMonitoring: paper.exam.settings.audioMonitoring, liveAudio: Boolean(paper.exam.settings.liveAudio) })
    const onSimulate = (e: Event) => report((e as CustomEvent<{ code: ViolationCode }>).detail.code)
    window.addEventListener('proctor:report', onSimulate)
    return () => {
      stop()
      window.removeEventListener('proctor:report', onSimulate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paper?.sessionId])

  /* kiosk mode, native guards and native proctor events */
  useEffect(() => {
    const proctor = getProctor()
    void proctor.enterKiosk().catch(() => undefined)
    void window.proctor?.guards.start().catch(() => undefined)
    const unsubscribe = proctor.onEvent((ev) => report(ev.code, { message: ev.message }))
    const guard = (e: BeforeUnloadEvent) => {
      if (phaseRef.current === 'active' && !submittingRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => {
      unsubscribe()
      window.removeEventListener('beforeunload', guard)
      void window.proctor?.guards.stop().catch(() => undefined)
      void proctor.exitKiosk().catch(() => undefined)
    }
  }, [report])

  /* window focus loss: brief blurs are LOW, longer absences MEDIUM */
  useEffect(() => {
    let blurredAt: number | null = null
    const onBlur = () => { blurredAt = Date.now() }
    const onFocus = () => {
      if (blurredAt === null) return
      const away = Date.now() - blurredAt
      blurredAt = null
      if (away > 1500) report('WINDOW_BLUR', { severity: away > 5000 ? 'MEDIUM' : 'LOW', message: `The exam window lost focus for ${Math.round(away / 1000)} seconds.` })
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [report])

  /* clipboard, context menu and keyboard */
  useEffect(() => {
    const block = (e: Event) => {
      e.preventDefault()
      if (e.type !== 'contextmenu') report('CLIPBOARD_USE')
    }
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()

      if (ctrl && ['c', 'x', 'v'].includes(k)) { e.preventDefault(); report('CLIPBOARD_USE'); return }
      const restricted = (ctrl && ['p', 's', 'u', 'r', 'f'].includes(k)) || (ctrl && e.shiftKey && ['i', 'j'].includes(k)) || ['F5', 'F12', 'PrintScreen'].includes(e.key)
      if (restricted) {
        e.preventDefault()
        report('SHORTCUT_BLOCKED', { message: `Blocked shortcut: ${[ctrl ? 'Ctrl' : '', e.shiftKey ? 'Shift' : '', e.key].filter(Boolean).join('+')}` })
        return
      }
      if (e.key === 'Escape') { setHelpOpen(false); return }
      if (uiRef.current.modalOpen) return
      if (ctrl && e.key === 'Enter') { e.preventDefault(); setSubmitOpen(true); return }
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [data-webcam]')) return
      if (e.altKey && k === 'b') { e.preventDefault(); setView((v) => (v === 'exam' ? 'browser' : 'exam')); return }
      if (e.key === '?') { setHelpOpen((h) => !h); return }
      if (uiRef.current.view !== 'exam' || ctrl || e.altKey) return

      const s = useExamStore.getState()
      const q = s.questions[s.index]
      if (!q) return
      if (e.key === 'ArrowRight' || k === 'n') s.go(s.index + 1)
      else if (e.key === 'ArrowLeft' || k === 'p') s.go(s.index - 1)
      else if (k === 'm') s.toggleFlag(q.id)
      else if (k === 'c') s.clear(q.id)
      else if (/^[1-9]$/.test(e.key)) {
        const opt = q.options[Number(e.key) - 1]
        if (opt) s.choose(q.id, opt.id, q.multi)
      }
    }
    document.addEventListener('copy', block)
    document.addEventListener('cut', block)
    document.addEventListener('paste', block)
    document.addEventListener('contextmenu', block)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('copy', block)
      document.removeEventListener('cut', block)
      document.removeEventListener('paste', block)
      document.removeEventListener('contextmenu', block)
      document.removeEventListener('keydown', onKey)
    }
  }, [report])


  const handleLog = useCallback(
    (entry: Omit<BrowsingLog, 'id' | 'sessionId'>) => {
      const full: BrowsingLog = { ...entry, id: uid(), sessionId: paperRef.current?.sessionId ?? '' }
      useExamStore.setState((s) => ({ log: [full, ...s.log] }))
      void api.logBrowsing(examId, full).catch(() => undefined)
    },
    [examId],
  )

  const items = useMemo<PaletteItem[]>(
    () => questions.map((q, i) => ({ id: q.id, number: i + 1, section: sectionOf(q), answered: isAnswered(q, answers, numeric), flagged: !!flagged[q.id] })),
    [questions, answers, numeric, flagged],
  )

  const jumpTo = (i: number) => {
    setSubmitOpen(false)
    setView('exam')
    go(i)
  }

  if (phase === 'loading') return <ExamSkeleton />
  if (phase === 'error' || !paper) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-soft p-8 text-center" role="alert">
        <AlertTriangle className="h-10 w-10 text-danger" aria-hidden />
        <h1 className="font-heading text-xl font-semibold text-ink">We couldn’t load your exam</h1>
        <p className="max-w-sm text-sm text-muted">{loadError}</p>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-cta px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry
        </button>
      </div>
    )
  }

  const { exam } = paper
  const { maxWarnings, autoSubmit, negativeMarking } = exam.settings
  const q = questions[index]
  const selected = q ? answers[q.id] ?? [] : []
  const isLast = index === questions.length - 1
  const quality: LinkQuality = online ? 'GOOD' : 'OFFLINE'

  return (
    <div className="relative flex h-full min-h-[700px] min-w-[1100px] flex-col bg-soft text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/images/logo.png" alt="" className="h-8 w-auto" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <div className="min-w-0">
            <h1 className="truncate font-heading text-sm font-semibold">{exam.title}</h1>
            <p className="text-xs text-muted">{exam.code} · {questions.length} questions · {exam.totalMarks} marks</p>
          </div>
          <span className="ml-2 hidden items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-primary xl:inline-flex"><Lock className="h-3 w-3" aria-hidden /> Kiosk mode</span>
        </div>

        <nav className="flex rounded-xl bg-soft p-1" aria-label="Workspace">
          {([['exam', 'Questions', null], ['browser', 'Sandbox browser', log.length]] as const).map(([id, label, count]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-accent ${view === id ? 'bg-white text-primary shadow-sm' : 'text-muted hover:text-ink'}`}>
              {id === 'browser' && <Globe className="h-3.5 w-3.5" aria-hidden />}
              {label}
              {count !== null && count > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] tabular-nums">{count}</span>}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <SaveIndicator status={save.status} at={save.at} />
          <Timer endsAt={endsAt} paused={paused} onExpire={() => void finalize(true, 'Time is up. Your answers were submitted automatically.')} />
          <button type="button" onClick={() => setHelpOpen((h) => !h)} aria-label="Keyboard shortcuts" aria-pressed={helpOpen} className="rounded-lg p-2 text-muted hover:bg-soft focus-visible:outline-2 focus-visible:outline-accent">
            <Keyboard className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setSubmitOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-cta px-4 py-2.5 text-sm font-semibold text-ink shadow-sm hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <Send className="h-4 w-4" aria-hidden /> Submit
          </button>
        </div>
      </header>

      {paused && (
        // Covers everything under the 64 px header, so the paused timer and Submit stay visible.
        <div role="alert" className="absolute inset-x-0 bottom-0 top-16 z-30 flex flex-col items-center justify-center gap-3 bg-white/90 px-6 text-center backdrop-blur-md">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700"><WifiOff className="h-6 w-6" aria-hidden /></span>
          <h2 className="font-heading text-lg font-semibold">Connection lost. Your exam is paused.</h2>
          <p className="max-w-md text-sm text-muted">The timer is stopped and you will not lose this time. Your answers are kept on this device, and monitoring continues. The exam resumes as soon as you reconnect.</p>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-4 p-4" inert={paused}>
        <section ref={stageRef} className="relative min-h-0 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className={view === 'exam' ? 'h-full' : 'hidden'}>
            {!q ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <h2 className="font-heading text-lg font-semibold">No questions assigned</h2>
                <p className="text-sm text-muted">Contact your invigilator. This exam has no questions yet.</p>
              </div>
            ) : (
              <div className="flex h-full select-none flex-col">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3 text-xs">
                  <span className="rounded-full bg-primary px-3 py-1 font-semibold text-white tabular-nums">Question {index + 1} of {questions.length}</span>
                  <span className="rounded-full bg-soft px-2.5 py-1 font-medium text-muted">{sectionOf(q)}</span>
                  <span className={`rounded-full px-2.5 py-1 font-medium ${DIFFICULTY_CLS[q.difficulty]}`}>{q.difficulty}</span>
                  <span className="text-muted">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}{negativeMarking ? ' · negative marking applies' : ''}</span>
                  <button type="button" onClick={() => toggleFlag(q.id)} aria-pressed={!!flagged[q.id]} className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-accent ${flagged[q.id] ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-border text-muted hover:bg-soft'}`}>
                    <Flag className={`h-3.5 w-3.5 ${flagged[q.id] ? 'fill-amber-400' : ''}`} aria-hidden /> {flagged[q.id] ? 'Marked for review' : 'Mark for review'} <kbd className="rounded bg-soft px-1 text-[10px]">M</kbd>
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
                  <AnimatePresence mode="wait">
                    <motion.div key={q.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
                      <h2 id="question-text" className="whitespace-pre-wrap font-heading text-lg font-medium leading-relaxed">{q.text}</h2>
                      {isNumeric(q) ? (
                        <NumericAnswer key={q.id} id={q.id} value={numeric[q.id] ?? ''} unit={q.unit} onChange={(raw) => type(q.id, raw)} />
                      ) : (
                      <>
                      <p className="mt-2 text-xs text-muted">{q.multi ? 'Select all that apply.' : 'Select one answer.'}</p>
                      <div role={q.multi ? 'group' : 'radiogroup'} aria-labelledby="question-text" className="mt-5 space-y-3">
                        {q.options.map((o, i) => {
                          const on = selected.includes(o.id)
                          return (
                            <button key={o.id} type="button" role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => choose(q.id, o.id, q.multi)} className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? 'border-accent bg-blue-50' : 'border-border hover:border-accent/50 hover:bg-soft'}`}>
                              <span className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 text-xs font-semibold ${q.multi ? 'rounded-md' : 'rounded-full'} ${on ? 'border-accent bg-accent text-white' : 'border-border text-muted'}`}>
                                {on ? <Check className="h-4 w-4" aria-hidden /> : String.fromCharCode(65 + i)}
                              </span>
                              <span className="flex-1">{o.text}</span>
                              <kbd className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-muted" aria-hidden>{i + 1}</kbd>
                            </button>
                          )
                        })}
                      </div>
                      </>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3">
                  <button type="button" onClick={() => go(index - 1)} disabled={index === 0} hidden={oneWay} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-primary hover:bg-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
                    <ArrowLeft className="h-4 w-4" aria-hidden /> Previous
                  </button>
                  <button type="button" onClick={() => clear(q.id)} disabled={isNumeric(q) ? !(numeric[q.id] ?? '') : selected.length === 0} className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
                    <Eraser className="h-4 w-4" aria-hidden /> Clear response
                  </button>
                  {isLast ? (
                    <button type="button" onClick={() => setSubmitOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      Review & submit <Send className="h-4 w-4" aria-hidden />
                    </button>
                  ) : (
                    <button type="button" onClick={() => go(index + 1)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      Save & next <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={view === 'browser' ? 'h-full' : 'hidden'}>
            <BrowserTabs
              allowedSites={exam.settings.allowedSites}
              log={log}
              onLog={handleLog}
              onAiSite={(url) => report('AI_SITE_OPENED', { message: `An AI assistant site was opened in the sandbox browser (${safeHost(url)}).` })}
              onAiQuery={(query) => report('AI_QUERY_DETECTED', { message: `A search resembling an AI prompt was detected: “${query.slice(0, 60)}”.` })}
            />
          </div>

          <WebcamThumb constraintsRef={stageRef} faceStatus={face} quality={quality} onCameraLost={() => report('CAMERA_BLOCKED')} />
        </section>

        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {!oneWay && <QuestionPalette items={items} currentId={q?.id ?? ''} onSelect={(id) => { setView('exam'); go(questions.findIndex((x) => x.id === id)) }} />}

          {!exam.settings.proctorOnly && (
          <section className="rounded-2xl border border-border bg-white p-4 shadow-sm" aria-label="Session integrity">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-sm font-semibold">Session integrity</h2>
              <span className={`text-xs font-medium tabular-nums ${warnings > 0 ? 'text-warning' : 'text-success'}`}>{Math.min(warnings, maxWarnings)}/{maxWarnings} warnings</span>
            </div>
            <div className="mt-2 flex gap-1.5" aria-hidden>
              {Array.from({ length: maxWarnings }, (_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < warnings ? 'bg-warning' : 'bg-soft'}`} />)}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {autoSubmit ? 'A serious violation after your final warning submits the exam automatically.' : 'Violations are reported to your invigilator.'}
            </p>
            <ul className="mt-3 space-y-2" aria-live="polite">
              {events.length === 0 && <li className="rounded-lg bg-soft px-3 py-3 text-center text-xs text-muted">No incidents so far. Keep it up.</li>}
              {events.slice(0, 4).map((ev) => (
                <li key={ev.id} className="flex items-start gap-2 text-xs">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[ev.severity]}`} aria-label={ev.severity} />
                  <span className="min-w-0 flex-1 text-ink">{ev.message}</span>
                  <time className="shrink-0 tabular-nums text-muted" dateTime={ev.at}>{clock(ev.at)}</time>
                </li>
              ))}
            </ul>
          </section>
          )}
        </aside>
      </div>

      <WarningModal
        warning={activeWarning}
        maxWarnings={maxWarnings}
        onAcknowledge={(id) => setActiveWarning((cur) => (cur?.id === id ? null : cur))}
        onAutoSubmit={(message) => void finalize(true, `Violation limit reached: ${message}`)}
      />

      <SubmitDialog
        open={submitOpen || forcedReason !== null}
        forcedReason={forcedReason}
        submitting={submitting}
        error={submitError}
        online={online}
        questions={questions}
        answers={answers}
        numeric={numeric}
        flagged={flagged}
        onJump={jumpTo}
        onCancel={() => setSubmitOpen(false)}
        onConfirm={() => void (forcedReason !== null ? finalize(true, forcedReason) : finalize(false))}
      />

      <AnimatePresence>
        {helpOpen && (
          <motion.aside initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed bottom-4 left-4 z-40 w-72 rounded-2xl border border-border bg-white p-4 shadow-xl" aria-label="Keyboard shortcuts">
            <div className="flex items-center justify-between"><h2 className="font-heading text-sm font-semibold">Keyboard shortcuts</h2><button type="button" onClick={() => setHelpOpen(false)} aria-label="Close shortcuts" className="rounded p-1 text-muted hover:bg-soft"><X className="h-4 w-4" /></button></div>
            <dl className="mt-3 space-y-1.5 text-xs">
              {[['← / → or P / N', 'Previous / next question'], ['1 – 9', 'Select option'], ['M', 'Mark for review'], ['C', 'Clear response'], ['Alt + B', 'Toggle sandbox browser'], ['Ctrl + Enter', 'Review & submit'], ['?', 'Show or hide this panel']].map(([k, d]) => (
                <div key={k} className="flex justify-between gap-3"><dt><kbd className="rounded bg-soft px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd></dt><dd className="text-muted">{d}</dd></div>
              ))}
            </dl>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`rounded-xl px-4 py-2 text-xs font-medium shadow-lg ${t.tone === 'ok' ? 'bg-success text-white' : t.tone === 'warn' ? 'bg-warning text-white' : 'bg-ink text-white'}`}>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/* ───────────────────────── local components ───────────────────────── */

function SaveIndicator({ status, at }: { status: SaveStatus; at: number | null }) {
  const map: Record<SaveStatus, { text: string; cls: string; icon: JSX.Element }> = {
    idle: { text: 'Autosave on', cls: 'text-muted', icon: <CheckCircle2 className="h-4 w-4" aria-hidden /> },
    saving: { text: 'Saving…', cls: 'text-accent', icon: <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> },
    saved: { text: at ? `Saved ${clock(at)}` : 'Saved', cls: 'text-success', icon: <CheckCircle2 className="h-4 w-4" aria-hidden /> },
    error: { text: 'Save failed, retrying…', cls: 'text-danger', icon: <AlertTriangle className="h-4 w-4" aria-hidden /> },
    offline: { text: 'Saved on this device', cls: 'text-warning', icon: <CloudOff className="h-4 w-4" aria-hidden /> },
  }
  const s = map[status]
  return <span role="status" className={`hidden items-center gap-1.5 text-xs font-medium xl:inline-flex ${s.cls}`}>{s.icon}{s.text}</span>
}

function ExamSkeleton() {
  return (
    <div className="flex h-full min-h-[700px] flex-col bg-soft" aria-busy="true" aria-label="Loading exam">
      <div className="h-16 animate-pulse border-b border-border bg-white" />
      <div className="grid flex-1 grid-cols-[1fr_320px] gap-4 p-4">
        <div className="space-y-4 rounded-2xl border border-border bg-white p-8">
          <div className="h-5 w-48 animate-pulse rounded bg-soft" />
          <div className="h-7 w-3/4 animate-pulse rounded bg-soft" />
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-soft" />)}
        </div>
        <div className="space-y-4"><div className="h-72 animate-pulse rounded-2xl bg-white" /><div className="h-40 animate-pulse rounded-2xl bg-white" /></div>
      </div>
    </div>
  )
}

interface SubmitDialogProps {
  open: boolean
  forcedReason: string | null
  submitting: boolean
  error: string | null
  online: boolean
  questions: Question[]
  answers: Record<string, string[]>
  numeric: Record<string, string>
  flagged: Record<string, boolean>
  onJump: (index: number) => void
  onCancel: () => void
  onConfirm: () => void
}

/** Number box for a numeric question; accepts digits, one decimal point and a leading minus sign. */
function NumericAnswer({ id, value, unit, onChange }: { id: string; value: string; unit?: string; onChange: (raw: string) => void }) {
  const invalid = value.trim() !== '' && toNumber(value) === null
  return (
    <div className="mt-5">
      <label htmlFor={`num-${id}`} className="text-xs text-muted">Type your answer as a number{unit ? ` in ${unit}` : ''}.</label>
      <div className="mt-2 flex max-w-sm items-center gap-3">
        <input
          id={`num-${id}`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))}
          aria-invalid={invalid}
          aria-describedby={invalid ? `num-${id}-err` : undefined}
          placeholder="e.g. 3.14"
          className={`w-full rounded-xl border-2 px-4 py-3 font-mono text-lg tabular-nums outline-none transition focus:border-accent ${invalid ? 'border-danger' : 'border-border'}`}
        />
        {unit && <span className="shrink-0 text-sm font-medium text-muted">{unit}</span>}
      </div>
      {invalid && <p id={`num-${id}-err`} className="mt-2 text-xs text-danger">Use digits, an optional minus sign and one decimal point, e.g. -12.5</p>}
    </div>
  )
}

function SubmitDialog({ open, forcedReason, submitting, error, online, questions, answers, numeric, flagged, onJump, onCancel, onConfirm }: SubmitDialogProps) {
  const [ack, setAck] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const forced = forcedReason !== null

  useEffect(() => {
    if (!open) return
    setAck(false)
    window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button, input')?.focus())
  }, [open])

  const unanswered = questions.flatMap((q, i) => (isAnswered(q, answers, numeric) ? [] : [i]))
  const marked = questions.flatMap((q, i) => (flagged[q.id] ? [i] : []))
  const answeredCount = questions.length - unanswered.length

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !forced && !submitting) { e.stopPropagation(); onCancel(); return }
    if (e.key !== 'Tab' || !ref.current) return
    const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
    if (f.length === 0) return
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
  }

  const chips = (list: number[], tone: string) => (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {list.slice(0, 24).map((i) => (
        <button key={i} type="button" onClick={() => onJump(i)} disabled={forced} className={`rounded-md px-2 py-1 text-xs font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-accent ${tone}`}>Q{i + 1}</button>
      ))}
      {list.length > 24 && <span className="px-1 py-1 text-xs text-muted">+{list.length - 24} more</span>}
    </div>
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/50 p-6 backdrop-blur-sm">
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby="submit-title" onKeyDown={onKeyDown} initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="submit-title" className="font-heading text-xl font-semibold text-ink">{forced ? 'Your exam is being submitted' : 'Submit your exam?'}</h2>
            {forced && <p className="mt-1 text-sm text-muted">{forcedReason}</p>}

            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-green-50 p-3"><p className="font-heading text-2xl font-semibold text-success tabular-nums">{answeredCount}</p><p className="text-xs text-muted">Answered</p></div>
              <div className={`rounded-xl p-3 ${unanswered.length ? 'bg-red-50' : 'bg-soft'}`}><p className={`font-heading text-2xl font-semibold tabular-nums ${unanswered.length ? 'text-danger' : 'text-muted'}`}>{unanswered.length}</p><p className="text-xs text-muted">Unanswered</p></div>
              <div className="rounded-xl bg-amber-50 p-3"><p className="font-heading text-2xl font-semibold text-warning tabular-nums">{marked.length}</p><p className="text-xs text-muted">Marked for review</p></div>
            </div>

            {unanswered.length > 0 && <div className="mt-4"><p className="text-xs font-medium text-danger">Unanswered questions{forced ? '' : ' (tap to go back)'}</p>{chips(unanswered, 'bg-red-50 text-danger hover:bg-red-100')}</div>}
            {marked.length > 0 && <div className="mt-3"><p className="text-xs font-medium text-amber-700">Marked for review</p>{chips(marked, 'bg-amber-50 text-amber-800 hover:bg-amber-100')}</div>}

            {submitting && !online && <p role="status" className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800"><WifiOff className="h-4 w-4" aria-hidden /> Waiting for your connection. We will submit as soon as you are back online.</p>}
            {error && <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-danger"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {error}</p>}

            {!forced && (
              <label className="mt-5 flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={submitting} className="mt-0.5 h-4 w-4 accent-primary-600" />
                I understand that I cannot change my answers after submitting.
              </label>
            )}

            <div className="mt-6 flex justify-end gap-3">
              {!forced && <button type="button" onClick={onCancel} disabled={submitting} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted hover:bg-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">Back to exam</button>}
              <button type="button" onClick={onConfirm} disabled={submitting || (!forced && !ack)} className="inline-flex items-center gap-2 rounded-xl bg-cta px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {submitting ? 'Submitting…' : error ? 'Retry submit' : 'Submit exam'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
