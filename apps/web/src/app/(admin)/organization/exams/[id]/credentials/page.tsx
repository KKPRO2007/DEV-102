'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { z } from 'zod'
import { AlertCircle, CheckCircle2, FileUp, Mail, RefreshCw, Send, UserPlus } from 'lucide-react'
import CredentialsTable, { type CredentialRow } from '@/components/admin/CredentialsTable'
import EmailPreviewModal, { DEFAULT_TEMPLATE, type EmailTemplate } from '@/components/admin/EmailPreviewModal'
import ProctorInvites from '@/components/admin/ProctorInvites'
import { getExam, importCandidates, listCandidates, resetCandidatePassword, revealCandidatePassword, revokeInvite, sendCredentialEmail } from '@/lib/api'

const CONCURRENCY = 3
const APP_LINK = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ?? 'http://localhost:3000/download'
const emailSchema = z.string().email()

function parseCandidates(text: string) {
  const valid: { name: string; email: string }[] = []
  const errors: string[] = []
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const cells = line.split(/[,\t;]/).map((c) => c.replace(/^"|"$/g, '').trim())
      if (i === 0 && !cells.some((c) => c.includes('@'))) return // header row
      const [name, email] = cells
      if (!name || !email || !emailSchema.safeParse(email).success) {
        errors.push(`Line ${i + 1}: expected "name, email" with a valid email`)
        return
      }
      valid.push({ name, email: email.toLowerCase() })
    })
  return { valid, errors }
}

