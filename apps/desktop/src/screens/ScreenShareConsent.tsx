import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Loader2, Monitor, MonitorX, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { ConsentList, NOT_MONITORED_ITEMS, monitoredItems } from '../components/ConsentList'
import { useApp } from '../lib/store'

type Notify = (kind: 'success' | 'error' | 'info', message: string) => void
type Stage = 'consent' | 'picker' | 'review'

interface ScreenSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** data: URL thumbnail */
  thumbnail: string
}

/** Optional Electron bridge; when absent we use getDisplayMedia. */
interface ScreenBridge {
  getScreenSources?: () => Promise<ScreenSource[]>
}
const getBridge = (): ScreenBridge | undefined => (window as unknown as { proctor?: ScreenBridge }).proctor

interface Check { id: string; label: string; ok: boolean; detail: string }

interface ScreenShareConsentProps {
  onGranted: (stream: MediaStream, consentedAt: string) => void
  onBack?: () => void
  notify?: Notify
}

type SurfaceSettings = MediaTrackSettings & { displaySurface?: string }

function validate(stream: MediaStream, declaredScreen: boolean): Check[] {
  const track = stream.getVideoTracks()[0]
  if (!track) return [{ id: 'track', label: 'Video track', ok: false, detail: 'No video was received.' }]
  const s: SurfaceSettings = track.getSettings()
  const dpr = window.devicePixelRatio || 1
  const wantW = Math.round(window.screen.width * dpr)
  const wantH = Math.round(window.screen.height * dpr)
  const w = s.width ?? 0
  const h = s.height ?? 0
  const extended = (window.screen as Screen & { isExtended?: boolean }).isExtended === true
  return [
    { id: 'live', label: 'Sharing is active', ok: track.readyState === 'live', detail: track.readyState === 'live' ? 'Stream is live.' : 'The stream has ended.' },
    { id: 'surface', label: 'Entire screen selected', ok: declaredScreen || s.displaySurface === 'monitor', detail: declaredScreen || s.displaySurface === 'monitor' ? 'A full display is being shared.' : `You shared a ${s.displaySurface ?? 'window or tab'}. Choose "Entire screen".` },
    { id: 'size', label: 'Full resolution captured', ok: w >= wantW * 0.85 && h >= wantH * 0.85, detail: `${w}×${h} captured of ${wantW}×${wantH}.` },
    { id: 'single', label: 'Only one display connected', ok: !extended, detail: extended ? 'A second monitor is connected. Disconnect it and restart this step.' : 'Single display detected.' },
  ]
}

