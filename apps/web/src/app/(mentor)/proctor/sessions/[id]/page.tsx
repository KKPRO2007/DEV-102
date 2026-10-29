"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, ArrowLeft, CheckCircle2, Gavel, Loader2, MonitorPlay, Radio, RefreshCw, RotateCcw, ShieldCheck, ThumbsUp, UserX, X, type LucideIcon } from "lucide-react";
import type { Session, Violation } from "@/lib/types";
import { ApiError, getSessionDetail, pollLiveEvent, submitFinalDecision, submitViolationReview, type FinalDecision, type FinalOutcome, type ReviewRecord, type RiskPoint, type SessionDetail } from "@/lib/api";
import { effectiveVerdict, useMentorStore } from "@/lib/mentorStore";
import { joinExam, subscribe, watchScreen, type ScreenState } from "@/lib/realtime";
import { MentorShell, Avatar, StatusChip } from "@/components/mentor/MentorShell";
import { ViolationTimeline } from "@/components/mentor/ViolationTimeline";
import { BrowsingLogTable } from "@/components/mentor/BrowsingLogTable";
import { EvidenceGallery, type EvidenceItem } from "@/components/mentor/EvidenceGallery";
import { SeverityChip } from "@/components/mentor/MentorShell";
import { VIOLATION_LABEL, adjustRisk, formatClock, formatDateTime, riskTone, suggestOutcome, type VerdictOf } from "@/components/mentor/meta";
import { useDialog } from "@/components/mentor/useDialog";

type LoadState = { status: "loading" } | { status: "error"; message: string; retryable: boolean } | { status: "ready"; data: SessionDetail };

const card = "rounded-2xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_12px_32px_-16px_rgba(10,77,166,0.18)]";
const focusRing = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40";

export default function SessionReviewPage() {
  const params = useParams<{ id: string }>();
  return (
    <MentorShell>
      <SessionLoader id={params.id} />
    </MentorShell>
  );
}

function SessionLoader({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getSessionDetail(id)
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: e instanceof Error ? e.message : "Something went wrong.", retryable: e instanceof ApiError ? e.retryable : true });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (state.status === "ready") return <Workspace key={state.data.session.id} detail={state.data} />;

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div role="alert" className={card}>
          <AlertCircle className="mx-auto h-10 w-10 text-danger" aria-hidden />
          <h1 className="mt-3 font-heading text-xl font-semibold">{state.retryable ? "Could not load this session" : "Session not found"}</h1>
          <p className="mt-1 text-sm text-slate-500">{state.message}</p>
          <div className="mt-5 flex justify-center gap-3">
            {state.retryable && (
              <button type="button" onClick={() => setAttempt((a) => a + 1)} className={`inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white ${focusRing}`}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Try again
              </button>
            )}
            <Link href="/proctor" className={`rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-soft ${focusRing}`}>Back to queue</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6" role="status" aria-label="Loading session">
      <div className="h-32 animate-pulse rounded-2xl bg-white" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-[28rem] animate-pulse rounded-2xl bg-white lg:col-span-2" />
        <div className="space-y-6">
          <div className="h-64 animate-pulse rounded-2xl bg-white" />
          <div className="h-56 animate-pulse rounded-2xl bg-white" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- workspace ---------------- */

const TABS = [
  { id: "violations", label: "Violations" },
  { id: "evidence", label: "Evidence" },
  { id: "browsing", label: "Browsing log" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const SCREEN_MESSAGE: Record<ScreenState, string> = {
  connecting: "Connecting to the candidate's screen…",
  live: "Live",
  unavailable: "The candidate's app is not sharing a screen right now.",
  ended: "The screen connection ended.",
};

/** Live view of the candidate's screen over WebRTC; closing it (or leaving the page) hangs up. */
function ScreenViewer({ sessionId, candidateName }: { sessionId: string; candidateName: string }) {
  const [watching, setWatching] = useState(false);
  const [state, setState] = useState<ScreenState>("connecting");
  // Browsers only play sound after a click, so the candidate's microphone starts muted.
  const [listening, setListening] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!watching || !video) return;
    const stop = watchScreen(sessionId, (stream) => { video.srcObject = stream; }, setState);
    return () => {
      stop();
      video.srcObject = null;
    };
  }, [watching, sessionId]);

  if (!watching) {
    return (
      <button type="button" onClick={() => { setState("connecting"); setWatching(true); }} className={`mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-semibold text-primary-600 hover:bg-soft ${focusRing}`}>
        <MonitorPlay className="h-4 w-4" aria-hidden /> Watch screen
      </button>
    );
  }
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-slate-950">
      <div className="flex items-center justify-between gap-3 bg-slate-900 px-3 py-2 text-xs text-white">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          {state === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />}
          {candidateName}&apos;s screen · {SCREEN_MESSAGE[state]}
        </span>
        <button type="button" onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setListening(!v.muted); } }} aria-pressed={listening} className={`rounded-md px-2 py-1 font-semibold hover:bg-white/10 ${focusRing}`}>
          {listening ? "Mute" : "Listen"}
        </button>
        <button type="button" onClick={() => setWatching(false)} aria-label="Stop watching the screen" className={`rounded-md p-1 hover:bg-white/10 ${focusRing}`}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <video ref={videoRef} autoPlay muted playsInline aria-label={`Live screen of ${candidateName}`} className={`aspect-video w-full bg-black object-contain ${state === "live" ? "" : "hidden"}`} />
      {state !== "live" && <p role="status" className="flex aspect-video items-center justify-center gap-2 text-sm text-slate-300">{state === "connecting" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{SCREEN_MESSAGE[state]}</p>}
    </div>
  );
}