export default function CandidatesPage() {
  const params = useParams<{ id: string }>()
  const routeId = params?.id ?? 'exam'

  const [examCode, setExamCode] = useState('')
  const [examName, setExamName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [template, setTemplate] = useState<EmailTemplate>(DEFAULT_TEMPLATE)
  const [rows, setRows] = useState<CredentialRow[]>([])
  const reduce = useReducedMotion()
  const [importText, setImportText] = useState('')
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [exam, page] = await Promise.all([getExam(routeId), listCandidates({ examId: routeId, pageSize: 200, sort: 'userId' })])
        if (!alive) return
        setExamCode(exam.code)
        setExamName(exam.title)
        const d = new Date(exam.startsAt)
        setStartTime(new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16))
        setRows(page.items.map((c) => ({
          id: c.id, name: c.name, email: c.email, userId: c.userId, password: '',
          status: c.emailStatus === 'SENT' ? 'sent' : c.emailStatus === 'FAILED' ? 'failed' : 'pending',
          ...(c.invite ? { invite: c.invite } : {}),
        })))
      } catch (e) {
        if (alive) setNotice(e instanceof Error ? e.message : 'Could not load candidates.')
      }
    })()
    return () => {
      alive = false
    }
  }, [routeId])

  const startLabel = startTime ? new Date(startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'the scheduled time'

  const setStatus = useCallback((id: string, status: CredentialRow['status'], error?: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status, error } : r)))
  }, [])

  // The server renders the template and fills {{password}} from its encrypted copy.
  const deliver = useCallback(
    async (row: CredentialRow) => {
      const r = await sendCredentialEmail(row.id, { subject: template.subject, body: template.body })
      if (r.emailStatus !== 'SENT') throw new Error(r.error ?? 'Delivery failed')
      // Sending always issues a fresh link and withdraws the previous one.
      if (r.inviteId) {
        const invite = { id: r.inviteId, status: 'PENDING' as const, deviceBound: false }
        setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, invite, inviteLink: r.devLink, outbox: r.outbox } : x)))
      }
    },
    [template],
  )

  const sendMany = useCallback(
    async (targets: CredentialRow[]) => {
      if (targets.length === 0) return
      setSending(true)
      setProgress({ done: 0, total: targets.length })
      const ids = new Set(targets.map((t) => t.id))
      setRows((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, status: 'queued', error: undefined } : r)))
      const queue = [...targets]
      let done = 0
      const worker = async () => {
        while (queue.length) {
          const row = queue.shift()!
          setStatus(row.id, 'sending')
          try {
            await deliver(row)
            setStatus(row.id, 'sent')
          } catch (e) {
            setStatus(row.id, 'failed', e instanceof Error ? e.message : 'Delivery failed')
          }
          done++
          setProgress({ done, total: targets.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
      setSending(false)
    },
    [deliver, setStatus],
  )

  const addCandidates = async (text: string) => {
    const { valid, errors } = parseCandidates(text)
    setImportErrors(errors)
    if (!valid.length) return
    try {
      const r = await importCandidates(routeId, valid)
      const created: CredentialRow[] = r.credentials.map((c) => ({ id: c.candidateId, name: c.name, email: c.email, userId: c.userId, password: c.password, status: 'pending' }))
      setRows((prev) => [...prev, ...created])
      setImportErrors([...errors, ...r.invalid.map((i) => `Row ${i.row}: ${i.message}`)])
      setNotice(created.length ? `Created ${created.length} candidate account${created.length === 1 ? '' : 's'}${r.duplicates ? ` · ${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} skipped` : ''}. Passwords are shown once; they are stored encrypted until the first sign-in.` : r.duplicates ? `${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} skipped.` : null)
      if (created.length) setImportText('')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  const onFile = async (file?: File) => {
    if (!file) return
    addCandidates(await file.text())
    if (fileRef.current) fileRef.current.value = ''
  }

  const resetPassword = async (row: CredentialRow) => {
    try {
      const fresh = await resetCandidatePassword(row.id)
      const updated = { ...row, password: fresh.password }
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)))
      setNotice(`New password generated for ${row.name}. Sending the updated email…`)
      void sendMany([updated])
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not reset the password.')
    }
  }

  const revoke = async (row: CredentialRow) => {
    if (!row.invite) return
    try {
      const r = await revokeInvite(row.invite.id)
      setRows((prev) => prev.map((x) => (x.id === row.id && x.invite ? { ...x, invite: { ...x.invite, status: r.status } } : x)))
      setNotice(`Exam link for ${row.name} revoked. Resend to issue a new one.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not revoke the link.')
    }
  }

  const keepPassword = (id: string, password: string) => {
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, password } : x)))
    return password
  }
  const revealPassword = async (row: CredentialRow) => keepPassword(row.id, (await revealCandidatePassword(row.id)).password)
  // Reset & copy only issues the password; Resend emails it with a fresh link.
  const resetAndCopy = async (row: CredentialRow) => keepPassword(row.id, (await resetCandidatePassword(row.id)).password)

  const pending = rows.filter((r) => r.status === 'pending')
  const failed = rows.filter((r) => r.status === 'failed')
  const sentCount = rows.filter((r) => r.status === 'sent').length
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const sample = useMemo(() => (rows[0] ? { name: rows[0].name, userId: rows[0].userId, password: rows[0].password } : undefined), [rows])

  const input = 'mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="relative flex flex-wrap items-end justify-between gap-3 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary-50 via-white to-white p-6">
        <motion.img src="/images/illustrations/credentials.svg" alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-3 right-56 hidden h-28 w-auto lg:block" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.5, ease: 'easeOut' }} />
        <div className="relative">
          <p className="text-xs font-medium text-muted">Exam {routeId}</p>
          <h1 className="font-heading text-2xl font-semibold text-ink">Candidates &amp; credentials</h1>
          <p className="text-sm text-muted">Import candidates and proctors, then email each one a personal exam link and password.</p>
          {rows.length > 0 && (
            <div className="mt-4 flex items-center gap-3">
              <div className="h-2 w-48 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={sentCount} aria-label="Credentials emailed">
                <motion.div className="h-full rounded-full bg-success" initial={{ width: 0 }} animate={{ width: `${(sentCount / rows.length) * 100}%` }} transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }} />
              </div>
              <span className="text-xs font-medium tabular-nums text-muted">{sentCount} of {rows.length} emailed</span>
            </div>
          )}
        </div>
        <button type="button" onClick={() => setPreviewOpen(true)} className="relative inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-soft focus-visible:outline-2 focus-visible:outline-accent">
          <Mail className="h-4 w-4" aria-hidden /> Preview &amp; edit email
        </button>
      </header>

      <section className="grid gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm md:grid-cols-3" aria-label="Exam details">
        <label className="block text-sm font-medium text-ink">
          Exam ID
          <input value={examCode} readOnly className={`${input} bg-soft font-mono`} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Exam name
          <input value={examName} readOnly className={`${input} bg-soft`} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Start time
          <input type="datetime-local" value={startTime} readOnly className={`${input} bg-soft`} />
        </label>
      </section>

      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm" aria-label="Import candidates">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-semibold text-ink">Import candidates</h2>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="sr-only" id="candidate-file" onChange={(e) => void onFile(e.target.files?.[0])} />
            <label htmlFor="candidate-file" className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-soft focus-within:outline-2 focus-within:outline-accent">
              <FileUp className="h-3.5 w-3.5" aria-hidden /> Upload CSV
            </label>
          </div>
        </div>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={4}
          aria-label="Candidates, one per line as name and email"
          placeholder={'Name, Email\nAarav Sharma, aarav@example.com\nIsha Verma, isha@example.com'}
          className={`${input} font-mono text-xs`}
        />
        {importErrors.length > 0 && (
          <ul role="alert" className="mt-2 space-y-1 rounded-xl bg-red-50 px-3 py-2 text-xs text-danger">
            {importErrors.slice(0, 5).map((e) => (
              <li key={e} className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {e}</li>
            ))}
            {importErrors.length > 5 && <li>…and {importErrors.length - 5} more</li>}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Columns: name, email. Commas, tabs or semicolons work. Names containing commas should be avoided.</p>
          <button type="button" onClick={() => addCandidates(importText)} disabled={!importText.trim()} className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">
            <UserPlus className="h-4 w-4" aria-hidden /> Add &amp; generate credentials
          </button>
        </div>
      </section>

      <AnimatePresence>
        {notice && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-2.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> {notice}
          </motion.p>
        )}
      </AnimatePresence>

      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm" aria-label="Send emails">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-base font-semibold text-ink">Send credentials</h2>
            <p className="text-xs text-muted" aria-live="polite">
              {sending ? `Sending ${progress.done} of ${progress.total}…` : progress.total ? `Last batch: ${progress.total - failed.length} delivered, ${failed.length} failed` : `${pending.length} candidate${pending.length === 1 ? '' : 's'} waiting to be emailed`}
            </p>
          </div>
          <div className="flex gap-2">
            {failed.length > 0 && (
              <button type="button" onClick={() => void sendMany(failed)} disabled={sending} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-danger hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${sending ? 'animate-spin' : ''}`} aria-hidden /> Resend failed ({failed.length})
              </button>
            )}
            <button type="button" onClick={() => void sendMany(pending)} disabled={sending || pending.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-cta px-5 py-2.5 text-sm font-semibold text-ink shadow-sm hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">
              <Send className="h-4 w-4" aria-hidden /> Send to {pending.length} pending
            </button>
          </div>
        </div>
        {(sending || progress.total > 0) && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Email sending progress">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-primary-600 to-accent" animate={{ width: `${pct}%` }} transition={{ ease: 'easeOut', duration: 0.3 }} />
          </div>
        )}
      </section>

      <CredentialsTable rows={rows} examId={examCode} busy={sending} onResend={(r) => void sendMany([r])} onReset={resetPassword} onRevoke={(r) => void revoke(r)} onRevealPassword={revealPassword} onResetPassword={resetAndCopy} onResendFailed={() => void sendMany(failed)} />

      <ProctorInvites examId={routeId} />

      <EmailPreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} template={template} onChange={setTemplate} examName={examName} examId={examCode} startTime={startLabel} appLink={APP_LINK} sample={sample} />
    </div>
  )
}
