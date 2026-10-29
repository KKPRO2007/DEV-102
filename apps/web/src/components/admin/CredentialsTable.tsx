'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Ban, Check, CheckCircle2, Clock, Copy, Download, KeyRound, Loader2, RotateCw, Send } from 'lucide-react'
import type { InviteStatus } from '@/lib/types'
import { getInviteLink } from '@/lib/api'
import PasswordCell from './PasswordCell'

export type SendStatus = 'pending' | 'queued' | 'sending' | 'sent' | 'failed'

export interface CredentialRow {
  id: string
  name: string
  email: string
  userId: string
  password: string
  status: SendStatus
  error?: string
  inviteLink?: string
  outbox?: boolean
  invite?: { id: string; status: InviteStatus; deviceBound: boolean }
}

const LINK_LABEL: Record<InviteStatus, [string, string]> = {
  PENDING: ['Link not used yet', 'text-muted'],
  USED: ['Link in use', 'text-success'],
  REVOKED: ['Link revoked', 'text-danger'],
  EXPIRED: ['Link expired', 'text-muted'],
}

interface CredentialsTableProps {
  rows: CredentialRow[]
  examId: string
  /** Disables row actions while a send batch is running. */
  busy?: boolean
  onResend: (row: CredentialRow) => void
  onReset: (row: CredentialRow) => void
  onRevoke?: (row: CredentialRow) => void
  /** Stored password before the candidate's first sign-in. */
  onRevealPassword: (row: CredentialRow) => Promise<string>
  /** New password, without emailing it. */
  onResetPassword: (row: CredentialRow) => Promise<string>
  onResendFailed?: () => void
}

type SortKey = 'name' | 'userId' | 'status'
const STATUS_ORDER: Record<SendStatus, number> = { failed: 0, pending: 1, queued: 2, sending: 3, sent: 4 }

const BADGE: Record<SendStatus, { label: string; cls: string }> = {
  pending: { label: 'Not sent', cls: 'bg-soft text-muted' },
  queued: { label: 'Queued', cls: 'bg-blue-50 text-accent' },
  sending: { label: 'Sending…', cls: 'bg-blue-50 text-accent' },
  sent: { label: 'Sent', cls: 'bg-green-50 text-success' },
  failed: { label: 'Failed', cls: 'bg-red-50 text-danger' },
}

function StatusBadge({ status }: { status: SendStatus }) {
  const b = BADGE[status]
  const cls = 'h-3 w-3'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${b.cls}`} role="status">
      {status === 'sending' && <Loader2 className={`${cls} animate-spin`} aria-hidden />}
      {status === 'queued' && <Clock className={cls} aria-hidden />}
      {status === 'sent' && <CheckCircle2 className={cls} aria-hidden />}
      {status === 'failed' && <AlertTriangle className={cls} aria-hidden />}
      {b.label}
    </span>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setDone(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`} className="rounded-md p-1 text-muted hover:bg-soft hover:text-primary focus-visible:outline-2 focus-visible:outline-accent">
      {done ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </button>
  )
}

