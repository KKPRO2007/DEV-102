import type {
  BrowsingLog, Candidate, Exam, ExamSession, Invite, Question, Severity, Violation, ViolationCode,
} from '@prisma/client';
import { signPhotoUrl } from './evidence.js';

/** Canonical violation catalogue. Labels and default severities match the web UI. */
export const VIOLATION_META: Record<ViolationCode, { label: string; severity: Severity; message: string }> = {
  MULTIPLE_FACES: { label: 'Multiple faces', severity: 'HIGH', message: 'More than one face detected in the webcam frame' },
  NO_FACE: { label: 'Face not visible', severity: 'MEDIUM', message: 'No face detected for more than 8 seconds' },
  GAZE_AWAY: { label: 'Looking away', severity: 'LOW', message: 'Gaze held away from the screen for 6 seconds' },
  FACE_MISMATCH: { label: 'Face mismatch', severity: 'CRITICAL', message: 'Live face does not match the verified candidate photo' },
  AI_SITE_OPENED: { label: 'AI site opened', severity: 'HIGH', message: 'Candidate opened a known AI assistant website' },
  AI_QUERY_DETECTED: { label: 'AI query detected', severity: 'CRITICAL', message: 'A question-like prompt was typed into an AI chat' },
  BLACKLISTED_APP: { label: 'Blacklisted app', severity: 'HIGH', message: 'A blacklisted application started during the exam' },
  SCREEN_MIRRORING: { label: 'Screen mirroring', severity: 'HIGH', message: 'Display mirroring or casting was detected' },
  MULTI_MONITOR: { label: 'Extra monitor', severity: 'HIGH', message: 'A second display was connected' },
  VM_DETECTED: { label: 'Virtual machine', severity: 'CRITICAL', message: 'The exam is running inside a virtual machine' },
  REMOTE_DESKTOP: { label: 'Remote desktop', severity: 'CRITICAL', message: 'A remote desktop session is controlling this device' },
  EXTERNAL_DEVICE: { label: 'External device', severity: 'MEDIUM', message: 'A new USB or Bluetooth device was attached' },
  CLIPBOARD_USE: { label: 'Clipboard use', severity: 'MEDIUM', message: 'Copy or paste attempt was blocked' },
  SHORTCUT_BLOCKED: { label: 'Shortcut blocked', severity: 'LOW', message: 'A restricted keyboard shortcut was blocked' },
  SCREEN_SHARE_STOPPED: { label: 'Screen share stopped', severity: 'HIGH', message: 'Entire-screen sharing was stopped by the candidate' },
  CAMERA_BLOCKED: { label: 'Camera blocked', severity: 'HIGH', message: 'The webcam feed is covered or disabled' },
  MULTI_LOGIN: { label: 'Multiple logins', severity: 'CRITICAL', message: 'The same credentials were used on another device' },
  NETWORK_LOST: { label: 'Network lost', severity: 'LOW', message: 'Connection dropped; answers are cached locally' },
  WINDOW_BLUR: { label: 'Window lost focus', severity: 'MEDIUM', message: 'The exam window lost focus' },
  VOICE_DETECTED: { label: 'Voice detected', severity: 'MEDIUM', message: 'Speech was picked up by the microphone for several seconds' },
  MIC_BLOCKED: { label: 'Microphone blocked', severity: 'HIGH', message: 'The microphone is muted, disconnected or silent' },
  PHONE_DETECTED: { label: 'Phone detected', severity: 'HIGH', message: 'A mobile phone was visible in the webcam frame' },
  NOTES_DETECTED: { label: 'Notes detected', severity: 'MEDIUM', message: 'A book or notes were visible in the webcam frame' },
};
export const VIOLATION_CODES = Object.keys(VIOLATION_META) as ViolationCode[];
export const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export interface ExamSettings {
  shuffle: boolean; negativeMarking: boolean; allowedSites: string[]; maxWarnings: number; autoSubmit: boolean; audioMonitoring: boolean;
  /** Violations only flag to the proctor: no warnings to the candidate and no automatic submit. */
  proctorOnly: boolean;
  /** Questions are answered in order; a question cannot be revisited after Next. */
  oneWay: boolean;
  /** The candidate's microphone is streamed live to proctors watching the screen (never recorded). */
  liveAudio: boolean;
}
export interface ExamExtras {
  category: string; description: string; instructions: string; lateEntryMin: number; checkInMin: number;
  negativeValue: number; allowCalculator: boolean; releaseResults: 'IMMEDIATE' | 'AFTER_REVIEW' | 'MANUAL';
  /** Set by POST /exams/:id/release-results; only used when releaseResults is MANUAL. */
  resultsReleasedAt?: string | null; resultsReleasedBy?: string | null;
}
export interface ViolationPolicy {
  weights: Record<Severity, number>; maxWarnings: number; warnFrom: Severity; autoSubmit: boolean;
  autoSubmitFrom: Severity; autoSubmitOnCritical: boolean; riskFlagAt: number; cooldownSec: number;
}

