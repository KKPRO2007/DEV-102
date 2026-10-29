'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { homeFor, useSession } from '@/lib/session';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Activity, ArrowRight, Building2, Download, Eye, Fingerprint, Globe, Link2, Menu, MonitorCheck, ScanFace, ShieldCheck, Sparkles, Timer, UserCheck, X } from 'lucide-react';
import { OrgBackdrop } from '@/components/layout/OrgBackdrop';
import { OPTIONS, riskTone, useExamStory } from './examStory';

const ROLE_HOME_LABEL = { ADMIN: 'Organization panel', MENTOR: 'Live monitor', CANDIDATE: 'My exam' } as const;

/** Signed-in visitors get a link to their dashboard instead of "Log in" (read after mount to avoid hydration mismatch). */
function useAccountLink(): { href: string; label: string } {
  const user = useSession((st) => st.user);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && user ? { href: homeFor(user.role), label: ROLE_HOME_LABEL[user.role] } : { href: '/login', label: 'Log in' };
}

const NAV = [
  { href: '#journey', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '/security', label: 'Security' },
  { href: '/download', label: 'Download App' },
];

/** The logo is blue on transparent, so it sits on a white badge to stay visible over the hero image. */
function LogoMark() {
  const [broken, setBroken] = useState(false);
  return (
    <span className="grid h-11 w-11 place-items-center rounded-xl bg-white shadow-lg shadow-black/20 ring-1 ring-white/60">
      {broken ? (
        <span className="font-heading text-lg font-bold text-primary">W</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/images/logo.png" alt="Where U Elevate" className="h-9 w-9 object-contain" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const account = useAccountLink();
  return (
    <header className="relative z-20">
      <nav aria-label="Primary" className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" aria-label="Where U Elevate home">
          <LogoMark />
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="font-heading text-sm font-semibold text-white">Smart Proctor</span>
            <span className="text-[11px] font-medium text-white/70">by Where U Elevate</span>
          </span>
        </Link>
        <ul className="hidden items-center gap-8 md:flex">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="rounded-md text-sm font-medium text-white/85 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden items-center gap-3 md:flex">
          <Link href={account.href} className="rounded-xl px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/40 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            {account.label}
          </Link>
          <Link href="/login?role=organization" className="inline-flex items-center gap-2 rounded-xl bg-cta px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-black/10 transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <Building2 className="h-4 w-4" aria-hidden /> For Organization
          </Link>
        </div>
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-xl text-white ring-1 ring-white/30 md:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mx-5 rounded-2xl bg-white p-3 shadow-2xl md:hidden"
          >
            {[...NAV, account].map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-sm font-medium text-text hover:bg-soft">
                {n.label}
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

/** Subtle network of dots and connecting lines; coordinates are fixed so SSR and client agree. */
const NODES: [number, number][] = [
  [60, 80], [180, 40], [300, 120], [430, 60], [560, 150], [690, 70], [820, 130], [950, 50], [1080, 110],
  [1200, 60], [1320, 140], [110, 220], [260, 260], [400, 200], [540, 280], [700, 230], [860, 290], [1010, 220], [1150, 270], [1290, 230],
];
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [0, 11], [2, 12], [3, 13], [4, 14], [5, 15],
  [6, 16], [8, 17], [9, 18], [10, 19], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19],
];
function NetworkPattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-15" viewBox="0 0 1400 400" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {EDGES.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={NODES[a]?.[0]} y1={NODES[a]?.[1]} x2={NODES[b]?.[0]} y2={NODES[b]?.[1]} stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
      ))}
      {NODES.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 4 : 2.5} fill="white" />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- live exam showcase */

/** Flat version of the hero visual, used when WebGL is unavailable. */
function ExamShowcase() {
  const reduce = useReducedMotion();
  const { s, clock } = useExamStory(reduce);

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.2 }}
      className="relative w-full max-w-xl"
      role="img"
      aria-label="Illustration of the exam app: a candidate answers a question, opens ChatGPT in a sandbox tab, the typed question is flagged, the risk score rises and a proctor reviews it"
    >
      <div className="overflow-hidden rounded-3xl bg-white/95 shadow-[0_30px_80px_-20px_rgba(2,8,23,0.6)] ring-1 ring-white/60 backdrop-blur-xl">
        {/* Window bar with the sandbox tab strip */}
        <div className="flex items-center gap-2 border-b border-border bg-soft/80 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="ml-2 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-primary shadow-sm ring-1 ring-border">Exam · CPA-26</span>
          <AnimatePresence>
            {s.tab && (
              <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-ink ring-1 ring-red-200">
                <Globe className="h-3 w-3 text-danger" aria-hidden /> chatgpt.com
              </motion.span>
            )}
          </AnimatePresence>
          <span className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 font-mono text-[11px] font-semibold text-primary">
            <Timer className="h-3 w-3" aria-hidden /> {clock}
          </span>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-[1fr_9.5rem]">
          {/* Question */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Question 7 of 30</p>
            <p className="mt-1 font-heading text-[15px] font-semibold leading-snug text-ink">What is the average time complexity of binary search on a sorted array?</p>
            <ul className="mt-3 space-y-2">
              {OPTIONS.map((o, i) => (
                <li key={o} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${i === 3 ? 'border-primary-600 bg-primary-50 text-primary' : 'border-border text-ink'}`}>
                  <span className={`grid h-4 w-4 place-items-center rounded-full border ${i === 3 ? 'border-primary-600 bg-primary-600' : 'border-slate-300'}`} aria-hidden>
                    {i === 3 && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  {o}
                </li>
              ))}
            </ul>
          </div>

          {/* Live signals */}
          <div className="space-y-3">
            <div className="rounded-2xl border border-border p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Activity className="h-3 w-3" aria-hidden /> Risk</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-ink">{s.risk}</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
                <motion.div className={`h-full rounded-full ${riskTone(s.risk)}`} animate={{ width: `${s.risk}%` }} transition={{ type: 'spring', stiffness: 70, damping: 16 }} />
              </div>
            </div>
            {[
              [ScanFace, 'Face verified'],
              [MonitorCheck, 'Kiosk locked'],
              [Link2, 'Link on this PC'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof ScanFace;
              return (
                <p key={label as string} className="flex items-center gap-2 text-xs font-medium text-ink">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-success/10 text-success"><I className="h-3.5 w-3.5" aria-hidden /></span>
                  {label as string}
                </p>
              );
            })}
          </div>
        </div>

        {/* Violation and the human decision */}
        <div className="min-h-[4.25rem] border-t border-border bg-soft/60 px-5 py-3">
          <AnimatePresence mode="wait">
            {!s.alert ? (
              <motion.p key="calm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-xs text-muted">
                <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> All signals normal. Answers autosaved.
              </motion.p>
            ) : (
              <motion.div key={s.verdict ? 'verdict' : 'alert'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-2.5 text-xs">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${s.verdict ? 'bg-primary-50 text-primary' : 'bg-danger/10 text-danger'}`}>
                  {s.verdict ? <UserCheck className="h-4 w-4" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                </span>
                <span className="min-w-0">
                  <b className="block text-ink">{s.verdict ? 'Proctor reviewing the evidence' : 'AI query detected · critical'}</b>
                  <span className="block truncate text-muted">{s.verdict ? 'Confirm or overrule, with a reason. Overruling reinstates the candidate.' : 'Typed on chatgpt.com: "time complexity of binary search"'}</span>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <motion.div
        animate={reduce ? undefined : { y: [0, -6, 0] }}
        transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
        className="absolute -left-8 -top-6 hidden items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-xl ring-1 ring-black/5 lg:flex"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-success/15 text-success"><Fingerprint className="h-4 w-4" aria-hidden /></span>
        <span className="text-xs"><b className="block text-text">Face + OTP passed</b><span className="text-muted">Before the first question</span></span>
      </motion.div>
      <motion.div
        animate={reduce ? undefined : { y: [0, 6, 0] }}
        transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut' }}
        className="absolute -bottom-5 -right-4 hidden items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-xl ring-1 ring-black/5 lg:flex"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-cta/20 text-amber-700"><Eye className="h-4 w-4" aria-hidden /></span>
        <span className="text-xs"><b className="block text-text">Proctor sees it live</b><span className="text-muted">With the typed query</span></span>
      </motion.div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- hero visual */

// three.js is only downloaded on the client, and only for visitors whose browser has WebGL.
const Hero3D = dynamic(() => import('./Hero3D'), { ssr: false, loading: () => <div className="h-[400px] w-full max-w-[600px] sm:h-[470px]" aria-hidden /> });

function HeroVisual() {
  const reduce = useReducedMotion();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  // Rendering pauses while the hero is scrolled out of view.
  const box = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => setOnScreen(Boolean(e?.isIntersecting)), { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, [webgl]);
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      setWebgl(Boolean(c.getContext('webgl2') ?? c.getContext('webgl')));
    } catch {
      setWebgl(false);
    }
  }, []);

  if (webgl === null) return <div className="h-[400px] w-full max-w-[600px] sm:h-[470px]" aria-hidden />;
  if (!webgl) return <ExamShowcase />;
  return (
    <div ref={box} className="relative w-full max-w-[600px]">
      {/* Frosted glass panel with a soft glow and light beams behind the model */}
      <div className="pointer-events-none absolute inset-x-2 inset-y-6 overflow-hidden rounded-[2.5rem] bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_30px_80px_-30px_rgba(2,8,23,.6)] ring-1 ring-white/25 backdrop-blur-2xl" aria-hidden>
        <div className="absolute -left-10 top-1/4 h-64 w-64 rounded-full bg-sky-400/30 blur-3xl" />
        <div className="absolute -right-8 bottom-6 h-56 w-56 rounded-full bg-cta/25 blur-3xl" />
        <div className="absolute left-1/2 top-[62%] h-24 w-[70%] -translate-x-1/2 rounded-full bg-primary-600/40 blur-2xl" />
        <div className="absolute -top-1/4 left-[18%] h-[150%] w-16 rotate-[24deg] bg-gradient-to-b from-white/25 via-white/5 to-transparent blur-md" />
        <div className="absolute -top-1/4 left-[46%] h-[150%] w-8 rotate-[24deg] bg-gradient-to-b from-white/20 via-white/5 to-transparent blur-md" />
      </div>
      <Hero3D reduce={Boolean(reduce)} active={onScreen} />
    </div>
  );
}

/* ---------------------------------------------------------------- hero */

const TRUST = [
  { icon: Link2, label: 'Personal links, one computer each' },
  { icon: ScanFace, label: 'Face and OTP for candidates and proctors' },
  { icon: ShieldCheck, label: 'Kiosk-mode secure exam app' },
  { icon: Activity, label: 'Live monitoring with human review' },
];

export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#06142e] text-white">
      <OrgBackdrop />
      <NetworkPattern />
      <Nav />

      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-14 px-5 pb-40 pt-10 lg:grid-cols-[1.05fr_1fr] lg:px-8 lg:pb-48 lg:pt-16">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold tracking-wide ring-1 ring-white/25 backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5 text-cta" aria-hidden /> AI proctoring with a human in the loop
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="font-heading text-4xl font-bold leading-[1.1] tracking-tight text-white drop-shadow-sm sm:text-5xl lg:text-[3.5rem]"
          >
            Conduct online exams that <span className="text-cta">cannot be gamed.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-white/85"
          >
            Your organization picks who sits and who proctors. Each person gets a personal link for the secure exam app, proves who they are, and every
            website and AI query is logged, so proctors step in the moment something looks wrong.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="mt-9 flex flex-wrap items-center gap-4"
          >
            <Link href="/download" className="group inline-flex items-center gap-2 rounded-xl bg-cta px-6 py-3.5 text-sm font-bold text-slate-900 shadow-xl shadow-black/15 transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <Download className="h-4 w-4" aria-hidden /> Download the app
            </Link>
            <Link href="/login?role=organization" className="group inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-primary shadow-lg transition hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <Building2 className="h-4 w-4" aria-hidden /> For organizations <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link href="/login?role=proctor" className="rounded-xl px-2 py-3.5 text-sm font-semibold text-white/90 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              Proctor sign in
            </Link>
          </motion.div>
        </div>
        <div className="flex justify-center lg:justify-end"><HeroVisual /></div>
      </div>

      <div className="relative z-10 mx-auto -mb-1 max-w-7xl px-5 pb-16 lg:px-8">
        <ul className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4" aria-label="Highlights">
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-3 text-sm font-medium text-white/90">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur"><Icon className="h-4 w-4" aria-hidden /></span>
              {label}
            </li>
          ))}
        </ul>
      </div>

      <svg className="absolute bottom-0 left-0 z-0 w-full text-white" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden>
        <path fill="currentColor" d="M0,64 C240,120 480,120 720,84 C960,48 1200,8 1440,56 L1440,120 L0,120 Z" />
      </svg>
    </section>
  );
}
