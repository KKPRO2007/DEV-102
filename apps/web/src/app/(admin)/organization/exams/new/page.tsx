'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, ArrowRight, CalendarClock, Check, ClipboardCheck, Globe, Loader2, Pencil, Plus, Save, Send, Settings2, ShieldAlert, X, type LucideIcon } from 'lucide-react'
import { z } from 'zod'
import { Field, Segmented, Toggle, btnCta, btnGhost, btnPrimary, cardCls, describedBy, inputCls, inputState } from '@/components/admin/FormControls'
import { PolicyEditor } from '@/components/admin/PolicyEditor'
import { ApiError, isExamCodeTaken } from '@/lib/api'
import { cx, formatDate, formatTime } from '@/lib/adminHooks'
import { toast } from '@/lib/adminStore'
import { createExamFromWizard, type ExamExtras } from '@/lib/api'
import { DEFAULT_POLICY, clonePolicy, describePolicy, policySchema, type ViolationPolicy } from '@/lib/examPolicy'

type StepKey = 'basics' | 'schedule' | 'settings' | 'policy' | 'review'
type Errors = Record<string, string>

const STEPS: { key: StepKey; label: string; hint: string; icon: LucideIcon }[] = [
  { key: 'basics', label: 'Basics', hint: 'Title, code, instructions', icon: ClipboardCheck },
  { key: 'schedule', label: 'Schedule', hint: 'Date, time, duration', icon: CalendarClock },
  { key: 'settings', label: 'Settings', hint: 'Marking and allowed sites', icon: Settings2 },
  { key: 'policy', label: 'Violation policy', hint: 'Warnings and auto-submit', icon: ShieldAlert },
  { key: 'review', label: 'Review', hint: 'Check and publish', icon: Send },
]
const CATEGORIES = ['Engineering entrance', 'Medical entrance', 'Campus placement', 'Banking and SSC', 'University or board', 'Civil services', 'Other']
const SITE_SUGGESTIONS = ['developer.mozilla.org', 'docs.python.org', 'w3schools.com']
const PENALTIES = [{ value: '0.25', label: '¼' }, { value: '0.33', label: '⅓' }, { value: '0.5', label: '½' }, { value: '1', label: '1' }] as const
const DEFAULT_INSTRUCTIONS = 'Read every question carefully. Keep your webcam on and your face visible for the entire exam. Do not switch windows or open other applications. Your screen, webcam and browsing activity are recorded and reviewed.'
const DRAFT_KEY = 'dev102-exam-wizard-draft'
const IST = '+05:30'

interface WizardForm {
  title: string; code: string; category: string; description: string; instructions: string
  questionCount: string; totalMarks: string
  date: string; time: string; durationMin: string; lateEntryMin: string; checkInMin: string
  shuffle: boolean; negativeMarking: boolean; negativeValue: string; allowedSites: string[]; allowCalculator: boolean; audioMonitoring: boolean; proctorOnly: boolean; oneWay: boolean; liveAudio: boolean; releaseResults: ExamExtras['releaseResults']
  policy: ViolationPolicy
}

const EMPTY: WizardForm = {
  title: '', code: '', category: CATEGORIES[0], description: '', instructions: DEFAULT_INSTRUCTIONS, questionCount: '60', totalMarks: '60',
  date: '', time: '10:00', durationMin: '90', lateEntryMin: '10', checkInMin: '30',
  shuffle: true, negativeMarking: true, negativeValue: '0.25', allowedSites: [], allowCalculator: false, audioMonitoring: false, proctorOnly: false, oneWay: false, liveAudio: false, releaseResults: 'AFTER_REVIEW',
  policy: DEFAULT_POLICY,
}

/* ------------------------------- Validation ------------------------------- */

const num = (s: string): number => {
  const n = Number(s.trim())
  return s.trim() === '' || Number.isNaN(n) ? 0 : n
}
const startMs = (f: WizardForm): number => {
  const ms = f.date && f.time ? Date.parse(`${f.date}T${f.time}:00${IST}`) : 0
  return Number.isFinite(ms) ? ms : 0
}
const DOMAIN = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,}$/i