export const DEFAULT_SETTINGS: ExamSettings = { shuffle: true, negativeMarking: false, allowedSites: [], maxWarnings: 2, autoSubmit: true, audioMonitoring: false, proctorOnly: false, oneWay: false, liveAudio: false };
export const DEFAULT_POLICY: ViolationPolicy = {
  weights: { LOW: 2, MEDIUM: 8, HIGH: 20, CRITICAL: 50 },
  maxWarnings: 2, warnFrom: 'MEDIUM', autoSubmit: true, autoSubmitFrom: 'HIGH', autoSubmitOnCritical: true, riskFlagAt: 60, cooldownSec: 30,
};
export const defaultExtras = (title: string): ExamExtras => ({
  category: 'General assessment',
  description: `${title} conducted under full proctoring.`,
  instructions: 'Keep your webcam on and your face visible for the entire exam. Do not switch windows or open other applications. Your screen, webcam and browsing activity are recorded and reviewed.',
  lateEntryMin: 10, checkInMin: 30, negativeValue: 0.25, allowCalculator: false, releaseResults: 'AFTER_REVIEW',
});

/** 45+ AI assistant domains. Matching is by registrable suffix so subdomains are caught too. */
export const AI_DOMAINS = [
  'chatgpt.com', 'chat.openai.com', 'openai.com', 'claude.ai', 'anthropic.com', 'gemini.google.com', 'bard.google.com', 'aistudio.google.com',
  'notebooklm.google.com', 'copilot.microsoft.com', 'bing.com/chat', 'perplexity.ai', 'poe.com', 'chat.deepseek.com', 'deepseek.com',
  'you.com', 'phind.com', 'character.ai', 'huggingface.co/chat', 'chat.mistral.ai', 'mistral.ai', 'grok.com', 'x.ai', 'meta.ai',
  'pi.ai', 'jasper.ai', 'writesonic.com', 'chatsonic.com', 'quillbot.com', 'wolframalpha.com', 'photomath.com', 'socratic.org',
  'brainly.com', 'brainly.in', 'chegg.com', 'coursehero.com', 'symbolab.com', 'mathway.com', 'kimi.moonshot.cn', 'kimi.ai',
  'chat.qwen.ai', 'tongyi.aliyun.com', 'yiyan.baidu.com', 'doubao.com', 'blackbox.ai', 'codeium.com', 'tabnine.com', 'cursor.com',
  'github.com/copilot', 'replit.com/ai', 'gauthmath.com', 'studyx.ai', 'answerthis.io', 'monica.im', 'merlin.foyer.work', 'getmerlin.in',
];

export function isAiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const hostPath = `${host}${u.pathname}`.toLowerCase();
    return AI_DOMAINS.some((d) => (d.includes('/') ? hostPath.startsWith(d) : host === d || host.endsWith(`.${d}`)));
  } catch {
    return false;
  }
}

