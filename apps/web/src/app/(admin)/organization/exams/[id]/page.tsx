'use client'

import { Suspense, useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Clock, FileQuestion, Loader2, Mail, Plus, Radio, Rocket, Save, Send, ShieldAlert, Users, XCircle, type LucideIcon } from 'lucide-react'
import { ConfirmDialog } from '@/components/admin/Dialogs'
import { ExamStatusBadge } from '@/components/admin/ExamStatusBadge'
import { Toggle, btnGhost, btnPrimary, cardCls } from '@/components/admin/FormControls'
import { PolicyEditor } from '@/components/admin/PolicyEditor'
import { EmptyState, ErrorState, Skeleton } from '@/components/admin/States'
import { updateExam } from '@/lib/api'
import { cx, formatCountdown, formatDate, formatTime, useAsyncData, useNow } from '@/lib/adminHooks'
import { toast } from '@/lib/adminStore'
import {
  SEVERITY_COLOR, getCandidateSummary, getExamDetail, getExamViolationSummary, listQuestions, releaseExamResults, savePolicy, updateExamSettings,
  type ExamDetail, type ExamExtras,
} from '@/lib/api'
import { describePolicy, policySchema, type ViolationPolicy } from '@/lib/examPolicy'
import type { Exam, Question } from '@/lib/types'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'questions', label: 'Questions' },
  { key: 'candidates', label: 'Candidates' },
  { key: 'settings', label: 'Settings' },
  { key: 'reports', label: 'Reports' },
] as const
type TabKey = (typeof TABS)[number]['key']
const parseTab = (v: string | null): TabKey => TABS.find((t) => t.key === v)?.key ?? 'overview'

type Loaded = ExamDetail & { questions: Question[] }

/* -------------------------------- Checklist -------------------------------- */

interface Check { key: string; label: string; detail: string; status: 'pass' | 'warn' | 'fail'; href?: string; cta?: string }

function buildChecklist(d: Loaded, now: number, id: string): Check[] {
  const { exam, extras, questions, policy } = d
  const marks = questions.reduce((s, q) => s + q.marks, 0)
  const n = questions.length
  return [
    { key: 'basics', label: 'Basics and instructions', status: extras.instructions.trim().length >= 20 ? 'pass' : 'warn', detail: extras.instructions.trim().length >= 20 ? 'Title, code and candidate instructions are set.' : 'Candidate instructions are too short.' },
    { key: 'questions', label: 'Questions added', status: n === 0 ? 'fail' : n < exam.questionCount ? 'warn' : 'pass', detail: n === 0 ? 'No questions yet. Add or import them.' : `${n} of ${exam.questionCount} planned questions are ready.`, href: `/organization/exams/${id}/questions`, cta: n === 0 ? 'Add questions' : 'Manage' },
    { key: 'marks', label: 'Marks add up', status: n === 0 ? 'warn' : marks === exam.totalMarks ? 'pass' : 'warn', detail: n === 0 ? 'Add questions to verify the total.' : marks === exam.totalMarks ? `Questions total ${marks} marks.` : `Questions total ${marks} marks, but the exam is set to ${exam.totalMarks}.` },
    { key: 'candidates', label: 'Candidates imported', status: exam.candidateCount > 0 ? 'pass' : 'warn', detail: exam.candidateCount > 0 ? `${exam.candidateCount.toLocaleString('en-IN')} candidates assigned.` : 'None yet. You can import them before the exam starts.', href: `/organization/candidates?exam=${id}&import=1`, cta: 'Import' },
    // Only an exam that hasn't started needs a future start time; a live or finished exam has passed it by design.
    exam.status === 'LIVE' || exam.status === 'COMPLETED'
      ? { key: 'schedule', label: 'Schedule', status: 'pass', detail: `${exam.status === 'LIVE' ? 'Started' : 'Ran on'} ${formatDate(exam.startsAt)} at ${formatTime(exam.startsAt)}.` }
      : { key: 'schedule', label: 'Start time is in the future', status: Date.parse(exam.startsAt) > now + 10 * 60_000 ? 'pass' : 'fail', detail: Date.parse(exam.startsAt) > now + 10 * 60_000 ? `Starts ${formatDate(exam.startsAt)} at ${formatTime(exam.startsAt)}.` : 'The start time has passed. Update the schedule in Settings.', href: `/organization/exams/${id}?tab=settings`, cta: 'Settings' },
    { key: 'policy', label: 'Violation policy valid', status: policySchema.safeParse(policy).success ? 'pass' : 'fail', detail: policySchema.safeParse(policy).success ? `${policy.maxWarnings} warning${policy.maxWarnings === 1 ? '' : 's'}, auto-submit ${policy.autoSubmit ? 'on' : 'off'}.` : 'The policy has invalid values.', href: `/organization/exams/${id}?tab=settings`, cta: 'Fix' },
  ]
}

