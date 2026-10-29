'use client'

import { FormEvent, Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowRight, Loader2, ShieldCheck } from 'lucide-react'
import { BrandMark } from '@/components/layout/BrandMark'
import { OrgBackdrop } from '@/components/layout/OrgBackdrop'
import { DEMO_CREDENTIALS, login } from '@/lib/api'
import { homeFor, useSession } from '@/lib/session'

type LoginRole = 'candidate' | 'mentor' | 'admin'

const ROLE_LABELS: Record<LoginRole, string> = {
  candidate: 'Candidate',
  mentor: 'Proctor',
  admin: 'Organization',
}

function LoginContent() {
  const router = useRouter()
  const params = useSearchParams()
  const setUser = useSession((state) => state.setUser)
  // ?role=proctor / ?role=organization (the old mentor / admin values still work).
  const roleParam = params.get('role')
  const initialRole = roleParam === 'proctor' || roleParam === 'mentor' ? 'mentor' : roleParam === 'organization' || roleParam === 'admin' ? 'admin' : 'candidate'
  const [role, setRole] = useState<LoginRole>(initialRole)
  const [identifier, setIdentifier] = useState('')
  const [examId, setExamId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fillDemo = () => {
    const credentials = role === 'candidate' ? DEMO_CREDENTIALS.candidate : DEMO_CREDENTIALS[role]
    setIdentifier(credentials.identifier)
    setPassword(credentials.password)
    if (role === 'candidate') setExamId(DEMO_CREDENTIALS.candidate.examId)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await login({ identifier, password, examId: role === 'candidate' ? examId : undefined })
      setUser(result.user)
      const next = params.get('next')
      router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(result.user.role))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-[calc(100vh-5rem)] overflow-hidden bg-[#050b1a] px-5 py-12">
      <OrgBackdrop />
      <div className="relative mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-white/60 bg-white/95 shadow-pop backdrop-blur md:grid-cols-[.9fr_1.1fr]">
        <section className="hidden bg-primary p-10 text-white md:flex md:flex-col md:justify-between">
          <div>
            <BrandMark light />
            <div className="mt-20">
              <ShieldCheck className="h-10 w-10 text-cta" aria-hidden />
              <h1 className="mt-5 font-heading text-3xl font-semibold">Secure access to Where U Elevate.</h1>
              <p className="mt-4 text-sm leading-6 text-white/75">Sign in to manage exams, monitor live sessions, or continue to your secure assessment.</p>
            </div>
          </div>
          <p className="text-xs text-white/75">Protected assessment workspace</p>
        </section>

        <section className="p-6 sm:p-10">
          <p className="text-sm font-semibold text-primary">Welcome back</p>
          <h2 className="mt-1 font-heading text-3xl font-semibold text-ink">Sign in</h2>
          <p className="mt-2 text-sm text-muted">Choose your account type to continue.</p>

          <div className="mt-6 grid grid-cols-3 gap-2 rounded-xl bg-soft p-1" role="tablist" aria-label="Account type">
            {(Object.keys(ROLE_LABELS) as LoginRole[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={role === value}
                onClick={() => { setRole(value); setError(null) }}
                className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${role === value ? 'bg-white text-primary shadow-sm' : 'text-muted hover:text-primary'}`}
              >
                {ROLE_LABELS[value]}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {role === 'candidate' && (
              <label className="block text-sm font-medium text-ink">
                Exam ID
                <input value={examId} onChange={(event) => setExamId(event.target.value)} required className="mt-1 w-full rounded-xl border border-border bg-white px-3.5 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" placeholder="WUE-CS-2026" />
              </label>
            )}
            <label className="block text-sm font-medium text-ink">
              {role === 'candidate' ? 'Candidate ID' : 'Email'}
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} required className="mt-1 w-full rounded-xl border border-border bg-white px-3.5 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" placeholder={role === 'candidate' ? 'Your candidate ID' : 'name@example.com'} />
            </label>
            <label className="block text-sm font-medium text-ink">
              Password
              <input value={password} onChange={(event) => setPassword(event.target.value)} required type="password" className="mt-1 w-full rounded-xl border border-border bg-white px-3.5 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" placeholder="Enter your password" />
            </label>

            {error && <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-danger" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}

            <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-btn transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" onClick={fillDemo} className="w-full text-center text-xs font-semibold text-primary hover:underline">
              Use demo credentials
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted">Demo mode is enabled for local development.</p>
        </section>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return <Suspense fallback={<main className="grid min-h-[calc(100vh-5rem)] place-items-center bg-[#050b1a] text-white">Loading sign in…</main>}><LoginContent /></Suspense>
}