function CopyInviteLinkButton({ inviteId, candidateName }: { inviteId: string; candidateName: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied' | 'error'>('idle')
  const copy = async () => {
    setState('loading')
    try {
      const { link } = await getInviteLink(inviteId)
      await navigator.clipboard.writeText(link)
      setState('copied')
      window.setTimeout(() => setState('idle'), 1500)
    } catch {
      setState('error')
      window.setTimeout(() => setState('idle'), 2500)
    }
  }
  return <button type="button" onClick={() => void copy()} disabled={state === 'loading'} className="ml-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-soft disabled:opacity-50" aria-label={`Copy ${candidateName}'s exam join link`}>
    {state === 'loading' ? 'Loading…' : state === 'copied' ? 'Copied' : state === 'error' ? 'Unavailable' : 'Copy link'}
  </button>
}

const csvCell = (v: string, guard = false) => {
  const s = guard && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function CredentialsTable({ rows, examId, busy = false, onResend, onReset, onRevoke, onRevealPassword, onResetPassword, onResendFailed }: CredentialsTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const sorted = useMemo(() => {
    const out = [...rows]
    out.sort((a, b) => {
      const r = sort.key === 'status' ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] : a[sort.key].localeCompare(b[sort.key], undefined, { numeric: true, sensitivity: 'base' })
      return r * sort.dir
    })
    return out
  }, [rows, sort])

  const failed = rows.filter((r) => r.status === 'failed').length
  const sent = rows.filter((r) => r.status === 'sent').length

  const exportCsv = () => {
    const head = ['Exam ID', 'Name', 'Email', 'Candidate ID', 'Password', 'Email status']
    const lines = rows.map((r) => [csvCell(examId), csvCell(r.name, true), csvCell(r.email, true), csvCell(r.userId), csvCell(r.password), csvCell(BADGE[r.status].label)].join(','))
    const blob = new Blob(['\uFEFF' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${examId || 'exam'}-credentials.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const th = (key: SortKey, label: string) => {
    const active = sort.key === key
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className="px-4 py-2.5 text-left">
        <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-accent">
          {label}
          <Icon className={`h-3 w-3 ${active ? 'text-accent' : ''}`} aria-hidden />
        </button>
      </th>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-sm text-muted">
          <strong className="text-ink">{rows.length}</strong> candidates · <span className="text-success">{sent} sent</span>
          {failed > 0 && <> · <span className="text-danger">{failed} failed</span></>}
        </p>
        <div className="flex gap-2">
          {failed > 0 && onResendFailed && (
            <button type="button" onClick={onResendFailed} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-danger hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
              <RotateCw className="h-3.5 w-3.5" aria-hidden /> Resend failed ({failed})
            </button>
          )}
          <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
            <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted">No candidates yet. Import a list above to generate credentials.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-soft/60">
              <tr>
                {th('name', 'Candidate')}
                {th('userId', 'Candidate ID')}
                <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">Password</th>
                {th('status', 'Email')}
                <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((r) => {
                return (
                  <motion.tr key={r.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{r.name}</p>
                      <p className="flex items-center gap-1 text-xs text-muted">
                        {r.email}
                        <CopyButton value={r.email} label={`${r.name}'s email`} />
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-ink">
                        {r.userId}
                        <CopyButton value={r.userId} label={`${r.name}'s candidate ID`} />
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <PasswordCell value={r.password} label={r.name} reveal={() => onRevealPassword(r)} reset={() => onResetPassword(r)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} />
                      {r.status === 'sent' && r.outbox && <p className="mt-1 text-[11px] text-amber-700">Saved to local dev outbox</p>}
                      {r.invite && (r.invite.status === 'PENDING' || r.invite.status === 'USED') && <p className="mt-1 flex items-center gap-1 text-[11px] text-primary"><span>Join link</span><CopyInviteLinkButton inviteId={r.invite.id} candidateName={r.name} /></p>}
                      {r.status === 'failed' && r.error && <p className="mt-1 max-w-[12rem] truncate text-[11px] text-danger" title={r.error}>{r.error}</p>}
                      {r.invite && <p className={`mt-1 text-[11px] ${LINK_LABEL[r.invite.status][1]}`}>{LINK_LABEL[r.invite.status][0]}{r.invite.deviceBound ? ' · device locked' : ''}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => onResend(r)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-primary hover:bg-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50" aria-label={`${r.status === 'sent' ? 'Resend' : 'Send'} email to ${r.name}`}>
                          <Send className="h-3 w-3" aria-hidden /> {r.status === 'sent' || r.status === 'failed' ? 'Resend' : 'Send'}
                        </button>
                        <button type="button" onClick={() => onReset(r)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted hover:bg-soft hover:text-primary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50" aria-label={`Reset password for ${r.name}`}>
                          <KeyRound className="h-3 w-3" aria-hidden /> Reset
                        </button>
                        {onRevoke && r.invite && (r.invite.status === 'PENDING' || r.invite.status === 'USED') && (
                          <button type="button" onClick={() => onRevoke(r)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-danger hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50" aria-label={`Revoke exam link for ${r.name}`}>
                            <Ban className="h-3 w-3" aria-hidden /> Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
