'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { AlertCircle, CalendarClock, Check, ClipboardCopy, Download, GraduationCap, KeyRound, Loader2, MonitorSmartphone, ShieldCheck } from 'lucide-react'
import { OrgBackdrop } from '@/components/layout/OrgBackdrop'
import { previewInvite, type InvitePreview } from '@/lib/api'

/** First name for the greeting, skipping titles such as "Dr." */
const firstName = (name: string) => name.split(/\s+/).find((p) => !/^(dr|mr|mrs|ms|miss|prof)\.?$/i.test(p)) ?? name

/**
 * Where the link in the invitation email lands. The exam itself runs only in the desktop app,
 * so this page shows who the link is for and how to paste it there.
 */
export default function JoinPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [invite, setInvite] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [link, setLink] = useState('')

  useEffect(() => {
    setLink(window.location.href.split(/[?#]/)[0] ?? '')
    previewInvite(token).then(setInvite).catch((e: unknown) => setError(e instanceof Error ? e.message : 'This exam link could not be checked.'))
  }, [token])

  const copy = async () => {
    // Over http://<wifi-address> (npm run start:lan) the page is not a secure context and has no Clipboard API.
    if (navigator.clipboard) await navigator.clipboard.writeText(link)
    else {
      const field = Object.assign(document.createElement('textarea'), { value: link })
      document.body.append(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const proctor = invite?.role === 'MENTOR'
  const steps = [
    { icon: Download, title: 'Install Smart Proctor', body: 'Download the Windows desktop app if it is not on this computer yet.' },
    { icon: ClipboardCopy, title: 'Paste this link', body: 'Open the app and paste the link on the first screen. Your details fill in automatically.' },
    { icon: KeyRound, title: 'Enter your password', body: proctor ? 'Use the password from your email, then verify your face and an email code.' : 'Use the password from your email, then follow the system and identity checks.' },
  ]

  return (
    <main className="relative min-h-[calc(100vh-5rem)] overflow-hidden bg-[#050b1a] px-4 py-12 sm:px-5">
      <OrgBackdrop />
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="relative mx-auto max-w-xl rounded-3xl bg-white/95 p-6 shadow-pop ring-1 ring-white/60 backdrop-blur sm:p-8">
        {!invite && !error && (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your exam link…</p>
        )}

        {error && (
          <div className="py-4 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-danger" aria-hidden />
            <h1 className="mt-3 font-heading text-xl font-semibold text-ink">This link cannot be used</h1>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <p className="mt-4 text-xs text-muted">Only people invited by an organisation can join an exam. Contact your exam coordinator for a new link.</p>
          </div>
        )}

        {invite && (
          <>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${proctor ? 'bg-amber-100 text-amber-800' : 'bg-blue-50 text-primary'}`}>
              {proctor ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : <GraduationCap className="h-3.5 w-3.5" aria-hidden />}
              {proctor ? 'Proctor invitation' : 'Candidate invitation'}
            </span>
            <h1 className="mt-3 font-heading text-2xl font-semibold text-ink">Hello {firstName(invite.name)}, you are invited to {invite.exam.title}</h1>
            <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="font-mono text-ink">{invite.exam.code}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{new Date(invite.exam.startsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              {invite.userId && <><span aria-hidden>·</span><span>Candidate ID <span className="font-mono text-ink">{invite.userId}</span></span></>}
            </p>

            <ol className="mt-6 space-y-3">
              {steps.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="flex gap-3 rounded-2xl border border-border p-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary"><Icon className="h-4 w-4" aria-hidden /></span>
                  <div>
                    <p className="text-sm font-semibold text-ink">{i + 1}. {title}</p>
                    <p className="text-xs text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => void copy()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cta px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <ClipboardCopy className="h-4 w-4" aria-hidden />} {copied ? 'Link copied' : 'Copy exam link'}
              </button>
              <Link href="/download" className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-primary hover:bg-soft focus-visible:outline-2 focus-visible:outline-accent">
                <MonitorSmartphone className="h-4 w-4" aria-hidden /> Get the desktop app
              </Link>
            </div>
            <p className="mt-4 text-center text-xs text-muted">
              {invite.deviceBound ? 'This link is already locked to a computer. Use that computer, or ask for a new link.' : 'The link locks to the first computer that signs in with it and expires when the exam ends.'}
            </p>
          </>
        )}
      </motion.div>
    </main>
  )
}
