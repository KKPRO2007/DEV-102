import { Suspense, lazy, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { Bug, Check, Copy, Eye, Link2, RotateCcw, Zap } from 'lucide-react';
import { DesktopLayout } from './components/DesktopLayout';
import { ALL_VIOLATION_CODES, APP_STEPS, VIOLATION_META } from './lib/types';
import type { AppStep, ViolationCode } from './lib/types';
import { STEP_INDEX, useApp } from './lib/store';
import { currentLogin, DEMO_MENTOR, devApi, signInStaff } from './lib/api';
import { onAuthLost, setToken } from './lib/http';
import { getProctor } from './lib/proctorMock';
import { Badge, Button, ErrorBoundary, ScreenSkeleton } from './lib/ui';
import type { SubmitSummary } from './screens/Exam';
import { backgroundFor, getTimeTheme } from './lib/theme';

// Each screen is a default export with no props; navigation goes through useApp().
const Login = lazy(() => import('./screens/Login'));
const SystemCheck = lazy(() => import('./screens/SystemCheck'));
const FaceVerify = lazy(() => import('./screens/FaceVerify'));
const ScreenShareConsent = lazy(() => import('./screens/ScreenShareConsent'));
const Exam = lazy(() => import('./screens/Exam'));
const Submitted = lazy(() => import('./screens/Submitted'));
const MentorMonitor = lazy(() => import('./screens/MentorMonitor'));

// The consent screen covers both the consent list and the entire-screen share request.
// Each screen takes different props; screenProps below picks the right ones per step.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCREENS: Record<AppStep, LazyExoticComponent<ComponentType<any>>> = {
  login: Login,
  systemCheck: SystemCheck,
  faceVerify: FaceVerify,
  consent: ScreenShareConsent,
  exam: Exam,
  submitted: Submitted,
};

const DEV_TOOLS = import.meta.env.DEV || new URLSearchParams(window.location.search).has('dev');

const transition: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 32, scale: 0.99 }),
  center: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.28, ease: 'easeOut' } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -24, transition: { duration: 0.18, ease: 'easeIn' } }),
};

/** During the exam: a lost-focus lock overlay, and screen-share stops reported through the exam screen. */
function useProctorBridge(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const proctor = getProctor();
    const offViolation = proctor.events.onViolation((event) => {
      // Proctor-only exams show the candidate nothing; the event still reaches the proctor.
      if (event.code === 'WINDOW_BLUR' && !useApp.getState().exam?.settings.proctorOnly) useApp.getState().setLock(event.message ?? 'The exam window lost focus.');
    });
    const offScreen = proctor.screen.onEnded(() => reportViolation('SCREEN_SHARE_STOPPED'));
    return () => {
      offViolation();
      offScreen();
      void proctor.screen.stop();
    };
  }, [active]);
}

/** Soft, blurred role background behind the pre-exam check screens. */
function ScreenBackdrop({ proctor }: { proctor: boolean }) {
  const src = backgroundFor(proctor ? 'proctor' : 'student', getTimeTheme(new Date()));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <img src={src} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl" onError={(e) => (e.currentTarget.style.display = 'none')} />
      <div className="absolute inset-0 bg-white/80" />
    </div>
  );
}

/** Hands a violation to the exam screen, which reports it to the API like any real detection. */
const reportViolation = (code: ViolationCode): void => {
  window.dispatchEvent(new CustomEvent('proctor:report', { detail: { code } }));
};