const basicsSchema = z.object({
  title: z.string().trim().min(4, 'Title must be at least 4 characters').max(120, 'Keep the title under 120 characters'),
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,13}$/, 'Use 3 to 14 capital letters, digits or hyphens, for example JEEM-08'),
  category: z.string().min(1, 'Choose a category'),
  description: z.string().max(500, 'Keep the description under 500 characters'),
  instructions: z.string().trim().min(20, 'Write at least 20 characters of candidate instructions').max(2000, 'Keep instructions under 2000 characters'),
  questionCount: z.number().int('Enter a whole number').min(1, 'Enter at least 1 question').max(300, 'An exam can have at most 300 questions'),
  totalMarks: z.number().int('Enter a whole number').min(1, 'Total marks must be at least 1').max(1000, 'Total marks cannot exceed 1000'),
})
const scheduleSchema = z.object({
  startsAtMs: z.number().refine((v) => v > 0, 'Pick a start date and time').refine((v) => v === 0 || v >= Date.now() + 10 * 60_000, 'The exam must start at least 10 minutes from now'),
  durationMin: z.number().int('Enter whole minutes').min(5, 'Duration must be at least 5 minutes').max(360, 'Duration cannot exceed 6 hours'),
  lateEntryMin: z.number().int('Enter whole minutes').min(0, 'Cannot be negative').max(30, 'Late entry is capped at 30 minutes'),
  checkInMin: z.number().int('Enter whole minutes').min(10, 'System check must open at least 10 minutes early').max(60, 'System check can open at most 60 minutes early'),
})
const settingsSchema = z.object({
  allowedSites: z.array(z.string().regex(DOMAIN, 'Enter a valid domain such as docs.python.org')).max(10, 'Add at most 10 allowed sites'),
})

function toErrors(error: z.ZodError): Errors {
  const out: Errors = {}
  for (const i of error.issues) {
    const k = String(i.path[0] ?? 'form')
    if (!(k in out)) out[k] = i.message
  }
  return out
}

function validateStep(step: StepKey, f: WizardForm): Errors {
  switch (step) {
    case 'basics': {
      const r = basicsSchema.safeParse({ title: f.title, code: f.code, category: f.category, description: f.description, instructions: f.instructions, questionCount: num(f.questionCount), totalMarks: num(f.totalMarks) })
      return r.success ? {} : toErrors(r.error)
    }
    case 'schedule': {
      const r = scheduleSchema.safeParse({ startsAtMs: startMs(f), durationMin: num(f.durationMin), lateEntryMin: num(f.lateEntryMin), checkInMin: num(f.checkInMin) })
      const errs = r.success ? {} : toErrors(r.error)
      if (errs.startsAtMs) errs.date = errs.startsAtMs
      return errs
    }
    case 'settings': {
      const r = settingsSchema.safeParse({ allowedSites: f.allowedSites })
      return r.success ? {} : toErrors(r.error)
    }
    case 'policy': {
      const r = policySchema.safeParse(f.policy)
      return r.success ? {} : { policy: r.error.issues[0].message }
    }
    default:
      return {}
  }
}

/* --------------------------------- Drafts --------------------------------- */

interface StoredDraft { form: WizardForm; step: number; maxStep: number; savedAt: string }

function readDraft(): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as StoredDraft
    if (!d || typeof d.form?.title !== 'string') return null
    return { ...d, form: { ...EMPTY, ...d.form, policy: { ...clonePolicy(DEFAULT_POLICY), ...d.form.policy, weights: { ...DEFAULT_POLICY.weights, ...d.form.policy?.weights } } } }
  } catch {
    return null
  }
}

const defaultDate = (): string => new Date(Date.now() + 24 * 3_600_000 + 5.5 * 3_600_000).toISOString().slice(0, 10)

/* -------------------------------- Summary --------------------------------- */