function Workspace({ detail }: { detail: SessionDetail }) {
  const { candidate, exam } = detail;
  const reviews = useMentorStore((s) => s.reviews);
  const storedDecision = useMentorStore((s) => s.decisions[detail.session.id]);
  const saveReview = useMentorStore((s) => s.saveReview);
  const saveDecision = useMentorStore((s) => s.saveDecision);
  const toast = useMentorStore((s) => s.toast);

  const [session, setSession] = useState<Session>(detail.session);
  const [violations, setViolations] = useState<Violation[]>(detail.violations);
  const [history, setHistory] = useState<RiskPoint[]>(detail.riskHistory);
  const [tab, setTab] = useState<TabId>("violations");
  const [reviewTarget, setReviewTarget] = useState<Violation | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [snapshot, setSnapshot] = useState<{ image: string; at: string } | null>(null);
  const [browsing, setBrowsing] = useState(detail.browsing);

  useEffect(() => {
    if (session.status !== "LIVE") return;
    const off = subscribe("frame:snapshot", (e) => {
      if (e.sessionId === session.id) setSnapshot({ image: e.image, at: e.at });
    });
    // Sites, AI tools and typed text appear the moment the candidate's app reports them.
    const offBrowsing = subscribe("browsing:new", (e) => {
      if (e.sessionId !== session.id) return;
      setBrowsing((cur) => [...e.entries, ...cur]);
      const ai = e.entries.find((x) => x.flaggedAi);
      if (ai) toast({ tone: "error", title: ai.query ? `Typed on ${ai.title || ai.url}` : `Opened ${ai.title || ai.url}`, description: ai.query ?? ai.url });
    });
    const leave = joinExam(session.examId);
    return () => {
      leave();
      off();
      offBrowsing();
    };
  }, [session.id, session.examId, session.status, toast]);

  const verdictOf = useCallback<VerdictOf>((v) => effectiveVerdict(v, reviews), [reviews]);

  useEffect(() => {
    if (session.status !== "LIVE" || !live) return;
    let stopped = false;
    const timer = setInterval(() => {
      pollLiveEvent(session.id)
        .then((ev) => {
          if (stopped || !ev) return;
          setViolations((cur) => [...cur, ev.violation]);
          setSession((s) => ({ ...s, riskScore: ev.riskScore, warnings: ev.warnings }));
          setHistory((h) => [...h, { at: ev.violation.at, score: ev.riskScore }]);
          toast({ tone: "info", title: `New event: ${VIOLATION_LABEL[ev.violation.code]}`, description: ev.violation.message });
        })
        .catch(() => undefined);
    }, 9000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [session.id, session.status, live, toast]);

  const stats = useMemo(() => {
    const confirmed = violations.filter((v) => verdictOf(v) === "CONFIRMED").length;
    const overruled = violations.filter((v) => verdictOf(v) === "OVERRULED").length;
    return { confirmed, overruled, pending: violations.length - confirmed - overruled, total: violations.length };
  }, [violations, verdictOf]);

  const adjusted = adjustRisk(session.riskScore, violations, verdictOf);
  const suggested = suggestOutcome(violations, verdictOf);
  const decision = storedDecision ?? detail.decision;

  const evidenceItems = useMemo<EvidenceItem[]>(
    () =>
      violations
        .filter((v): v is Violation & { evidenceUrl: string } => Boolean(v.evidenceUrl))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .map((v) => ({ id: v.id, url: v.evidenceUrl, code: v.code, severity: v.severity, at: v.at, caption: v.message })),
    [violations],
  );

  const jumpToViolation = (id: string) => {
    setTab("violations");
    setHighlightId(id);
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => document.getElementById(`violation-${id}`)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" }), 80);
    window.setTimeout(() => setHighlightId(null), 2600);
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  };

  const tabCount: Record<TabId, number> = { violations: violations.length, evidence: evidenceItems.length, browsing: browsing.length };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <section className={card} aria-labelledby="candidate-name">
        <Link href="/proctor" className={`inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-primary-600 hover:underline ${focusRing}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Review queue
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          {snapshot && session.status === "LIVE" ? (
            <figure className="relative w-40 shrink-0 overflow-hidden rounded-2xl bg-ink shadow-sm">
              <img src={snapshot.image} alt={`Live webcam of ${candidate.name}`} className="aspect-[4/3] w-full object-cover" />
              <figcaption className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden /> LIVE · {formatClock(snapshot.at)}
              </figcaption>
            </figure>
          ) : (
            <Avatar name={candidate.name} size="lg" src={candidate.photoUrl} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="candidate-name" className="font-heading text-2xl font-semibold">{candidate.name}</h1>
              <StatusChip status={session.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">{candidate.userId} · {candidate.email}</p>
            <p className="mt-0.5 text-sm text-slate-700">{exam.title} <span className="rounded bg-soft px-1.5 py-0.5 font-mono text-xs text-slate-500">{exam.code}</span></p>
          </div>
          <dl className="grid grid-cols-3 gap-6 text-sm">
            {[
              ["Started", formatDateTime(session.startedAt)],
              ["Progress", `${session.progress}%`],
              ["Warnings", `${session.warnings} / ${exam.settings.maxWarnings}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {session.status === "LIVE" && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-blue-50 p-3 text-sm text-slate-700">
            <Radio className="h-4 w-4 shrink-0 text-primary-600" aria-hidden />
            <span className="flex-1">This session is still live. New events appear here automatically. To warn or terminate, use the live monitor in the desktop app.</span>
            <button type="button" role="switch" aria-checked={live} onClick={() => setLive((v) => !v)} className={`inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold ${focusRing}`}>
              <span className={`relative h-5 w-9 rounded-full transition ${live ? "bg-primary" : "bg-slate-300"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${live ? "left-[18px]" : "left-0.5"}`} />
              </span>
              Live updates
            </button>
          </div>
        )}
        {session.status === "LIVE" && <ScreenViewer sessionId={session.id} candidateName={candidate.name} />}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`} aria-label="Session evidence">
          <div role="tablist" aria-label="Session sections" onKeyDown={onTabKey} className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} className={`-mb-px rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-semibold ${focusRing} ${tab === t.id ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-900"}`}>
                {t.label} <span className="ml-1 rounded-full bg-soft px-1.5 py-0.5 text-xs">{tabCount[t.id]}</span>
              </button>
            ))}
          </div>
          <div className="pt-5">
            <div id="panel-violations" role="tabpanel" aria-labelledby="tab-violations" hidden={tab !== "violations"}>
              <ViolationTimeline violations={violations} startedAt={session.startedAt} verdictOf={verdictOf} reviews={reviews} highlightId={highlightId} onReview={setReviewTarget} onOpenEvidence={(v) => setLightboxId(v.id)} />
            </div>
            <div id="panel-evidence" role="tabpanel" aria-labelledby="tab-evidence" hidden={tab !== "evidence"}>
              <EvidenceGallery items={evidenceItems} openId={lightboxId} onOpenIdChange={setLightboxId} onJumpToViolation={jumpToViolation} />
            </div>
            <div id="panel-browsing" role="tabpanel" aria-labelledby="tab-browsing" hidden={tab !== "browsing"}>
              <BrowsingLogTable logs={browsing} candidateName={candidate.name} />
            </div>
          </div>
        </section>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start" aria-label="Risk and decision">
          <RiskCard original={session.riskScore} adjusted={adjusted} history={history} stats={stats} />
          <DecisionPanel key={decision?.decidedAt ?? "new"} sessionId={session.id} pending={stats.pending} suggested={suggested} existing={decision} onSaved={(d) => { saveDecision(d); toast({ tone: "success", title: "Decision recorded", description: `${candidate.name}: ${OUTCOMES.find((o) => o.id === d.outcome)?.title}` }); }} />
        </aside>
      </div>

      <AnimatePresence>
        {reviewTarget && (
          <ReviewModal
            key={reviewTarget.id}
            violation={reviewTarget}
            candidateName={candidate.name}
            existing={reviews[reviewTarget.id]}
            fallbackVerdict={reviewTarget.reviewed}
            onClose={() => setReviewTarget(null)}
            onSaved={(rec) => {
              saveReview(rec);
              setReviewTarget(null);
              toast({ tone: "success", title: rec.verdict === "CONFIRMED" ? "Penalty confirmed" : "Penalty overruled", description: VIOLATION_LABEL[reviewTarget.code] });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- risk ---------------- */

function RiskCard({ original, adjusted, history, stats }: { original: number; adjusted: number; history: RiskPoint[]; stats: { confirmed: number; overruled: number; pending: number; total: number } }) {
  const reduce = useReducedMotion();
  const tone = riskTone(adjusted);
  const R = 80;
  const C = Math.PI * R;
  const arc = "M 20 100 A 80 80 0 0 1 180 100";
  const data = history.map((p) => ({ t: formatClock(p.at), score: p.score }));
  const reviewed = stats.confirmed + stats.overruled;
  const pct = stats.total === 0 ? 100 : Math.round((reviewed / stats.total) * 100);

  return (
    <section className={card} aria-labelledby="risk-h">
      <h2 id="risk-h" className="font-heading text-base font-semibold">Risk score</h2>
      <div className="relative mx-auto mt-2 w-full max-w-[260px]">
        <svg viewBox="0 0 200 116" role="img" aria-label={`Risk score ${adjusted} out of 100, ${tone.label}`}>
          <path d={arc} fill="none" stroke="#E2E8F0" strokeWidth="14" strokeLinecap="round" />
          {original > adjusted && <path d={arc} fill="none" stroke="#FCA5A5" strokeWidth="14" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - original / 100)} />}
          <motion.path d={arc} fill="none" stroke={tone.stroke} strokeWidth="14" strokeLinecap="round" strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - adjusted / 100) }} transition={{ duration: reduce ? 0 : 0.8, ease: "easeOut" }} />
        </svg>
        <div className="absolute inset-x-0 bottom-1 text-center">
          <p className="font-heading text-4xl font-semibold leading-none">{adjusted}</p>
          <p className={`mt-1 text-xs font-semibold ${tone.text}`}>{tone.label} risk</p>
        </div>
      </div>
      {original !== adjusted && <p className="mt-2 text-center text-xs text-slate-500">Original {original} · {original - adjusted} points removed by overruled events</p>}

      <div className="mt-3 h-24" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1E6FF0" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#1E6FF0" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis domain={[0, 100]} hide />
            <ReferenceLine y={70} stroke="#DC2626" strokeDasharray="4 4" />
            <Tooltip formatter={(value: number) => [value, "Risk"]} labelStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="score" stroke="#0B5BD3" strokeWidth={2} fill="url(#riskFill)" isAnimationActive={!reduce} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Review progress</span>
          <span className="font-semibold text-slate-900">{reviewed} / {stats.total}</span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Violations reviewed">
          <div className="h-2 rounded-full bg-gradient-to-r from-primary-600 to-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">{stats.confirmed} confirmed · {stats.overruled} overruled · {stats.pending} pending</p>
      </div>
    </section>
  );
}