export function hostAllowed(url: string, allowed: string[]): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return allowed.some((a) => host === a.toLowerCase() || host.endsWith(`.${a.toLowerCase()}`));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ JSON readers */

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const readSettings = (v: unknown): ExamSettings => ({ ...DEFAULT_SETTINGS, ...asObj(v) }) as ExamSettings;
export const readPolicy = (v: unknown): ViolationPolicy => {
  const o = asObj(v);
  return { ...DEFAULT_POLICY, ...o, weights: { ...DEFAULT_POLICY.weights, ...asObj(o.weights) } } as ViolationPolicy;
};
export const readExtras = (v: unknown, title: string): ExamExtras => ({ ...defaultExtras(title), ...asObj(v) }) as ExamExtras;

/** Silence longer than two missed heartbeats (sent every 10 s) counts as offline, and the exam clock is paused for it. */
export const PAUSE_AFTER_MS = 20_000;

/**
 * The exam clock is paused while a candidate is offline: on reconnect the deadline moves forward by the time
 * since the last contact, but never past the end of the exam window.
 */
export function resumedDeadline(deadlineAt: Date, lastContactAt: Date, examEndsAt: Date, now = Date.now()): Date {
  const pausedMs = Math.max(0, now - lastContactAt.getTime());
  return new Date(Math.min(deadlineAt.getTime() + pausedMs, examEndsAt.getTime()));
}

/* ------------------------------------------------------------ UI shapes */

export type ExamStatusView = 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'COMPLETED';
export function examStatus(e: Pick<Exam, 'status' | 'startsAt' | 'endsAt'>, now = Date.now()): ExamStatusView {
  if (e.status === 'DRAFT') return 'DRAFT';
  if (now < e.startsAt.getTime()) return 'SCHEDULED';
  if (now < e.endsAt.getTime()) return 'LIVE';
  return 'COMPLETED';
}

export type ExamWithCounts = Exam & { questions?: Pick<Question, 'marks'>[]; _count?: { candidates: number; questions: number } };

export function toExam(e: ExamWithCounts) {
  const marks = e.questions?.reduce((s, q) => s + q.marks, 0) ?? 0;
  return {
    id: e.id, title: e.title, code: e.code, status: examStatus(e),
    startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), durationMin: e.durationMin,
    totalMarks: marks, questionCount: e._count?.questions ?? e.questions?.length ?? 0, candidateCount: e._count?.candidates ?? 0,
    settings: readSettings(e.settings),
  };
}
export const examInclude = { questions: { select: { marks: true } }, _count: { select: { candidates: true, questions: true } } } as const;

export interface OptionView { id: string; text: string }
export const readOptions = (v: unknown): OptionView[] => (Array.isArray(v) ? (v as OptionView[]) : []);

/** The answer key of a NUMERIC question: correct when |answer - value| <= tolerance. */
export interface NumericKey { value: number; tolerance: number; unit: string | null }
export function readNumericKey(v: unknown): NumericKey | null {
  if (!v || typeof v !== 'object') return null;
  const k = v as Partial<NumericKey>;
  if (typeof k.value !== 'number' || !Number.isFinite(k.value)) return null;
  const tolerance = typeof k.tolerance === 'number' && k.tolerance >= 0 ? k.tolerance : 0;
  return { value: k.value, tolerance, unit: typeof k.unit === 'string' && k.unit ? k.unit : null };
}

/** The candidate's paper omits correctIds and the answer key (withAnswer = false); the unit is still shown. */
export function toQuestion(q: Question, withAnswer = true) {
  const key = q.type === 'NUMERIC' ? readNumericKey(q.answerKey) : null;
  const base = {
    id: q.id, examId: q.examId, type: q.type, text: q.text, options: readOptions(q.options), multi: q.multi, marks: q.marks, difficulty: q.difficulty, tags: q.tags,
    ...(key?.unit ? { unit: key.unit } : {}),
  };
  return withAnswer ? { ...base, correctIds: q.correctIds, ...(key ? { answerKey: key } : {}) } : base;
}