function Summary({ f, title }: { f: WizardForm; title: string }) {
  const start = startMs(f)
  const iso = start > 0 ? new Date(start).toISOString() : null
  const rules = [
    f.shuffle && 'Questions and options shuffled',
    f.negativeMarking ? `Negative marking −${f.negativeValue} per wrong answer` : 'No negative marking',
    f.allowedSites.length ? `${f.allowedSites.length} allowed site${f.allowedSites.length > 1 ? 's' : ''}` : 'Only the exam page is allowed',
    f.allowCalculator && 'On-screen calculator enabled',
  ].filter((r): r is string => Boolean(r))
  return (
    <aside aria-label={title} className={cx(cardCls, 'overflow-hidden')}>
      <div className="bg-gradient-to-br from-primary to-accent p-5 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{title}</p>
        <h3 className="mt-2 font-heading text-lg font-semibold leading-snug">{f.title.trim() || 'Untitled exam'}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/80">
          <code className="rounded bg-white/15 px-1.5 py-0.5 font-mono">{f.code || 'CODE'}</code>{f.category}
        </p>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-border border-b border-border text-center">
        {[['Questions', num(f.questionCount) || '–'], ['Marks', num(f.totalMarks) || '–'], ['Minutes', num(f.durationMin) || '–']].map(([k, v]) => (
          <div key={String(k)} className="px-2 py-3"><dd className="font-heading text-lg font-semibold tabular-nums text-text">{v}</dd><dt className="text-[11px] text-muted">{k}</dt></div>
        ))}
      </dl>
      <div className="space-y-4 p-5 text-sm">
        <p className="flex items-start gap-2 text-slate-700"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />{iso ? `${formatDate(iso)} · ${formatTime(iso)} IST` : 'Date and time not set'}</p>
        <ul className="space-y-1.5 text-xs text-muted">{rules.map((r) => <li key={r} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />{r}</li>)}</ul>
        <ul className="space-y-1.5 border-t border-border pt-4 text-xs text-muted">{describePolicy(f.policy).map((l) => <li key={l} className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600" aria-hidden="true" />{l}</li>)}</ul>
      </div>
    </aside>
  )
}

function ReviewBlock({ title, step, onEdit, children }: { title: string; step: number; onEdit: (s: number) => void; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold text-text">{title}</h3>
        <button type="button" onClick={() => onEdit(step)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent outline-none hover:bg-soft focus-visible:ring-2 focus-visible:ring-accent"><Pencil className="h-3 w-3" aria-hidden="true" /> Edit</button>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  )
}
const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex justify-between gap-3 sm:block"><dt className="text-xs text-muted">{k}</dt><dd className="font-medium text-text">{v}</dd></div>
)

/* ---------------------------------- Page ---------------------------------- */

export default function NewExamPage() {
  const router = useRouter()
  const [form, setForm] = useState<WizardForm>(EMPTY)
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [errors, setErrors] = useState<Errors>({})
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState<'DRAFT' | 'SCHEDULED' | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restore, setRestore] = useState<StoredDraft | null>(null)
  const [ready, setReady] = useState(false)
  const [siteInput, setSiteInput] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const key = STEPS[step].key

  useEffect(() => {
    const d = readDraft()
    if (d && d.form.title.trim()) setRestore(d)
    else setForm((f) => ({ ...f, date: defaultDate() }))
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready || restore || (!form.title && !form.code)) return
    const id = window.setTimeout(() => {
      try {
        const at = new Date().toISOString()
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step, maxStep, savedAt: at }))
        setSavedAt(at)
      } catch {
        // Storage can be full or blocked; autosave is best effort.
      }
    }, 700)
    return () => window.clearTimeout(id)
  }, [form, step, maxStep, ready, restore])

  useEffect(() => {
    if (ready) headingRef.current?.focus()
  }, [step, ready])

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => {
      if (!(k in e)) return e
      const next = { ...e }
      delete next[k]
      return next
    })
  }

  const goTo = (i: number) => { setErrors({}); setStep(i) }

  const next = async () => {
    const errs = validateStep(key, form)
    if (key === 'basics' && Object.keys(errs).length === 0) {
      setChecking(true)
      try {
        if (await isExamCodeTaken(form.code)) errs.code = `The code ${form.code} is already used by another exam.`
      } catch {
        toast.warning('Could not verify the exam code', 'It will be checked again when you save.')
      } finally {
        setChecking(false)
      }
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setStep(step + 1)
    setMaxStep((m) => Math.max(m, step + 1))
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (key !== 'review' && !checking) void next()
  }

  const addSite = (raw: string) => {
    const site = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!site) return
    if (!DOMAIN.test(site)) return setErrors((e) => ({ ...e, allowedSites: 'Enter a valid domain such as docs.python.org' }))
    if (form.allowedSites.includes(site)) return setSiteInput('')
    set('allowedSites', [...form.allowedSites, site])
    setSiteInput('')
  }

  const submit = async (status: 'DRAFT' | 'SCHEDULED') => {
    for (let i = 0; i < 4; i++) {
      const errs = validateStep(STEPS[i].key, form)
      if (Object.keys(errs).length > 0) {
        setErrors(errs)
        setStep(i)
        toast.warning('Fix the highlighted fields first', `Step ${i + 1}, ${STEPS[i].label}, needs attention.`)
        return
      }
    }
    setSubmitting(status)
    try {
      const start = startMs(form)
      const duration = num(form.durationMin)
      const late = num(form.lateEntryMin)
      const exam = await createExamFromWizard({
        status,
        exam: {
          title: form.title.trim(), code: form.code, startsAt: new Date(start).toISOString(), endsAt: new Date(start + (duration + late) * 60_000).toISOString(),
          durationMin: duration, totalMarks: num(form.totalMarks), questionCount: num(form.questionCount),
          settings: { shuffle: form.shuffle, negativeMarking: form.negativeMarking, allowedSites: form.allowedSites, maxWarnings: form.policy.maxWarnings, autoSubmit: form.policy.autoSubmit, audioMonitoring: form.audioMonitoring, proctorOnly: form.proctorOnly, oneWay: form.oneWay, liveAudio: form.liveAudio },
        },
        extras: {
          category: form.category, description: form.description.trim(), instructions: form.instructions.trim(), lateEntryMin: late, checkInMin: num(form.checkInMin),
          negativeValue: form.negativeMarking ? num(form.negativeValue) : 0, allowCalculator: form.allowCalculator, releaseResults: form.releaseResults,
        },
        policy: form.policy,
      })
      try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* nothing to clean up */ }
      toast.success(status === 'DRAFT' ? 'Draft saved' : 'Exam scheduled', status === 'DRAFT' ? 'Add questions next to get it ready.' : `${exam.title} is scheduled.`)
      router.push(status === 'DRAFT' ? `/organization/exams/${exam.id}?tab=questions` : `/organization/exams/${exam.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setStep(0)
        setErrors({ code: e.message })
      }
      toast.error('Could not create the exam', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setSubmitting(null)
    }
  }

  const resume = () => {
    if (!restore) return
    setForm(restore.form)
    setStep(restore.step)
    setMaxStep(restore.maxStep)
    setRestore(null)
  }
  const startFresh = () => {
    try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
    setForm({ ...EMPTY, date: defaultDate() })
    setRestore(null)
  }

  const errorList = useMemo(() => Object.values(errors), [errors])
  const e = errors
  const total = num(form.questionCount)
  const endsPreview = startMs(form) > 0 ? new Date(startMs(form) + (num(form.durationMin) + num(form.lateEntryMin)) * 60_000).toISOString() : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-text sm:text-3xl">Create exam</h1>
          <p className="mt-1 text-sm text-muted">Five short steps. Your progress is saved automatically as you type.</p>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {savedAt ? `Draft saved at ${formatTime(savedAt)}` : 'Draft is saved automatically'}
        </p>
      </div>

      <AnimatePresence>
        {restore && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="region" aria-label="Resume draft" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4">
            <p className="text-sm text-slate-700"><span className="font-semibold text-text">You have an unfinished draft:</span> “{restore.form.title}” saved at {formatTime(restore.savedAt)}.</p>
            <div className="flex gap-2"><button type="button" onClick={startFresh} className={btnGhost}>Start fresh</button><button type="button" onClick={resume} className={btnPrimary}>Resume draft</button></div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav aria-label="Wizard progress">
        <ol className="grid gap-2 sm:grid-cols-5">
          {STEPS.map((s, i) => {
            const done = i < step || (i <= maxStep && i !== step)
            const Icon = s.icon
            return (
              <li key={s.key}>
                <button type="button" disabled={i > maxStep} onClick={() => goTo(i)} aria-current={i === step ? 'step' : undefined}
                  className={cx('flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed', i === step ? 'border-primary bg-primary/5' : 'border-border bg-surface hover:bg-soft disabled:opacity-60 disabled:hover:bg-surface')}>
                  <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold', i === step ? 'bg-primary text-white' : done ? 'bg-success/15 text-success' : 'bg-slate-100 text-muted')}>
                    {done && i !== step ? <Check className="h-4 w-4" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-text">{i + 1}. {s.label}</span><span className="hidden truncate text-[11px] text-muted lg:block">{s.hint}</span></span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_340px]">
        <form noValidate onSubmit={onSubmit} className={cx(cardCls, 'p-6 sm:p-8', key === 'review' && 'xl:col-span-2')}>
          <h2 ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold text-text outline-none">{STEPS[step].label}</h2>
          <p className="mb-6 mt-1 text-sm text-muted">{STEPS[step].hint}</p>

          {errorList.length > 0 && (
            <div role="alert" className="mb-6 flex gap-3 rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div><p className="font-semibold">Fix {errorList.length} issue{errorList.length > 1 ? 's' : ''} to continue</p><ul className="mt-1 list-disc pl-4 text-xs">{errorList.map((m) => <li key={m}>{m}</li>)}</ul></div>
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={key} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.16 }} className="space-y-5">
              {key === 'basics' && (
                <>
                  <Field id="w-title" label="Exam title" required error={e.title} hint="Candidates see this on their dashboard and certificate.">
                    <input id="w-title" value={form.title} onChange={(ev) => set('title', ev.target.value)} aria-invalid={Boolean(e.title)} aria-describedby={describedBy('w-title', e.title, 'x')} placeholder="JEE Main Full Syllabus Mock 8" className={cx(inputCls, inputState(e.title))} />
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field id="w-code" label="Exam code" required error={e.code} hint="Unique. Capital letters, digits and hyphens.">
                      <input id="w-code" value={form.code} onChange={(ev) => set('code', ev.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} maxLength={14} aria-invalid={Boolean(e.code)} aria-describedby={describedBy('w-code', e.code, 'x')} placeholder="JEEM-08" className={cx(inputCls, inputState(e.code), 'font-mono uppercase')} />
                    </Field>
                    <Field id="w-cat" label="Category" required error={e.category}>
                      <select id="w-cat" value={form.category} onChange={(ev) => set('category', ev.target.value)} className={cx(inputCls, inputState(e.category))}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                    </Field>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field id="w-qc" label="Number of questions" required error={e.questionCount} hint="You add the questions after creating the exam.">
                      <input id="w-qc" inputMode="numeric" value={form.questionCount} onChange={(ev) => set('questionCount', ev.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(e.questionCount)} aria-describedby={describedBy('w-qc', e.questionCount, 'x')} className={cx(inputCls, inputState(e.questionCount))} />
                    </Field>
                    <Field id="w-marks" label="Total marks" required error={e.totalMarks} hint={total > 0 ? `${total} questions × 1 mark = ${total} marks` : undefined}>
                      <input id="w-marks" inputMode="numeric" value={form.totalMarks} onChange={(ev) => set('totalMarks', ev.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(e.totalMarks)} aria-describedby={describedBy('w-marks', e.totalMarks, total > 0 ? 'x' : undefined)} className={cx(inputCls, inputState(e.totalMarks))} />
                    </Field>
                  </div>
                  <Field id="w-desc" label="Description" error={e.description} hint="Optional. Shown to proctors and in reports.">
                    <textarea id="w-desc" rows={2} value={form.description} onChange={(ev) => set('description', ev.target.value)} className={cx(inputCls, inputState(e.description), 'h-auto py-2.5')} />
                  </Field>
                  <Field id="w-ins" label="Instructions for candidates" required error={e.instructions} hint={`${form.instructions.length} / 2000 characters`}>
                    <textarea id="w-ins" rows={5} value={form.instructions} onChange={(ev) => set('instructions', ev.target.value)} aria-invalid={Boolean(e.instructions)} aria-describedby={describedBy('w-ins', e.instructions, 'x')} className={cx(inputCls, inputState(e.instructions), 'h-auto py-2.5')} />
                  </Field>
                </>
              )}

              {key === 'schedule' && (
                <>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field id="w-date" label="Start date" required error={e.date}>
                      <input id="w-date" type="date" value={form.date} onChange={(ev) => set('date', ev.target.value)} aria-invalid={Boolean(e.date)} aria-describedby={describedBy('w-date', e.date)} className={cx(inputCls, inputState(e.date))} />
                    </Field>
                    <Field id="w-time" label="Start time (IST)" required error={e.startsAtMs}>
                      <input id="w-time" type="time" value={form.time} onChange={(ev) => set('time', ev.target.value)} className={cx(inputCls, inputState(e.startsAtMs))} />
                    </Field>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-3">
                    <Field id="w-dur" label="Duration (minutes)" required error={e.durationMin}>
                      <input id="w-dur" inputMode="numeric" value={form.durationMin} onChange={(ev) => set('durationMin', ev.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(e.durationMin)} aria-describedby={describedBy('w-dur', e.durationMin)} className={cx(inputCls, inputState(e.durationMin))} />
                    </Field>
                    <Field id="w-late" label="Late entry (minutes)" error={e.lateEntryMin} hint="Candidates can still join after the start.">
                      <input id="w-late" inputMode="numeric" value={form.lateEntryMin} onChange={(ev) => set('lateEntryMin', ev.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(e.lateEntryMin)} aria-describedby={describedBy('w-late', e.lateEntryMin, 'x')} className={cx(inputCls, inputState(e.lateEntryMin))} />
                    </Field>
                    <Field id="w-chk" label="System check opens (min before)" error={e.checkInMin} hint="Camera, network and app checks.">
                      <input id="w-chk" inputMode="numeric" value={form.checkInMin} onChange={(ev) => set('checkInMin', ev.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(e.checkInMin)} aria-describedby={describedBy('w-chk', e.checkInMin, 'x')} className={cx(inputCls, inputState(e.checkInMin))} />
                    </Field>
                  </div>
                  {endsPreview && (
                    <p className="flex items-center gap-2 rounded-xl bg-soft px-4 py-3 text-sm text-slate-700"><CalendarClock className="h-4 w-4 text-accent" aria-hidden="true" />The exam window closes at <strong className="text-text">{formatTime(endsPreview)}</strong> on {formatDate(endsPreview)}.</p>
                  )}
                </>
              )}

              {key === 'settings' && (
                <>
                  <div className="space-y-5 rounded-xl border border-border p-5">
                    <Toggle checked={form.shuffle} onChange={(v) => set('shuffle', v)} label="Shuffle questions and options" description="Every candidate gets a different order to discourage copying." />
                    <Toggle checked={form.negativeMarking} onChange={(v) => set('negativeMarking', v)} label="Negative marking" description="Deduct a fraction of the question's marks for each wrong answer." />
                    {form.negativeMarking && (
                      <div className="pl-1"><p className="mb-1.5 text-sm font-medium text-slate-700">Penalty per wrong answer (fraction of marks)</p>
                        <Segmented label="Penalty" value={form.negativeValue} onChange={(v) => set('negativeValue', v)} options={PENALTIES} /></div>
                    )}
                    <Toggle checked={form.allowCalculator} onChange={(v) => set('allowCalculator', v)} label="On-screen calculator" description="A basic calculator inside the secure exam window." />
                    <Toggle checked={form.audioMonitoring} onChange={(v) => set('audioMonitoring', v)} label="Audio monitoring" description="Flags talking and a muted microphone. Sound is analysed on the candidate's computer and never recorded or sent." />
                    <Toggle checked={form.proctorOnly} onChange={(v) => set('proctorOnly', v)} label="Proctor-only alerts" description="Violations only flag to proctors: the candidate sees no warnings and the exam is never ended automatically." />
                    <Toggle checked={form.oneWay} onChange={(v) => set('oneWay', v)} label="One-way questions" description="Questions are answered in order; a candidate cannot go back after Next." />
                    <Toggle checked={form.liveAudio} onChange={(v) => set('liveAudio', v)} label="Live microphone to proctors" description="Proctors watching the screen can also listen live. Nothing is recorded; candidates are told on the consent screen." />
                  </div>
                  <div className="rounded-xl border border-border p-5">
                    <p className="flex items-center gap-2 text-sm font-semibold text-text"><Globe className="h-4 w-4 text-accent" aria-hidden="true" /> Allowed websites in the sandbox browser</p>
                    <p className="mt-1 text-xs text-muted">Every URL and search query is logged. AI sites are always flagged, even if listed here.</p>
                    <div className="mt-3 flex gap-2">
                      <input value={siteInput} onChange={(ev) => setSiteInput(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addSite(siteInput) } }} aria-label="Add an allowed website" aria-invalid={Boolean(e.allowedSites)} placeholder="docs.python.org" className={cx(inputCls, inputState(e.allowedSites))} />
                      <button type="button" onClick={() => addSite(siteInput)} className={btnGhost}><Plus className="h-4 w-4" aria-hidden="true" /> Add</button>
                    </div>
                    {e.allowedSites && <p role="alert" className="mt-1.5 text-xs font-medium text-danger">{e.allowedSites}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {form.allowedSites.length === 0 && <span className="text-xs text-muted">No extra sites. Candidates can only use the exam page.</span>}
                      {form.allowedSites.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{s}<button type="button" aria-label={`Remove ${s}`} onClick={() => set('allowedSites', form.allowedSites.filter((x) => x !== s))} className="rounded-full outline-none hover:text-danger focus-visible:ring-2 focus-visible:ring-accent"><X className="h-3 w-3" aria-hidden="true" /></button></span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">{SITE_SUGGESTIONS.filter((s) => !form.allowedSites.includes(s)).map((s) => <button key={s} type="button" onClick={() => addSite(s)} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-slate-600 outline-none hover:bg-soft focus-visible:ring-2 focus-visible:ring-accent">+ {s}</button>)}</div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-slate-700">Release results</p>
                    <Segmented label="Release results" value={form.releaseResults} onChange={(v) => set('releaseResults', v)} options={[{ value: 'IMMEDIATE', label: 'Immediately' }, { value: 'AFTER_REVIEW', label: 'After violation review' }, { value: 'MANUAL', label: 'Manually' }]} />
                    <p className="mt-1.5 text-xs text-muted">Released results show candidates every question and its correct answer, once the exam window has closed.</p>
                  </div>
                </>
              )}

              {key === 'policy' && (
                <>
                  {e.policy && <p role="alert" className="text-sm font-medium text-danger">{e.policy}</p>}
                  <PolicyEditor value={form.policy} onChange={(p) => set('policy', p)} />
                </>
              )}

              {key === 'review' && (
                <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                  <div className="space-y-4">
                    <ReviewBlock title="Basics" step={0} onEdit={goTo}>
                      <Row k="Title" v={form.title} /><Row k="Code" v={<code className="font-mono">{form.code}</code>} />
                      <Row k="Category" v={form.category} /><Row k="Questions · marks" v={`${form.questionCount} · ${form.totalMarks}`} />
                    </ReviewBlock>
                    <ReviewBlock title="Schedule" step={1} onEdit={goTo}>
                      <Row k="Starts" v={startMs(form) > 0 ? `${formatDate(new Date(startMs(form)).toISOString())}, ${formatTime(new Date(startMs(form)).toISOString())}` : '–'} />
                      <Row k="Duration" v={`${form.durationMin} min`} /><Row k="Late entry" v={`${form.lateEntryMin} min`} /><Row k="System check opens" v={`${form.checkInMin} min before`} />
                    </ReviewBlock>
                    <ReviewBlock title="Settings" step={2} onEdit={goTo}>
                      <Row k="Shuffle" v={form.shuffle ? 'On' : 'Off'} /><Row k="Negative marking" v={form.negativeMarking ? `−${form.negativeValue}` : 'Off'} />
                      <Row k="Allowed sites" v={form.allowedSites.length ? form.allowedSites.join(', ') : 'None'} /><Row k="Audio monitoring" v={form.audioMonitoring ? 'On' : 'Off'} /><Row k="Results" v={{ IMMEDIATE: 'Immediately', AFTER_REVIEW: 'After violation review', MANUAL: 'Manually' }[form.releaseResults]} />
                    </ReviewBlock>
                    <ReviewBlock title="Violation policy" step={3} onEdit={goTo}>
                      <div className="sm:col-span-2"><ul className="space-y-1 text-xs text-slate-600">{describePolicy(form.policy).map((l) => <li key={l}>• {l}</li>)}</ul></div>
                    </ReviewBlock>
                    <p className="rounded-xl bg-soft px-4 py-3 text-xs text-muted">Next: add {form.questionCount} questions, import candidates and email their credentials. The exam overview has a checklist for all of it.</p>
                  </div>
                  <Summary f={form} title="Candidate view" />
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <div className="flex gap-3">
              <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0} className={btnGhost}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back</button>
              <Link href="/organization/exams" className="inline-flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent">Cancel</Link>
            </div>
            {key === 'review' ? (
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={submitting !== null} onClick={() => void submit('DRAFT')} className={btnGhost}>{submitting === 'DRAFT' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />} Save as draft</button>
                <button type="button" disabled={submitting !== null} onClick={() => void submit('SCHEDULED')} className={btnCta}>{submitting === 'SCHEDULED' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} Schedule exam</button>
              </div>
            ) : (
              <button type="submit" disabled={checking} className={btnPrimary}>{checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
            )}
          </div>
        </form>

        {key !== 'review' && <div className="hidden xl:sticky xl:top-24 xl:block"><Summary f={form} title="Live summary" /></div>}
      </div>
    </div>
  )
}