const CHECK_ICON: Record<Check['status'], { icon: LucideIcon; cls: string }> = {
  pass: { icon: CheckCircle2, cls: 'text-success' },
  warn: { icon: AlertTriangle, cls: 'text-warning' },
  fail: { icon: XCircle, cls: 'text-danger' },
}

const Tile = ({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) => (
  <div className={cx(cardCls, 'flex items-center gap-4 p-4')}>
    <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-primary-600"><Icon className="h-5 w-5" aria-hidden="true" /></span>
    <div><p className="text-xs text-muted">{label}</p><p className="font-heading text-xl font-semibold tabular-nums text-text">{value}</p></div>
  </div>
)

const RELEASE_LABEL: Record<ExamExtras['releaseResults'], string> = {
  IMMEDIATE: 'Immediately: each candidate sees their score as soon as they submit.',
  AFTER_REVIEW: 'After violation review: a candidate sees their score once every flagged event in their session is reviewed.',
  MANUAL: 'Manually: candidates see their scores when you release them below.',
}

/** How results reach candidates, with the release button for exams set to release manually. */
function ResultsCard({ examId, extras }: { examId: string; extras: ExamExtras }) {
  const [releasedAt, setReleasedAt] = useState(extras.resultsReleasedAt ?? null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const release = async () => {
    setBusy(true)
    try {
      const r = await releaseExamResults(examId)
      setReleasedAt(r.releasedAt)
      toast.success('Results released', r.notified ? `${r.notified} candidates are being emailed.` : 'Candidates can see their scores in the lobby.')
    } catch (e) {
      toast.error('Could not release results', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  return (
    <section className={cx(cardCls, 'p-6')}>
      <h2 className="font-heading text-base font-semibold text-text">Results</h2>
      <p className="mt-2 text-sm text-slate-700">{RELEASE_LABEL[extras.releaseResults]}</p>
      <p className="mt-2 text-xs text-muted">Released results show candidates every question and its correct answer, once the exam window has closed. Disqualified attempts are never shown.</p>
      {extras.releaseResults === 'MANUAL' && (
        <div className="mt-4">
          {releasedAt ? (
            <p className="inline-flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Released {formatDate(releasedAt)}, {formatTime(releasedAt)}</p>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className={btnPrimary}><Send className="h-4 w-4" aria-hidden="true" /> Release results</button>
          )}
        </div>
      )}
      <ConfirmDialog open={confirm} title="Release results to candidates?" confirmLabel="Release" tone="primary" busy={busy} onConfirm={() => void release()} onCancel={() => setConfirm(false)}>
        <p>Every candidate who submitted sees their score and gets an email. This cannot be undone.</p>
        <p>The answer review, with every question and correct answer, opens once the exam window has closed.</p>
      </ConfirmDialog>
    </section>
  )
}

/* ----------------------------------- Tabs ---------------------------------- */

function OverviewTab({ d, id, onPublish, publishing }: { d: Loaded; id: string; onPublish: () => void; publishing: boolean }) {
  const now = useNow(30_000)
  const checks = useMemo(() => buildChecklist(d, now, id), [d, now, id])
  const passed = checks.filter((c) => c.status === 'pass').length
  const blocked = checks.some((c) => c.status === 'fail')
  const { exam, extras, policy } = d
  const canPublish = exam.status === 'DRAFT'
  const reduce = useReducedMotion()

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([[Clock, 'Duration', `${exam.durationMin} min`], [FileQuestion, 'Questions', `${d.questions.length}/${exam.questionCount}`], [CheckCircle2, 'Total marks', exam.totalMarks], [Users, 'Candidates', exam.candidateCount.toLocaleString('en-IN')]] as const).map(([icon, label, value], i) => (
            <motion.div key={label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : i * 0.06, ease: 'easeOut' }}>
              <Tile icon={icon} label={label} value={value} />
            </motion.div>
          ))}
        </div>
        <section className={cx(cardCls, 'p-6')}>
          <h2 className="font-heading text-base font-semibold text-text">Schedule</h2>
          <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted">Starts</dt><dd className="font-medium text-text">{formatDate(exam.startsAt)}, {formatTime(exam.startsAt)}</dd></div>
            <div><dt className="text-xs text-muted">Window closes</dt><dd className="font-medium text-text">{formatTime(exam.endsAt)} · late entry {extras.lateEntryMin} min</dd></div>
            <div><dt className="text-xs text-muted">{exam.status === 'SCHEDULED' || exam.status === 'DRAFT' ? 'Countdown' : 'System check opened'}</dt><dd className="font-medium text-accent">{exam.status === 'SCHEDULED' || exam.status === 'DRAFT' ? formatCountdown(exam.startsAt, now) : `${extras.checkInMin} min before start`}</dd></div>
          </dl>
        </section>
        <section className={cx(cardCls, 'p-6')}>
          <h2 className="font-heading text-base font-semibold text-text">Candidate instructions</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{extras.instructions}</p>
          <p className="mt-3 text-xs text-muted">{extras.category}{extras.description ? ` · ${extras.description}` : ''}</p>
        </section>
        <ResultsCard examId={id} extras={extras} />
        <section className={cx(cardCls, 'p-6')}>
          <h2 className="font-heading text-base font-semibold text-text">Violation policy</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700">{describePolicy(policy).map((l) => <li key={l} className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />{l}</li>)}</ul>
        </section>
      </div>

      <aside className={cx(cardCls, 'h-fit p-6')} aria-label="Publish checklist">
        <h2 className="font-heading text-base font-semibold text-text">{canPublish ? 'Publish checklist' : 'Readiness'}</h2>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={passed} aria-label="Checklist progress"><motion.div className="h-full rounded-full bg-success" initial={{ width: 0 }} animate={{ width: `${(passed / checks.length) * 100}%` }} transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }} /></div>
          <span className="text-xs font-semibold tabular-nums text-muted">{passed}/{checks.length}</span>
        </div>
        <ul className="mt-4 space-y-3">
          {checks.map((c) => {
            const { icon: Icon, cls } = CHECK_ICON[c.status]
            return (
              <li key={c.key} className="flex items-start gap-3">
                <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', cls)} aria-label={c.status === 'pass' ? 'Done' : c.status === 'warn' ? 'Needs attention' : 'Blocking'} />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text">{c.label}</p><p className="text-xs text-muted">{c.detail}</p>{c.href && c.status !== 'pass' && <Link href={c.href} className="mt-1 inline-block rounded text-xs font-semibold text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent">{c.cta}</Link>}</div>
              </li>
            )
          })}
        </ul>
        {canPublish ? (
          <>
            <button type="button" onClick={onPublish} disabled={blocked || publishing} className={cx(btnPrimary, 'mt-6 w-full')}>{publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Rocket className="h-4 w-4" aria-hidden="true" />} Publish and schedule</button>
            {blocked && <p className="mt-2 text-xs text-danger">Resolve the blocking items to publish.</p>}
          </>
        ) : (
          <p className="mt-5 rounded-xl bg-soft px-3 py-2 text-xs text-muted">{exam.status === 'LIVE' ? 'This exam is live. Proctors can monitor it now.' : exam.status === 'SCHEDULED' ? 'Published. Candidates receive credentials by email.' : 'This exam has ended.'}</p>
        )}
      </aside>
    </div>
  )
}

