import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, ArrowLeft, ArrowRight, CalendarClock, Check, ClipboardPaste, Clock3, Copy, Eye, EyeOff, Fingerprint, FlaskConical, GraduationCap, Link2, Loader2,
  Lock, MailCheck, MonitorCheck, ShieldCheck, Video, Wifi, WifiOff, type LucideIcon,
} from 'lucide-react'
import { api, devApi, parseInviteToken, serverFromInviteLink, type InvitePreview } from '../lib/api'
import { API_ORIGIN, HttpError, setServer } from '../lib/http'
import { useApp } from '../lib/store'
import { backgroundFor, getTimeTheme, type Look, type TimeTheme } from '../lib/theme'

interface LoginProps {
  onLoggedIn: () => void
}

const GREETING: Record<TimeTheme, string> = { morning: 'Good morning', day: 'Good afternoon', night: 'Good evening' }

/** Brand gradient over the background photo, tinted for the time of day. */
const OVERLAY: Record<TimeTheme, string> = {
  morning: 'linear-gradient(115deg, rgba(10,77,166,.88) 0%, rgba(30,111,240,.55) 48%, rgba(255,176,32,.18) 100%)',
  day: 'linear-gradient(115deg, rgba(10,77,166,.9) 0%, rgba(30,111,240,.6) 50%, rgba(30,111,240,.12) 100%)',
  night: 'linear-gradient(115deg, rgba(2,8,23,.94) 0%, rgba(10,31,77,.78) 50%, rgba(10,77,166,.35) 100%)',
}

const FEATURES: Record<Look, [LucideIcon, string][]> = {
  org: [
    [Link2, 'A personal link for every invited candidate and proctor'],
    [Fingerprint, 'Face and email verification before any exam opens'],
    [ShieldCheck, 'Each link works on one computer and expires with the exam'],
  ],
  student: [
    [ShieldCheck, 'Encrypted, tamper-aware exam browser'],
    [Video, 'Webcam and screen monitoring during the test'],
    [Lock, 'Only approved sites open inside the sandbox'],
  ],
  proctor: [
    [MonitorCheck, 'Live grid of every candidate in your exam'],
    [Fingerprint, 'Face and email verification before the console opens'],
    [Eye, 'Review violations, warn and pause in real time'],
  ],
}

