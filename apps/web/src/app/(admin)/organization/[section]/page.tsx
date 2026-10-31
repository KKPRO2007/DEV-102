'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, BarChart3, KeyRound, Library, Search, ShieldAlert, Users, type LucideIcon } from 'lucide-react'
import { ExamStatusBadge } from '@/components/admin/ExamStatusBadge'
import { ErrorState, Skeleton } from '@/components/admin/States'
import { listExams } from '@/lib/api'
import { formatDate, formatTime, useAsyncData } from '@/lib/adminHooks'

/** Sidebar sections that work per exam: pick the exam, then jump into its tool. */
const SECTIONS: Record<string, { title: string; blurb: string; icon: LucideIcon; target: string; cta: string; art?: string }> = {
  questions: { title: 'Question bank', blurb: 'Write, import and reorder multiple-choice and numeric questions for an exam.', icon: Library, target: 'questions', cta: 'Open questions', art: '/images/illustrations/question-bank.svg' },
  candidates: { title: 'Candidates', blurb: 'Import candidates and track who is invited, emailed or in the exam.', icon: Users, target: 'credentials', cta: 'Manage candidates' },
  credentials: { title: 'Credentials', blurb: 'Generate Exam ID, Candidate ID and passwords and email them securely.', icon: KeyRound, target: 'credentials', cta: 'Send credentials', art: '/images/illustrations/credentials.svg' },
  results: { title: 'Results', blurb: 'Scores, pass rate and rankings with Excel and PDF exports.', icon: BarChart3, target: 'reports', cta: 'View results' },
  reports: { title: 'Violation reports', blurb: 'Violation heatmaps, flagged candidates and evidence for review.', icon: ShieldAlert, target: 'reports', cta: 'Open report' },
}

export default function ExamSectionPicker() {
  const { section } = useParams<{ section: string }>()
  const meta = SECTIONS[section]
  const { data, error, loading, reload } = useAsyncData(listExams)
  const [q, setQ] = useState('')
  const reduce = useReducedMotion()
  const exams = useMemo(
    () => (data ?? []).filter((e) => !q || `${e.title} ${e.code}`.toLowerCase().includes(q.toLowerCase())),
    [data, q],
  )
  if (!meta) notFound()
  const Icon = meta.icon

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b2a6f] via-primary to-sky-500 p-8 text-white shadow-pop">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" aria-hidden />
        {meta.art && (
          // A slow float; reduced motion keeps it still.
          <motion.img src={meta.art} alt="" aria-hidden="true" className="pointer-events-none absolute bottom-4 right-10 hidden h-40 w-auto md:block" animate={reduce ? undefined : { y: [0, -6, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }} />
        )}
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25"><Icon className="h-6 w-6" aria-hidden /></span>
        <h1 className="mt-4 font-heading text-3xl font-semibold">{meta.title}</h1>
        <p className="mt-2 max-w-xl text-sm text-white/80">{meta.blurb} Choose an exam to continue.</p>
        <label className="relative mt-6 block max-w-md">
          <span className="sr-only">Search exams</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or code" className="w-full rounded-xl border border-white/30 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/60 focus-visible:bg-white/20 focus-visible:outline-2 focus-visible:outline-white" />
        </label>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {exams.map((e, i) => (
            <motion.li key={e.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }}>
              <Link href={`/organization/exams/${e.id}/${meta.target}`} className="group flex h-full flex-col rounded-2xl border border-border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-pop focus-visible:outline-2 focus-visible:outline-accent">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-xs font-semibold text-primary">{e.code}</span>
                  <ExamStatusBadge status={e.status} />
                </div>
                <h2 className="mt-2 line-clamp-2 font-heading text-base font-semibold text-ink">{e.title}</h2>
                <p className="mt-1 text-xs text-muted">{formatDate(e.startsAt)} · {formatTime(e.startsAt)} · {e.questionCount} questions · {e.candidateCount} candidates</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-primary">{meta.cta} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
              </Link>
            </motion.li>
          ))}
          {exams.length === 0 && <li className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">No exams match your search.</li>}
        </ul>
      )}
    </div>
  )
}