export default function ScreenShareConsent({ onGranted, onBack, notify }: ScreenShareConsentProps) {
  const audioMonitoring = useApp((s) => s.exam?.settings.audioMonitoring ?? false)
  const liveAudio = useApp((s) => Boolean(s.exam?.settings.liveAudio))
  const [agreed, setAgreed] = useState(false)
  const [stage, setStage] = useState<Stage>('consent')
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [sourceError, setSourceError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<Check[]>([])
  const [ended, setEnded] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const handedOff = useRef(false)
  const consentedAt = useRef('')

  const say = useCallback<Notify>((k, m) => notify?.(k, m), [notify])

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }
  useEffect(() => () => { if (!handedOff.current) releaseStream() }, [])

  const loadSources = useCallback(async () => {
    setSources(null)
    setSourceError(false)
    try {
      const list = await getBridge()?.getScreenSources?.()
      setSources(list ?? [])
    } catch {
      setSourceError(true)
    }
  }, [])

  const begin = async () => {
    if (!agreed) return
    consentedAt.current = new Date().toISOString()
    setError(null)
    if (getBridge()?.getScreenSources) {
      setStage('picker')
      await loadSources()
    } else {
      await capture()
    }
  }

  const capture = async (sourceId?: string) => {
    setBusy(true)
    setError(null)
    releaseStream()
    try {
      let stream: MediaStream
      if (sourceId) {
        const constraints = { audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } }
        stream = await navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints)
      } else {
        const dpr = window.devicePixelRatio || 1
        const opts = { audio: false, video: { displaySurface: 'monitor', width: { ideal: Math.round(window.screen.width * dpr) }, height: { ideal: Math.round(window.screen.height * dpr) } } }
        stream = await navigator.mediaDevices.getDisplayMedia(opts as unknown as DisplayMediaStreamOptions)
      }
      streamRef.current = stream
      setEnded(false)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setEnded(true)
        setChecks((c) => c.map((x) => (x.id === 'live' ? { ...x, ok: false, detail: 'You stopped sharing.' } : x)))
        say('error', 'Screen sharing stopped. Share your screen again to continue.')
      })
      setChecks(validate(stream, Boolean(sourceId)))
      setStage('review')
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')
      setError(denied ? 'Screen sharing was cancelled or blocked. It is required to take this exam.' : 'Your system could not start screen capture. Restart the app and try again.')
      if (!sourceId) setStage('consent')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (stage === 'review' && previewRef.current && streamRef.current) previewRef.current.srcObject = streamRef.current
  }, [stage, checks])

  const allOk = checks.length > 0 && checks.every((c) => c.ok) && !ended

  const proceed = () => {
    if (!streamRef.current || !allOk) return
    handedOff.current = true
    say('success', 'Screen sharing verified')
    onGranted(streamRef.current, consentedAt.current)
  }

  const reshare = () => {
    releaseStream()
    setChecks([])
    setSelected(null)
    if (getBridge()?.getScreenSources) { setStage('picker'); void loadSources() } else setStage('consent')
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-8">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-text">Consent and screen sharing</h1>
        <p className="mt-1 text-muted">Review exactly what is monitored, agree, then share your entire screen.</p>
      </header>

      <AnimatePresence mode="wait">
        {stage === 'consent' && (
          <motion.div key="consent" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="grid gap-6 lg:grid-cols-2">
              <ConsentList title="What is monitored" tone="monitored" items={monitoredItems(audioMonitoring, liveAudio)} />
              <ConsentList title="What is not monitored" tone="private" items={NOT_MONITORED_ITEMS} />
            </div>
            <div className="mt-6 rounded-2xl border border-border bg-white p-5 shadow-sm">
              <label className="flex cursor-pointer items-start gap-3 text-sm text-text">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} aria-required="true" className="mt-0.5 h-5 w-5 rounded border-border accent-primary-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30" />
                <span>I have read the list above and consent to this monitoring for the duration of this exam. I understand that sharing a window or tab instead of my entire screen is not accepted.</span>
              </label>
              {error && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-danger"><AlertTriangle className="h-4 w-4" />{error}</p>}
              <div className="mt-4 flex items-center justify-between gap-3">
                {onBack ? <button onClick={onBack} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text hover:bg-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30">Back</button> : <span />}
                <button onClick={() => void begin()} disabled={!agreed || busy} className="flex items-center gap-2 rounded-xl bg-cta px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:brightness-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-cta/40 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}Share entire screen
                </button>
              </div>
              {!agreed && <p className="mt-2 text-right text-xs text-muted">Tick the consent box to continue.</p>}
            </div>
          </motion.div>
        )}

        {stage === 'picker' && (
          <motion.div key="picker" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="font-heading text-lg font-semibold text-text">Choose the screen to share</h2>
            <p className="mb-4 text-sm text-muted">Only a full screen is accepted. Windows are shown for reference but cannot be selected.</p>
            {sources === null && !sourceError && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-soft" />)}
              </div>
            )}
            {sourceError && (
              <div role="alert" className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-text">
                <span className="flex items-center gap-2"><XCircle className="h-5 w-5 text-danger" />Could not list your screens.</span>
                <button onClick={() => void loadSources()} className="flex items-center gap-1 font-semibold text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"><RefreshCw className="h-4 w-4" />Retry</button>
              </div>
            )}
            {sources && sources.length === 0 && (
              <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center text-muted"><MonitorX className="h-8 w-8" />No screens found. Check your display connection.</div>
            )}
            {sources && sources.length > 0 && (
              <div role="radiogroup" aria-label="Available screens" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sources.map((s) => {
                  const isScreen = s.kind === 'screen'
                  const on = selected === s.id
                  return (
                    <button key={s.id} role="radio" aria-checked={on} disabled={!isScreen} onClick={() => setSelected(s.id)} className={`overflow-hidden rounded-xl border text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 ${on ? 'border-accent ring-2 ring-accent/30' : 'border-border'} ${isScreen ? 'hover:shadow-md' : 'cursor-not-allowed opacity-50'}`}>
                      <img src={s.thumbnail} alt={`Preview of ${s.name}`} className="h-32 w-full bg-slate-100 object-cover" />
                      <div className="flex items-center justify-between px-3 py-2 text-sm"><span className="truncate font-semibold text-text">{s.name}</span><span className="text-xs text-muted">{isScreen ? 'Screen' : 'Window (not allowed)'}</span></div>
                    </button>
                  )
                })}
              </div>
            )}
            {error && <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-danger"><AlertTriangle className="h-4 w-4" />{error}</p>}
            <div className="mt-6 flex justify-between">
              <button onClick={() => setStage('consent')} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text hover:bg-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30">Back</button>
              <button onClick={() => selected && void capture(selected)} disabled={!selected || busy} className="flex items-center gap-2 rounded-xl bg-cta px-6 py-2.5 text-sm font-semibold text-slate-900 hover:brightness-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-cta/40 disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Share selected screen
              </button>
            </div>
          </motion.div>
        )}

        {stage === 'review' && (
          <motion.div key="review" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="overflow-hidden rounded-2xl bg-slate-900 shadow-xl ring-1 ring-border">
              <video ref={previewRef} autoPlay muted playsInline className="aspect-video w-full object-contain" aria-label="Preview of your shared screen" />
            </div>
            <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
              <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-text"><ShieldCheck className="h-5 w-5 text-primary-600" />Verifying your share</h2>
              <ul className="mt-4 space-y-3" aria-live="polite">
                {checks.map((c) => (
                  <li key={c.id} className="flex gap-3 text-sm">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />}
                    <span><span className="block font-semibold text-text">{c.label}</span><span className="text-muted">{c.detail}</span></span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-col gap-2">
                <button onClick={proceed} disabled={!allOk} className="rounded-xl bg-cta px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:brightness-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-cta/40 disabled:cursor-not-allowed disabled:opacity-50">Continue to exam</button>
                <button onClick={reshare} className="flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-text hover:bg-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30"><RefreshCw className="h-4 w-4" />Share a different screen</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