const formatTime = (date: Date) => date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
const formatWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
/** First name for the greeting, skipping titles such as "Dr." */
const firstName = (name: string) => name.split(/\s+/).find((p) => !/^(dr|mr|mrs|ms|miss|prof)\.?$/i.test(p)) ?? name
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export default function Login({ onLoggedIn }: LoginProps) {
  const [now, setNow] = useState(() => new Date())
  const [serverState, setServerState] = useState<{ online: boolean; latencyMs: number } | null>(null)
  const [link, setLink] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [invite, setInvite] = useState<InvitePreview | null>(null)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bgFailed, setBgFailed] = useState(false)
  const [testCopied, setTestCopied] = useState(false)
  const [server, setServerText] = useState(API_ORIGIN)
  const [editingServer, setEditingServer] = useState(false)
  const [serverDraft, setServerDraft] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)

  const pingServer = useCallback(async () => setServerState(await api.serverStatus()), [])

  /** Points the app at the organization's server (same Wi-Fi address or tunnel link). */
  const saveServer = () => {
    const origin = setServer(serverDraft)
    if (!origin) {
      setServerError('Enter an address like 192.168.1.20 or https://name.trycloudflare.com')
      return
    }
    setServerText(origin)
    setEditingServer(false)
    setServerError(null)
    setServerState(null)
    void pingServer()
  }

  useEffect(() => {
    void pingServer()
    const id = window.setInterval(() => void pingServer(), 15000)
    return () => window.clearInterval(id)
  }, [pingServer])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const resolve = useCallback(async (text: string) => {
    const t = parseInviteToken(text)
    if (!t) {
      setError('That does not look like an exam link. Copy the whole link from your invitation email.')
      return
    }
    // A link from the organizer's laptop on this Wi-Fi points the app at that laptop.
    const lanServer = serverFromInviteLink(text)
    if (lanServer && lanServer !== API_ORIGIN) {
      setServer(lanServer)
      setServerText(lanServer)
      setServerState(null)
      void pingServer()
    }
    setBusy(true)
    setError(null)
    try {
      const preview = await api.previewInvite(t)
      setInvite(preview)
      setToken(t)
      useApp.getState().setJoinRole(preview.role)
    } catch (e) {
      setError(errorText(e, 'Could not check this link.'))
    } finally {
      setBusy(false)
    }
  }, [pingServer])

  // If the invitation link is already on the clipboard, offer it straight away.
  useEffect(() => {
    navigator.clipboard?.readText().then((text) => {
      if (parseInviteToken(text)) setLink((current) => current || text.trim())
    }).catch(() => undefined)
  }, [])

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      setLink(text)
      if (parseInviteToken(text)) void resolve(text)
    } catch {
      setError('Clipboard access was blocked. Paste the link with Ctrl+V.')
    }
  }

  const onLink = (e: FormEvent) => {
    e.preventDefault()
    void resolve(link)
  }

  const onPassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await api.loginWithInvite(token, password)
      onLoggedIn()
    } catch (err) {
      const left = err instanceof HttpError ? err.details?.attemptsLeft : undefined
      setError(`${errorText(err, 'Sign-in failed.')}${typeof left === 'number' ? ` (${left} attempt${left === 1 ? '' : 's'} left)` : ''}`)
    } finally {
      setBusy(false)
    }
  }

  /** Development only: fetch the link's password to copy or fill it, so testing needs no email. */
  const testPassword = async (mode: 'copy' | 'fill') => {
    if (!token) return
    try {
      const p = await devApi.invitePassword(token)
      if (mode === 'fill') setPassword(p)
      else {
        await navigator.clipboard.writeText(p)
        setTestCopied(true)
        window.setTimeout(() => setTestCopied(false), 1500)
      }
    } catch (e) {
      setError(errorText(e, 'Could not fetch the test password.'))
    }
  }

  const startOver = () => {
    useApp.getState().setJoinRole(null)
    setInvite(null)
    setToken(null)
    setPassword('')
    setError(null)
  }

  const time = getTimeTheme(now)
  const look: Look = !invite ? 'org' : invite.role === 'MENTOR' ? 'proctor' : 'student'
  const background = backgroundFor(look, time)
  const offline = serverState?.online === false
  const isProctor = invite?.role === 'MENTOR'

  useEffect(() => setBgFailed(false), [background])

  return (
    <div className="relative h-full min-h-[700px] overflow-hidden bg-[#06142e]">
      <AnimatePresence initial={false}>
        {!bgFailed && (
          <motion.img
            key={background}
            src={background}
            alt=""
            aria-hidden
            onError={() => setBgFailed(true)}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 transition-[background] duration-700" style={{ background: OVERLAY[time] }} aria-hidden />
      <div className="absolute inset-0 opacity-[.12] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]" aria-hidden />

      <div className="relative grid h-full grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        <aside className="hidden flex-col justify-between p-12 text-white lg:flex">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Where U Elevate" className="h-10 w-auto rounded bg-white/90 p-1" onError={(e) => (e.currentTarget.style.display = 'none')} />
            <span className="font-heading text-lg font-semibold">Smart Proctor</span>
          </div>
          <div className="max-w-md">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium ring-1 ring-white/25 backdrop-blur">
              <Clock3 className="h-3.5 w-3.5" aria-hidden /> {GREETING[time]} · {formatTime(now)}
            </p>
            <AnimatePresence mode="wait">
              <motion.div key={look + (invite?.name ?? '')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}>
                <h1 className="font-heading text-4xl font-semibold leading-tight">
                  {!invite ? 'Your secure exam, one link away.' : isProctor ? `Ready to proctor, ${firstName(invite.name)}?` : `Welcome, ${firstName(invite.name)}.`}
                </h1>
                <p className="mt-4 text-white/80">
                  {!invite
                    ? 'Your organisation emails a personal link to each invited candidate and proctor. Paste it here to continue.'
                    : isProctor
                      ? 'After your password, confirm your identity with your face and an email code. Then the live console opens.'
                      : 'After your password, the app checks your device, verifies your face and locks into exam mode.'}
                </p>
                <ul className="mt-8 space-y-3 text-sm">
                  {FEATURES[look].map(([Icon, text]) => (
                    <li key={text} className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20"><Icon className="h-4 w-4" aria-hidden /></span>
                      {text}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="text-xs text-white/60">© Where U Elevate · DEV102 Assessment Platform</p>
        </aside>

        <main className="flex items-center justify-center p-6 sm:p-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-[400px] rounded-3xl bg-white/95 p-7 shadow-[0_30px_80px_-20px_rgba(2,8,23,.55)] ring-1 ring-white/60 backdrop-blur-xl"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                {isProctor ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : <GraduationCap className="h-3.5 w-3.5" aria-hidden />}
                {!invite ? 'Join exam' : isProctor ? 'Proctor sign in' : 'Candidate sign in'}
              </span>
              <span
                role="status"
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${serverState === null ? 'bg-soft text-muted' : offline ? 'bg-red-50 text-danger' : 'bg-green-50 text-success'}`}
              >
                {offline ? <WifiOff className="h-3 w-3" aria-hidden /> : <Wifi className="h-3 w-3" aria-hidden />}
                {serverState === null ? 'Checking…' : offline ? 'Server offline' : `Online · ${serverState.latencyMs} ms`}
              </span>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {!invite ? (
                <motion.form key="link" onSubmit={onLink} noValidate initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} aria-label="Paste exam link">
                  <h2 className="font-heading text-2xl font-semibold text-ink">Paste your exam link</h2>
                  <p className="mt-1 text-sm text-muted">Find it in the invitation email from your organisation.</p>
                  <label className="mt-5 block text-sm font-medium text-ink" htmlFor="invite-link">Exam link</label>
                  <div className="relative mt-1">
                    <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                    <input
                      id="invite-link"
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData('text')
                        if (parseInviteToken(text)) {
                          e.preventDefault()
                          setLink(text.trim())
                          void resolve(text)
                        }
                      }}
                      autoFocus
                      spellCheck={false}
                      placeholder="https://…/join/…"
                      aria-invalid={!!error}
                      className={`w-full rounded-xl border bg-white py-2.5 pl-9 pr-24 font-mono text-xs text-ink placeholder:font-sans placeholder:text-sm placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${error ? 'border-danger' : 'border-border'}`}
                    />
                    <button type="button" onClick={() => void pasteFromClipboard()} className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-lg bg-soft px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10">
                      <ClipboardPaste className="h-3.5 w-3.5" aria-hidden /> Paste
                    </button>
                  </div>
                  {error && <ErrorNote text={error} />}
                  <button type="submit" disabled={busy || (offline && !serverFromInviteLink(link)) || !link.trim()} className={submitCls}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                    {busy ? 'Checking link…' : 'Continue'}
                  </button>
                  {offline && <button type="button" onClick={() => void pingServer()} className="mt-3 w-full text-center text-xs font-medium text-accent underline">Server unreachable. Retry connection</button>}
                  <p className="mt-6 text-center text-xs text-muted">No link? Only candidates and proctors invited by an organisation can join. Contact your exam coordinator.</p>
                  {/* The organization's server: its address on the same Wi-Fi, or its tunnel link over the internet. */}
                  <div className="mt-4 border-t border-border pt-3 text-xs text-muted">
                    {!editingServer ? (
                      <p className="flex items-center justify-center gap-2">
                        <span>Exam server <span className="font-mono text-ink">{server.replace(/^https?:\/\//, '')}</span></span>
                        <button type="button" onClick={() => { setServerDraft(server); setEditingServer(true) }} className="font-medium text-accent underline">Change</button>
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex gap-1.5">
                          <input
                            value={serverDraft}
                            onChange={(e) => { setServerDraft(e.target.value); setServerError(null) }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveServer() } }}
                            aria-label="Exam server address"
                            placeholder="192.168.1.20 or https://….trycloudflare.com"
                            spellCheck={false}
                            className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 font-mono text-xs text-ink focus-visible:outline-2 focus-visible:outline-accent"
                          />
                          <button type="button" onClick={saveServer} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Save</button>
                          <button type="button" onClick={() => { setEditingServer(false); setServerError(null) }} className="rounded-lg px-2 py-1.5 font-medium">Cancel</button>
                        </div>
                        {serverError && <span className="text-danger">{serverError}</span>}
                        <span>Leave empty and save to go back to this computer.</span>
                      </div>
                    )}
                  </div>
                </motion.form>
              ) : (
                <motion.form key="password" onSubmit={(e) => void onPassword(e)} noValidate initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} aria-label="Enter password">
                  <button type="button" onClick={startOver} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-primary">
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Use a different link
                  </button>
                  <div className="rounded-2xl bg-gradient-to-br from-[#0A4DA6] to-[#1E6FF0] p-4 text-white">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">{invite.exam.code}</p>
                    <p className="mt-0.5 font-heading text-lg font-semibold leading-snug">{invite.exam.title}</p>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/80">
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {formatWhen(invite.exam.startsAt)} · {invite.exam.durationMin} min
                    </p>
                  </div>
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted">Name</dt><dd className="truncate font-medium text-ink">{invite.name}</dd>
                    {invite.userId && <><dt className="text-muted">Candidate ID</dt><dd className="font-mono font-medium text-ink">{invite.userId}</dd></>}
                    <dt className="text-muted">Email</dt><dd className="truncate text-ink">{invite.email}</dd>
                    <dt className="text-muted">Role</dt>
                    <dd><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isProctor ? 'bg-amber-100 text-amber-800' : 'bg-blue-50 text-primary'}`}>{isProctor ? 'Proctor' : 'Candidate'}</span></dd>
                  </dl>

                  <label className="mt-5 block text-sm font-medium text-ink" htmlFor="invite-password">Password</label>
                  <div className="relative mt-1">
                    <input
                      id="invite-password"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus
                      autoComplete="current-password"
                      aria-invalid={!!error}
                      className={`w-full rounded-xl border bg-white px-3.5 py-2.5 pr-11 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${error ? 'border-danger' : 'border-border'}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                      aria-pressed={showPw}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {import.meta.env.DEV && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
                      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="flex-1">Test password (developer mode)</span>
                      <button type="button" onClick={() => void testPassword('copy')} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-medium ring-1 ring-amber-200 hover:bg-amber-100">
                        {testCopied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />} {testCopied ? 'Copied' : 'Copy'}
                      </button>
                      <button type="button" onClick={() => void testPassword('fill')} className="rounded-md bg-white px-2 py-0.5 font-medium ring-1 ring-amber-200 hover:bg-amber-100">Fill</button>
                    </div>
                  )}
                  {error && <ErrorNote text={error} />}
                  <button type="submit" disabled={busy || offline || !password} className={submitCls}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {busy ? 'Signing in…' : isProctor ? 'Sign in & verify identity' : 'Sign in & start checks'}
                  </button>
                  <p className="mt-4 flex items-start gap-2 text-xs text-muted">
                    <MailCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {isProctor ? 'Next: face verification and a code sent to your email.' : 'This link will be locked to this computer after you sign in.'}
                  </p>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        </main>
      </div>
    </div>
  )
}

const submitCls =
  'mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-cta px-4 py-3 text-sm font-semibold text-ink shadow-sm transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'

function ErrorNote({ text }: { text: string }) {
  return (
    <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </div>
  )
}