function QuestionsTab({ d, id }: { d: Loaded; id: string }) {
  const byDiff = { EASY: 0, MEDIUM: 0, HARD: 0 }
  d.questions.forEach((q) => byDiff[q.difficulty]++)
  const marks = d.questions.reduce((s, q) => s + q.marks, 0)
  return (
    <section className={cx(cardCls, 'p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-heading text-base font-semibold text-text">{d.questions.length} questions · {marks} marks</h2><p className="text-xs text-muted">Easy {byDiff.EASY} · Medium {byDiff.MEDIUM} · Hard {byDiff.HARD}</p></div>
        <div className="flex gap-2"><Link href={`/organization/exams/${id}/questions?import=1`} className={btnGhost}>Import</Link><Link href={`/organization/exams/${id}/questions`} className={btnPrimary}>Open question manager</Link></div>
      </div>
      {d.questions.length === 0 ? (
        <EmptyState icon={FileQuestion} title="No questions yet" message="Add questions one by one or import a spreadsheet." action={<Link href={`/organization/exams/${id}/questions`} className={btnPrimary}><Plus className="h-4 w-4" aria-hidden="true" /> Add questions</Link>} />
      ) : (
        <ol className="mt-4 divide-y divide-border">
          {d.questions.slice(0, 6).map((q, i) => (
            <li key={q.id} className="flex items-start gap-3 py-3 text-sm"><span className="w-6 shrink-0 tabular-nums text-muted">{i + 1}.</span><span className="line-clamp-2 flex-1 text-slate-700">{q.text.replace(/[*`#]/g, '')}</span><span className="shrink-0 text-xs font-semibold text-muted">{q.marks} m</span></li>
          ))}
        </ol>
      )}
    </section>
  )
}

function CandidatesTab({ id, exam }: { id: string; exam: Exam }) {
  const loader = useCallback(() => getCandidateSummary(id), [id])
  const { data, error, loading, reload } = useAsyncData(loader)
  if (error && !loading) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <div className="grid gap-4 sm:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  if (data.total === 0) {
    return <section className={cardCls}><EmptyState icon={Users} title="No candidates yet" message="Import a spreadsheet of candidates, then generate and email their credentials." action={<Link href={`/organization/candidates?exam=${id}&import=1`} className={btnPrimary}>Import candidates</Link>} /></section>
  }
  const rows: [string, number, string][] = [
    ['Credentials pending', data.pending, 'bg-slate-400'], ['Emailed', data.emailed, 'bg-accent'], ['Email failed', data.failed, 'bg-danger'],
    ['In exam', data.inExam, 'bg-success'], ['Submitted', data.submitted, 'bg-primary'], ['Disqualified', data.disqualified, 'bg-warning'],
  ]
  return (
    <section className={cx(cardCls, 'p-6')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-base font-semibold text-text">{data.total.toLocaleString('en-IN')} candidates assigned to {exam.code}</h2>
        <div className="flex gap-2"><Link href={`/organization/candidates?exam=${id}`} className={btnGhost}><Users className="h-4 w-4" aria-hidden="true" /> Manage</Link><Link href={`/organization/credentials?exam=${id}`} className={btnPrimary}><Mail className="h-4 w-4" aria-hidden="true" /> Credentials</Link></div>
      </div>
      <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Candidate status distribution">{rows.map(([k, v, c]) => <div key={k} className={c} style={{ width: `${(v / data.total) * 100}%` }} />)}</div>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.filter(([, v]) => v > 0).map(([k, v, c]) => <li key={k} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm"><span className={cx('h-2.5 w-2.5 rounded-full', c)} aria-hidden="true" /><span className="flex-1 text-slate-600">{k}</span><span className="font-semibold tabular-nums text-text">{v.toLocaleString('en-IN')}</span></li>)}</ul>
    </section>
  )
}

function SettingsTab({ d, onSaved }: { d: Loaded; onSaved: (exam: Exam, policy: ViolationPolicy) => void }) {
  const { exam, policy: savedPolicy } = d
  const readOnly = exam.status === 'LIVE' || exam.status === 'COMPLETED'
  const [settings, setSettings] = useState(exam.settings)
  const [policy, setPolicy] = useState(savedPolicy)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify([settings, policy]) !== JSON.stringify([exam.settings, savedPolicy])
  const policyOk = policySchema.safeParse(policy).success

  const save = async () => {
    setSaving(true)
    try {
      const next = { ...settings, maxWarnings: policy.maxWarnings, autoSubmit: policy.autoSubmit }
      const [updated] = await Promise.all([updateExamSettings(exam.id, next), savePolicy(exam.id, policy)])
      onSaved(updated, policy)
      toast.success('Settings saved', 'Changes apply to everyone who starts the exam from now on.')
    } catch (e) {
      toast.error('Could not save settings', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {readOnly && <p role="status" className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-amber-800">{exam.status === 'LIVE' ? 'This exam is live, so settings are locked.' : 'This exam has ended, so settings are read-only.'}</p>}
      <section className={cx(cardCls, 'space-y-5 p-6')}>
        <h2 className="font-heading text-base font-semibold text-text">Exam rules</h2>
        <Toggle checked={settings.shuffle} onChange={(v) => setSettings({ ...settings, shuffle: v })} label="Shuffle questions and options" disabled={readOnly} />
        <Toggle checked={settings.negativeMarking} onChange={(v) => setSettings({ ...settings, negativeMarking: v })} label="Negative marking" disabled={readOnly} />
        <Toggle checked={settings.audioMonitoring} onChange={(v) => setSettings({ ...settings, audioMonitoring: v })} label="Audio monitoring" description="Flags talking and a muted microphone. Sound is analysed on the candidate's computer and never recorded or sent." disabled={readOnly} />
        <Toggle checked={Boolean(settings.proctorOnly)} onChange={(v) => setSettings({ ...settings, proctorOnly: v })} label="Proctor-only alerts" description="On by default. The candidate can use anything and sees no warnings; every flag, picture and AI chat goes to the proctor, who can deduct marks. Off: warnings and auto-submit apply." disabled={readOnly} />
        <Toggle checked={Boolean(settings.oneWay)} onChange={(v) => setSettings({ ...settings, oneWay: v })} label="One-way questions" description="Questions are answered in order; a candidate cannot go back after Next." disabled={readOnly} />
        <Toggle checked={Boolean(settings.liveAudio)} onChange={(v) => setSettings({ ...settings, liveAudio: v })} label="Live microphone to proctors" description="Proctors watching the screen can also listen live. Nothing is recorded; candidates are told on the consent screen." disabled={readOnly} />
      </section>
      <PolicyEditor value={policy} onChange={setPolicy} readOnly={readOnly} />
      {!readOnly && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface/95 p-4 shadow-lg backdrop-blur">
          <p className="text-sm text-muted" aria-live="polite">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setSettings(exam.settings); setPolicy(savedPolicy) }} disabled={!dirty || saving} className={btnGhost}>Discard</button>
            <button type="button" onClick={() => void save()} disabled={!dirty || !policyOk || saving} className={btnPrimary}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />} Save changes</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ReportsTab({ id, exam }: { id: string; exam: Exam }) {
  const loader = useCallback(() => getExamViolationSummary(id), [id])
  const { data, error, loading, reload } = useAsyncData(loader)
  if (error && !loading) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <Skeleton className="h-72 rounded-2xl" />
  if (data.total === 0) return <section className={cardCls}><EmptyState icon={ShieldAlert} title="No violations recorded" message={exam.status === 'LIVE' || exam.status === 'COMPLETED' ? 'Great news: nothing has been flagged.' : 'Violation reports appear here once the exam starts.'} /></section>
  const max = Math.max(...data.byType.map((t) => t.count), 1)
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile icon={ShieldAlert} label="Violations recorded" value={data.total.toLocaleString('en-IN')} />
        <Tile icon={AlertTriangle} label="Sessions flagged for review" value={data.flaggedSessions} />
        <Tile icon={Radio} label="Auto-submitted sessions" value={data.autoSubmitted} />
      </div>
      <section className={cx(cardCls, 'p-6')}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-base font-semibold text-text">Violations by type</h2><Link href={`/organization/reports?exam=${id}`} className={btnPrimary}>Review sessions</Link></div>
        <ul className="mt-4 space-y-3">
          {data.byType.filter((t) => t.count > 0).map((t) => (
            <li key={t.code} className="grid grid-cols-[minmax(0,12rem)_1fr_3rem] items-center gap-3 text-sm">
              <span className="truncate text-slate-700">{t.label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${(t.count / max) * 100}%`, background: SEVERITY_COLOR[t.severity] }} /></span>
              <span className="text-right font-semibold tabular-nums text-text">{t.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ----------------------------------- Page ---------------------------------- */

function ExamOverview() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const tab = parseTab(useSearchParams().get('tab'))
  const loader = useCallback(async (): Promise<Loaded> => {
    const [detail, questions] = await Promise.all([getExamDetail(id), listQuestions(id)])
    return { ...detail, questions }
  }, [id])
  const { data, setData, error, loading, reload } = useAsyncData(loader)
  const [confirm, setConfirm] = useState(false)
  const reduce = useReducedMotion()
  const [publishing, setPublishing] = useState(false)

  const setTab = (t: TabKey) => router.replace(`/organization/exams/${id}?tab=${t}`, { scroll: false })
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -i : e.key === 'End' ? TABS.length : 0
    if (!move) return
    e.preventDefault()
    const next = TABS[Math.min(TABS.length - 1, Math.max(0, i + move))]
    setTab(next.key)
    document.getElementById(`tab-${next.key}`)?.focus()
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const exam = await updateExam(id, { status: 'SCHEDULED' })
      setData((d) => (d ? { ...d, exam } : d))
      toast.success('Exam published', 'It is now scheduled and ready for credentials.')
      setConfirm(false)
    } catch (e) {
      toast.error('Could not publish', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setPublishing(false)
    }
  }

  if (error && !loading) return <ErrorState title="Exam unavailable" message={error} onRetry={reload} />
  if (loading || !data) {
    return <div className="space-y-6" aria-busy="true" aria-label="Loading exam"><Skeleton className="h-10 w-96 max-w-full" /><Skeleton className="h-10 w-full max-w-xl" /><div className="grid gap-6 xl:grid-cols-3"><Skeleton className="h-96 rounded-2xl xl:col-span-2" /><Skeleton className="h-96 rounded-2xl" /></div></div>
  }
  const { exam } = data

  return (
    <div className="space-y-6">
      <div className="relative flex flex-wrap items-start justify-between gap-4 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary-50 via-white to-white p-6">
        <motion.img src="/images/illustrations/exam-ready.svg" alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-2 right-4 hidden h-32 w-auto lg:block" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.5, ease: 'easeOut' }} />
        <div className="relative">
          <Link href="/organization/exams" className="mb-2 inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> All exams</Link>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-text sm:text-3xl">{exam.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted"><ExamStatusBadge status={exam.status} /><code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{exam.code}</code><span className="inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" aria-hidden="true" />{formatDate(exam.startsAt)}, {formatTime(exam.startsAt)}</span></p>
        </div>
        {exam.status === 'DRAFT' && <button type="button" onClick={() => setConfirm(true)} className={cx(btnPrimary, 'relative lg:mr-56')}><Rocket className="h-4 w-4" aria-hidden="true" /> Publish</button>}
      </div>

      <div role="tablist" aria-label="Exam sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t, i) => (
          <button key={t.key} id={`tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} tabIndex={tab === t.key ? 0 : -1} onClick={() => setTab(t.key)} onKeyDown={(e) => onTabKey(e, i)}
            className={cx('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text')}>
            {t.label}{t.key === 'questions' && <span className="ml-2 rounded-full bg-slate-100 px-2 text-xs tabular-nums text-muted">{data.questions.length}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="outline-none">
        {tab === 'overview' && <OverviewTab d={data} id={id} onPublish={() => setConfirm(true)} publishing={publishing} />}
        {tab === 'questions' && <QuestionsTab d={data} id={id} />}
        {tab === 'candidates' && <CandidatesTab id={id} exam={exam} />}
        {tab === 'settings' && <SettingsTab key={JSON.stringify([exam.settings, data.policy])} d={data} onSaved={(e, p) => setData((d) => (d ? { ...d, exam: e, policy: p } : d))} />}
        {tab === 'reports' && <ReportsTab id={id} exam={exam} />}
      </div>

      <ConfirmDialog open={confirm} title="Publish and schedule this exam?" confirmLabel="Publish" tone="primary" busy={publishing} onConfirm={() => void publish()} onCancel={() => setConfirm(false)}>
        <p>The exam moves to <strong>Scheduled</strong>. You can still add candidates and questions until it starts.</p>
        <p>Once it starts, settings and the violation policy are locked.</p>
      </ConfirmDialog>
    </div>
  )
}

export default function ExamOverviewPage() {
  return (
    <Suspense fallback={<div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-96 max-w-full" /><Skeleton className="h-96 rounded-2xl" /></div>}>
      <ExamOverview />
    </Suspense>
  )
}