export const toCandidate = (c: Candidate) => ({
  id: c.id, name: c.name, email: c.email, userId: c.userId, examId: c.examId, status: c.status, emailStatus: c.emailStatus,
  ...(c.photoPath ? { photoUrl: signPhotoUrl(c.id) } : {}),
});

export const toSession = (s: ExamSession) => ({
  id: s.id, candidateId: s.candidateId, examId: s.examId, status: s.status, progress: s.progress,
  riskScore: s.riskScore, warnings: s.warnings, startedAt: s.startedAt.toISOString(),
});

/* ---------------------------------------------------------------- join links */

export type InviteStatus = 'PENDING' | 'USED' | 'REVOKED' | 'EXPIRED';

/** 48 hex characters; the desktop app accepts the full link or the bare token. */
export const INVITE_TOKEN = /^[a-f0-9]{48}$/;

export function inviteStatus(inv: Pick<Invite, 'revokedAt' | 'expiresAt' | 'usedAt'>, now = new Date()): InviteStatus {
  if (inv.revokedAt) return 'REVOKED';
  if (inv.expiresAt <= now) return 'EXPIRED';
  return inv.usedAt ? 'USED' : 'PENDING';
}

export type EvidenceSigner = (evidenceId: string) => string;
export const toViolation = (v: Violation, sign: EvidenceSigner) => ({
  id: v.id, sessionId: v.sessionId, code: v.code, severity: v.severity, at: v.at.toISOString(), message: v.message,
  ...(v.evidenceId ? { evidenceUrl: sign(v.evidenceId) } : {}),
  ...(v.reviewed ? { reviewed: v.reviewed } : {}),
});

export const toBrowsing = (b: BrowsingLog) => ({
  id: b.id, sessionId: b.sessionId, at: b.at.toISOString(), url: b.url, title: b.title, ...(b.query ? { query: b.query } : {}), flaggedAi: b.flaggedAi,
});

export type Grade = 'CORRECT' | 'WRONG' | 'UNANSWERED';
/** Questions without a type (older callers) are multiple choice. The answer key is read through readNumericKey, so any shape is accepted. */
export type Gradable = Pick<Question, 'id' | 'marks' | 'correctIds'> & { type?: Question['type']; answerKey?: unknown };

/** Multiple choice scores only on an exact match of options; numeric when the value is within the key's tolerance. */
export function gradeAnswer(q: Gradable, picked: string[], value?: number | null): Grade {
  if (q.type === 'NUMERIC') {
    if (value === undefined || value === null || !Number.isFinite(value)) return 'UNANSWERED';
    const key = readNumericKey(q.answerKey);
    if (!key) return 'WRONG';
    // A tiny allowance so binary rounding (|3.15 - 3.14| = 0.010000000000000231) cannot fail a ±0.01 answer.
    const slack = 1e-9 * Math.max(1, Math.abs(key.value));
    return Math.abs(value - key.value) <= key.tolerance + slack ? 'CORRECT' : 'WRONG';
  }
  if (picked.length === 0) return 'UNANSWERED';
  return picked.length === q.correctIds.length && picked.every((p) => q.correctIds.includes(p)) ? 'CORRECT' : 'WRONG';
}

/** Scores a session's answers; wrong answers lose negativeValue × marks when enabled. `values` holds numeric answers. */
export function scoreAnswers(
  questions: Gradable[],
  answers: Map<string, string[]>,
  negative: { enabled: boolean; value: number },
  values: Map<string, number> = new Map(),
): { score: number; correct: number; wrong: number; unanswered: number } {
  let score = 0, correct = 0, wrong = 0, unanswered = 0;
  for (const q of questions) {
    const grade = gradeAnswer(q, answers.get(q.id) ?? [], values.get(q.id));
    if (grade === 'UNANSWERED') unanswered++;
    else if (grade === 'CORRECT') { score += q.marks; correct++; }
    else { wrong++; if (negative.enabled) score -= q.marks * negative.value; }
  }
  return { score: Math.max(0, Math.round(score * 100) / 100), correct, wrong, unanswered };
}