/* ---------------- review modal ---------------- */

const reviewSchema = z.object({
  verdict: z.enum(["CONFIRMED", "OVERRULED"]),
  reason: z.string().trim().min(10, "Add at least 10 characters so the audit trail makes sense.").max(400, "Keep the reason under 400 characters."),
});
type ReviewForm = z.infer<typeof reviewSchema>;

const REASON_CHIPS: Record<ReviewForm["verdict"], string[]> = {
  CONFIRMED: ["Evidence clearly shows the violation.", "Repeated behaviour within the same session.", "Matches the browsing log."],
  OVERRULED: ["Poor lighting caused a false detection.", "Candidate had the invigilator's permission.", "Duplicate of an earlier event.", "Evidence is unclear or inconclusive."],
};

function ReviewModal({ violation, candidateName, existing, fallbackVerdict, onClose, onSaved }: { violation: Violation; candidateName: string; existing?: ReviewRecord; fallbackVerdict?: ReviewForm["verdict"]; onClose: () => void; onSaved: (record: ReviewRecord) => void }) {
  const ref = useDialog(onClose);
  const uid = useId();
  const toast = useMentorStore((s) => s.toast);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<ReviewForm>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { verdict: existing?.verdict ?? fallbackVerdict ?? "CONFIRMED", reason: existing?.reason ?? "" },
  });
  const verdict = watch("verdict");
  const reason = watch("reason");

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      onSaved(await submitViolationReview({
        violationId: violation.id,
        verdict: values.verdict ?? "CONFIRMED",
        reason: values.reason ?? "",
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save the review.";
      setServerError(message);
      toast({ tone: "error", title: "Review not saved", description: message });
    }
  });

  const label = VIOLATION_LABEL[violation.code];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center">
      <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} tabIndex={-1} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={`${uid}-title`} className="font-heading text-lg font-semibold">Review: {label}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{candidateName} · <time dateTime={violation.at}>{formatClock(violation.at)}</time></p>
          </div>
          <SeverityChip severity={violation.severity} />
          <button type="button" onClick={onClose} aria-label="Close review" className={`rounded-lg p-1.5 text-slate-500 hover:bg-soft ${focusRing}`}><X className="h-5 w-5" aria-hidden /></button>
        </div>
        <p className="mt-3 rounded-xl bg-soft p-3 text-sm text-slate-700">{violation.message}</p>
        {violation.evidenceUrl && <img src={violation.evidenceUrl} alt={`Evidence for ${label}`} className="mt-3 aspect-[16/10] w-full rounded-xl border border-border object-cover" />}

        <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold">Your decision</legend>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {([
                { value: "CONFIRMED", title: "Confirm penalty", body: "The event is valid and counts.", icon: ThumbsUp },
                { value: "OVERRULED", title: "Overrule", body: "False alarm. Remove it from the score.", icon: RotateCcw },
              ] as const).map((o) => (
                <label key={o.value} className="relative block cursor-pointer">
                  <input type="radio" value={o.value} {...register("verdict")} className="peer sr-only" />
                  <span className="block rounded-xl border border-border p-3 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-4 peer-focus-visible:ring-accent/40">
                    <o.icon className="h-5 w-5 text-primary" aria-hidden />
                    <span className="mt-1 block text-sm font-semibold">{o.title}</span>
                    <span className="block text-xs text-slate-500">{o.body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`${uid}-reason`} className="text-sm font-semibold">Reason <span className="font-normal text-slate-500">(saved to the audit trail)</span></label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASON_CHIPS[verdict].map((c) => (
                <button key={c} type="button" onClick={() => setValue("reason", c, { shouldValidate: true })} className={`rounded-full border border-border px-2.5 py-1 text-xs text-slate-700 hover:border-accent hover:text-primary-600 ${focusRing}`}>{c}</button>
              ))}
            </div>
            <textarea id={`${uid}-reason`} rows={3} aria-invalid={Boolean(errors.reason)} aria-describedby={`${uid}-reason-help`} {...register("reason")} className="mt-2 w-full rounded-xl border border-border p-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/20 aria-[invalid=true]:border-danger" />
            <div id={`${uid}-reason-help`} className="mt-1 flex justify-between text-xs">
              <span role={errors.reason ? "alert" : undefined} className={errors.reason ? "text-danger" : "text-slate-500"}>{errors.reason?.message ?? "Be specific. Another proctor may read this."}</span>
              <span className="text-slate-500">{reason.length}/400</span>
            </div>
          </div>

          {serverError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-danger">{serverError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={`rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-soft ${focusRing}`}>Cancel</button>
            <button type="submit" disabled={isSubmitting} className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${focusRing} ${verdict === "CONFIRMED" ? "bg-primary hover:bg-primary-600" : "bg-success hover:brightness-95"}`}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {verdict === "CONFIRMED" ? "Confirm penalty" : "Overrule penalty"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

/* ---------------- final decision ---------------- */

const OUTCOMES: Array<{ id: FinalOutcome; title: string; body: string; icon: LucideIcon; chip: string }> = [
  { id: "CLEAR", title: "No action", body: "Dismiss the flags. The result stands.", icon: CheckCircle2, chip: "bg-green-50 text-success" },
  { id: "WARN", title: "Formal warning", body: "Result stands. A warning is added to the record.", icon: Gavel, chip: "bg-amber-50 text-amber-700" },
  { id: "RETEST", title: "Allow re-test", body: "Invalidate this attempt and issue a new slot.", icon: RotateCcw, chip: "bg-blue-50 text-primary-600" },
  { id: "DISQUALIFY", title: "Disqualify", body: "Withhold the result and mark the candidate disqualified.", icon: UserX, chip: "bg-red-50 text-danger" },
];
const noteSchema = z.string().trim().min(10, "Write at least 10 characters explaining your decision.").max(500);

function DecisionPanel({ sessionId, pending, suggested, existing, onSaved }: { sessionId: string; pending: number; suggested: FinalOutcome; existing?: FinalDecision; onSaved: (decision: FinalDecision) => void }) {
  const toast = useMentorStore((s) => s.toast);
  const [editing, setEditing] = useState(!existing);
  const [chosen, setChosen] = useState<FinalOutcome | null>(existing?.outcome ?? null);
  const [note, setNote] = useState(existing?.note ?? "");
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const outcome = chosen ?? suggested;
  const noteCheck = noteSchema.safeParse(note);
  const blocked = pending > 0;

  if (existing && !editing) {
    const o = OUTCOMES.find((x) => x.id === existing.outcome);
    return (
      <section className={card} aria-labelledby="decision-h">
        <h2 id="decision-h" className="font-heading text-base font-semibold">Final decision</h2>
        <p className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${o?.chip}`}>{o && <o.icon className="h-4 w-4" aria-hidden />}{o?.title}</p>
        <p className="mt-3 text-sm text-slate-700">{existing.note}</p>
        <p className="mt-2 text-xs text-slate-500">Recorded {formatDateTime(existing.decidedAt)}</p>
        <button type="button" onClick={() => setEditing(true)} className={`mt-4 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-soft ${focusRing}`}>Change decision</button>
      </section>
    );
  }

  const save = async () => {
    setTouched(true);
    if (!noteCheck.success) return;
    if (outcome === "DISQUALIFY" && !armed) {
      setArmed(true);
      return;
    }
    setSaving(true);
    try {
      onSaved(await submitFinalDecision({ sessionId, outcome, note: noteCheck.data }));
    } catch (e) {
      toast({ tone: "error", title: "Decision not saved", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={card} aria-labelledby="decision-h">
      <h2 id="decision-h" className="flex items-center gap-2 font-heading text-base font-semibold"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Final decision</h2>
      {blocked && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-slate-900">Review the {pending} pending {pending === 1 ? "event" : "events"} first. The decision unlocks when every violation has a verdict.</p>}
      <fieldset disabled={blocked} className="mt-4 space-y-2 disabled:opacity-60">
        <legend className="sr-only">Outcome</legend>
        {OUTCOMES.map((o) => (
          <label key={o.id} className="relative block cursor-pointer">
            <input type="radio" name="outcome" value={o.id} checked={outcome === o.id} onChange={() => { setChosen(o.id); setArmed(false); }} className="peer sr-only" />
            <span className="flex gap-3 rounded-xl border border-border p-3 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-4 peer-focus-visible:ring-accent/40">
              <o.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">{o.title}{o.id === suggested && !blocked && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Suggested</span>}</span>
                <span className="block text-xs text-slate-500">{o.body}</span>
              </span>
            </span>
          </label>
        ))}
        <div className="pt-2">
          <label htmlFor="decision-note" className="text-sm font-semibold">Note for the organization</label>
          <textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !noteCheck.success} aria-describedby="decision-note-err" className="mt-1.5 w-full rounded-xl border border-border p-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/20 aria-[invalid=true]:border-danger" />
          <p id="decision-note-err" role={touched && !noteCheck.success ? "alert" : undefined} className="mt-1 min-h-4 text-xs text-danger">{touched && !noteCheck.success ? noteCheck.error.issues[0].message : ""}</p>
        </div>
      </fieldset>
      {armed && outcome === "DISQUALIFY" && <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-xs text-danger">This withholds the candidate&apos;s result. Press the button again to confirm.</p>}
      <div className="mt-3 flex gap-2">
        {existing && <button type="button" onClick={() => setEditing(false)} className={`rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-soft ${focusRing}`}>Cancel</button>}
        <button type="button" onClick={save} disabled={blocked || saving} className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${focusRing} ${outcome === "DISQUALIFY" ? "bg-danger hover:brightness-95" : "bg-primary hover:bg-primary-600"}`}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {armed && outcome === "DISQUALIFY" ? "Confirm disqualification" : "Record decision"}
        </button>
      </div>
    </section>
  );
}