function useDevHotkey(): void {
  const toggle = useApp((s) => s.toggleDevPanel);
  useEffect(() => {
    if (!DEV_TOOLS) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}

const QUICK_CODES: ViolationCode[] = ['MULTIPLE_FACES', 'GAZE_AWAY', 'AI_SITE_OPENED', 'WINDOW_BLUR', 'CLIPBOARD_USE', 'VM_DETECTED'];

/**
 * Developer panel (dev builds only): open any screen directly with real server state behind it,
 * switch to the proctor monitor, and inject violations into the running exam.
 */
function DevPanel() {
  const open = useApp((s) => s.devPanelOpen);
  const toggle = useApp((s) => s.toggleDevPanel);
  const step = useApp((s) => s.step);
  const route = useApp((s) => s.route);
  const auth = useApp((s) => s.auth);
  const pushToast = useApp((s) => s.pushToast);
  const [code, setCode] = useState<ViolationCode>('MULTIPLE_FACES');
  const [busy, setBusy] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<{ role: 'CANDIDATE' | 'MENTOR'; link: string; password: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  if (!DEV_TOOLS) return null;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      pushToast({ tone: 'danger', title: `${label} failed`, description: e instanceof Error ? e.message : 'Is the API running?' });
    } finally {
      setBusy(null);
    }
  };

  /** Signs in the demo candidate when needed, so every step has a real session to work with. */
  const ensureCandidate = async () => {
    const s = useApp.getState();
    if (s.auth?.role === 'CANDIDATE' && s.route === 'candidate') return;
    const { auth: a, exam } = await devApi.signInDemoCandidate();
    s.signIn(a, exam);
  };

  const openStep = (target: AppStep) =>
    run(`Open ${target}`, async () => {
      if (target === 'login') {
        setToken(null);
        useApp.getState().reset();
        return;
      }
      await ensureCandidate();
      if (target === 'exam' || target === 'submitted') await devApi.verifyMe();
      useApp.getState().jump(target);
    });

  const openMentorView = () =>
    run('Proctor view', async () => {
      useApp.getState().openMentor(await signInStaff(DEMO_MENTOR));
    });

  /** Copies a fresh demo join link, then returns to the paste-link screen. */
  const copyInviteLink = (role: 'CANDIDATE' | 'MENTOR') =>
    run('Join link', async () => {
      const { link, password } = await devApi.inviteLink(role);
      await navigator.clipboard.writeText(link);
      useApp.getState().reset();
      setLastLink({ role, link, password });
      pushToast({ tone: 'success', title: `${role === 'MENTOR' ? 'Proctor' : 'Candidate'} link copied`, description: 'Paste it, then copy the password here or on the password step.' });
    });

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const inject = (target: ViolationCode) => {
    if (step === 'exam' && route === 'candidate') reportViolation(target);
    else pushToast({ tone: 'info', title: 'Open the exam first', description: 'Violations are recorded against the running exam session.' });
  };

  return (
    <div className="fixed bottom-11 right-4 z-[85] flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.section
            aria-label="Developer panel"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            className="scroll-thin max-h-[70vh] w-[340px] overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-pop"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Developer panel</h2>
              <Badge tone="neutral">Ctrl+Shift+D</Badge>
            </div>
            <p className="mt-1 text-[11px] text-muted">{auth ? `Signed in as ${auth.name} (${auth.role.toLowerCase()})` : 'Not signed in'} · {getProctor().native ? 'native bridge' : 'browser mode'}</p>

            <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Open any screen</h3>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {APP_STEPS.map((s) => (
                <Button key={s.id} size="sm" disabled={busy !== null} variant={route === 'candidate' && step === s.id ? 'primary' : 'secondary'} onClick={() => void openStep(s.id)}>
                  {STEP_INDEX[s.id] + 1}. {s.label}
                </Button>
              ))}
              <Button size="sm" disabled={busy !== null} variant={route === 'mentor' ? 'primary' : 'secondary'} icon={<Eye className="h-3.5 w-3.5" aria-hidden />} onClick={() => void openMentorView()}>
                Proctor monitor
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">Signs in the demo candidate and marks face and OTP as verified when a screen needs it.</p>

            <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Join links</h3>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Button size="sm" variant="secondary" disabled={busy !== null} icon={<Link2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => void copyInviteLink('CANDIDATE')}>Candidate link</Button>
              <Button size="sm" variant="secondary" disabled={busy !== null} icon={<Link2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => void copyInviteLink('MENTOR')}>Proctor link</Button>
            </div>
            {lastLink && (
              <div className="mt-2 space-y-1.5 rounded-xl border border-border bg-soft p-2.5 text-[11px]">
                <p className="font-semibold text-text">{lastLink.role === 'MENTOR' ? 'Proctor' : 'Candidate'} test sign-in</p>
                {([
                  ['link', 'Link', lastLink.link],
                  ['password', 'Password', lastLink.password],
                ] as const).map(([key, label, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-muted">{label}</span>
                    <code className="min-w-0 flex-1 truncate rounded bg-surface px-1.5 py-0.5">{value}</code>
                    <button type="button" onClick={() => void copyText(key, value)} aria-label={`Copy ${label.toLowerCase()}`} className="rounded-md p-1 text-muted hover:bg-surface hover:text-primary">
                      {copied === key ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Inject a violation</h3>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
              <label className="sr-only" htmlFor="dev-code">Violation code</label>
              <select id="dev-code" value={code} onChange={(e) => setCode(e.target.value as ViolationCode)} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs">
                {ALL_VIOLATION_CODES.map((c) => (
                  <option key={c} value={c}>
                    {VIOLATION_META[c].label} ({VIOLATION_META[c].severity})
                  </option>
                ))}
              </select>
              <Button size="sm" variant="cta" icon={<Zap className="h-3.5 w-3.5" aria-hidden />} onClick={() => inject(code)}>
                Send
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_CODES.map((c) => (
                <button key={c} type="button" onClick={() => inject(c)} className="rounded-full border border-border px-2 py-1 text-[11px] text-muted transition hover:border-accent hover:text-accent">
                  {VIOLATION_META[c].label}
                </button>
              ))}
            </div>

            <Button size="sm" variant="ghost" className="mt-4 w-full" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => void openStep('login')}>
              Sign out and reset
            </Button>
          </motion.section>
        )}
      </AnimatePresence>
      <button
        type="button"
        aria-label={open ? 'Close developer panel' : 'Open developer panel'}
        aria-expanded={open}
        onClick={() => toggle()}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-pop transition hover:bg-primary-600"
      >
        <Bug className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

export default function App() {
  const step = useApp((s) => s.step);
  const route = useApp((s) => s.route);
  const mentor = route === 'mentor';
  const viewKey = mentor ? 'mentor' : step;
  const index = mentor ? 0 : STEP_INDEX[step];
  const previous = useRef(index);
  const direction = index >= previous.current ? 1 : -1;

  useEffect(() => {
    previous.current = index;
  }, [index]);

  useEffect(() => {
    document.getElementById('boot-splash')?.remove();
  }, []);

  useProctorBridge(!mentor && step === 'exam');
  useDevHotkey();

  // A revoked token (signed in elsewhere, expired) sends the candidate back to sign in.
  useEffect(() => onAuthLost(() => {
    const s = useApp.getState();
    if (s.step === 'exam' || s.step === 'submitted') return; // the exam screen handles this itself
    s.pushToast({ tone: 'warning', title: 'You were signed out', description: 'Sign in again to continue.' });
    s.signOut();
  }), []);

  const Screen = mentor ? MentorMonitor : SCREENS[step];
  const auth = useApp((s) => s.auth);
  const exam = useApp((s) => s.exam);
  const go = useApp((s) => s.go);
  const signIn = useApp((s) => s.signIn);
  const [submission, setSubmission] = useState<SubmitSummary | null>(null);

  const screenProps = mentor
    ? {}
    : step === 'login'
      ? { onLoggedIn: () => {
          const login = currentLogin();
          if (!login) return;
          if (login.auth.role === 'MENTOR') {
            useApp.getState().startProctorChecks(login.auth, login.exam);
            return;
          }
          signIn(login.auth, login.exam);
          void go('systemCheck');
        } }
      : step === 'systemCheck'
        ? { onContinue: () => void go('faceVerify'), onBack: () => void go('login') }
        : step === 'faceVerify'
          ? {
              // A proctor skips the system check and consent: after face and OTP the monitor opens.
              onVerified: () => (auth?.role === 'MENTOR' ? useApp.getState().openMentor(auth) : void go('consent')),
              onBack: () => void go(auth?.role === 'MENTOR' ? 'login' : 'systemCheck'),
              notify: (message: string) => useApp.getState().pushToast({ tone: 'info', title: message }) }
          : step === 'consent'
            ? { onGranted: () => void go('exam'), onBack: () => void go('faceVerify'), notify: (message: string) => useApp.getState().pushToast({ tone: 'info', title: message }) }
            : step === 'exam'
              ? { examId: exam?.id ?? '', userId: auth?.id ?? '', onSubmitted: (summary: SubmitSummary) => { setSubmission(summary); void go('submitted'); } }
              : step === 'submitted'
                ? {
                    variant: submission?.disqualified
                      ? 'DISQUALIFIED'
                      : submission?.autoSubmitted
                        ? 'AUTO_SUBMITTED'
                        : 'SUBMITTED',
                    examTitle: exam?.title ?? 'Exam',
                    examCode: exam?.code ?? 'UNKNOWN',
                    candidateName: auth?.name ?? 'Candidate',
                    submittedAt: submission?.submittedAt,
                    reason: submission?.reason,
                    referenceNo: submission?.receiptId,
                    onClose: () => {
                      const win = window as unknown as { proctor?: { window?: { close?: () => void } } };
                      if (win.proctor?.window?.close) {
                        void win.proctor.window.close();
                      } else {
                        setToken(null);
                        useApp.getState().reset();
                      }
                    },
                  }
                : {};

  return (
    <>
      <DesktopLayout>
        {!mentor && (step === 'systemCheck' || step === 'faceVerify' || step === 'consent') && <ScreenBackdrop proctor={auth?.role === 'MENTOR'} />}
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div key={viewKey} custom={direction} variants={transition} initial="enter" animate="center" exit="exit" className="scroll-thin absolute inset-0 overflow-y-auto overflow-x-hidden">
            <ErrorBoundary resetKey={viewKey}>
              <Suspense fallback={<ScreenSkeleton />}>
                <Screen {...screenProps} />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </DesktopLayout>
      <DevPanel />
    </>
  );
}
