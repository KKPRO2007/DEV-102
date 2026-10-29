import { z } from 'zod';
import { API_ORIGIN, HttpError, get, post, put, setToken } from './http';
import { enqueue, restoreQueue } from './live';
import type { AuthUser, BrowsingLog, Exam, LoginInput, MentorLoginInput, OtpChallenge, Question, Session, Violation, ViolationCode } from './types';

/** Seeded demo accounts (database/prisma/seed.ts). */
export const DEMO_CREDENTIALS: LoginInput = { examId: 'CPA-26', userId: 'WUE26DEMO', password: 'Demo@2026' };
export const DEMO_MENTOR: MentorLoginInput = { email: 'mentor@wue.in', password: 'Mentor@123' };

const loginSchema = z.object({
  examId: z.string().trim().min(4, 'Enter the Exam ID from your invitation email'),
  userId: z.string().trim().min(3, 'Enter the User ID from your invitation email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
const otpSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? 'Invalid input';

export interface ExamPaper {
  exam: Exam;
  sessionId: string;
  /** correctIds is always empty: answers never leave the server. */
  questions: Question[];
  saved: { answers: Record<string, string[]>; values?: Record<string, number>; flagged: string[] };
  remainingSec: number;
  warningsUsed: number;
}

export interface ViolationResult {
  outcome: 'LOGGED' | 'SUPPRESSED' | 'WARNING' | 'AUTO_SUBMIT';
  warnings: number;
  maxWarnings: number;
  riskScore: number;
  status: Session['status'];
}

interface LoginResponse { token: string; user: Omit<AuthUser, 'token'>; exam: Exam; sessionId?: string }

/** What a pasted join link resolves to before the password is entered. */
export interface InvitePreview {
  role: 'CANDIDATE' | 'MENTOR';
  name: string;
  /** Masked, e.g. ra••••@gmail.com */
  email: string;
  userId?: string;
  exam: { code: string; title: string; startsAt: string; endsAt: string; durationMin: number };
  deviceBound: boolean;
}

/** Accepts the full link from the email (…/join/<token>) or the bare token; null when neither is present. */
export function parseInviteToken(text: string): string | null {
  return /(?:^|\/join\/|\s)([a-f0-9]{48})(?=$|[/?#\s])/i.exec(text.trim())?.[1]?.toLowerCase() ?? null;
}

/**
 * A link sent from an organizer's laptop on the same Wi-Fi (`npm run start:lan`) names that laptop,
 * e.g. http://192.168.1.20:3000/join/…, whose API is on port 4000. Null for any other link.
 */
export function serverFromInviteLink(text: string): string | null {
  try {
    const { protocol, hostname } = new URL(text.trim());
    if (protocol !== 'http:' || !/^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/.test(hostname)) return null;
    return `http://${hostname}:4000`;
  } catch {
    return null;
  }
}

export interface AvailableExam { id: string; code: string; title: string; startsAt: string; endsAt: string; status: 'SCHEDULED' | 'LIVE' }

let current: { auth: AuthUser; exam: Exam; sessionId?: string } | null = null;
let otpChallengeId: string | undefined;
let lastDevOtp: string | undefined;

/** The signed-in candidate and their exam, set by api.login. */
export const currentLogin = () => current;
/** Development only: the code the API returns when no SMTP server is configured. */
export const devOtpHint = (): string | undefined => lastDevOtp;

export async function getDeviceId(): Promise<string> {
  if (window.proctor) return window.proctor.deviceId();
  let id = localStorage.getItem('dev102.deviceId');
  if (!id) {
    id = `browser-${crypto.randomUUID()}`;
    localStorage.setItem('dev102.deviceId', id);
  }
  return id;
}

const isNetwork = (e: unknown) => e instanceof HttpError && e.code === 'NETWORK';
const sid = (fallback?: string) => fallback || current?.sessionId || '';

/* ---------------------------------------------------------------- candidate */

export const api = {
  async availableExams(): Promise<AvailableExam[]> {
    return get<AvailableExam[]>('/auth/exams');
  },

  async serverStatus(): Promise<{ online: boolean; latencyMs: number }> {
    const t = performance.now();
    try {
      const r = await fetch(`${API_ORIGIN}/health`, { cache: 'no-store' });
      return { online: r.ok, latencyMs: Math.round(performance.now() - t) };
    } catch {
      return { online: false, latencyMs: 0 };
    }
  },

  async login(input: LoginInput): Promise<void> {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) throw new Error(firstIssue(parsed.error));
    const r = await post<LoginResponse>('/auth/login', { ...parsed.data, deviceId: await getDeviceId(), channel: 'desktop' });
    setToken(r.token);
    current = { auth: { ...r.user, token: r.token }, exam: r.exam, ...(r.sessionId ? { sessionId: r.sessionId } : {}) };
  },

  previewInvite: (token: string) => get<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`),

  /** Signs in with a join link: a candidate continues to the system check, a proctor to face and OTP checks. */
  async loginWithInvite(token: string, password: string): Promise<'CANDIDATE' | 'MENTOR'> {
    if (!password) throw new Error('Enter the password from your invitation email');
    const r = await post<LoginResponse & { role: 'CANDIDATE' | 'MENTOR' }>('/auth/invites/login', { token, password, deviceId: await getDeviceId() });
    setToken(r.token);
    current = { auth: { ...r.user, token: r.token }, exam: r.exam, ...(r.sessionId ? { sessionId: r.sessionId } : {}) };
    return r.role;
  },

  async getExamPaper(_examId?: string): Promise<ExamPaper> {
    const p = await post<ExamPaper>('/sessions/start', { consent: true });
    if (current) current.sessionId = p.sessionId;
    await restoreQueue(p.sessionId);
    if (window.proctor) await window.proctor.sandbox.setPolicy(p.exam.settings.allowedSites);
    return p;
  },

  /** Returns the server's policy decision, or null when offline (the event is queued). */
  async reportViolation(input: { sessionId: string; code: ViolationCode; message?: string; at: string; [k: string]: unknown }): Promise<ViolationResult | null> {
    const id = sid(input.sessionId);
    try {
      return await post<ViolationResult>('/proctoring/events', { sessionId: id, code: input.code, message: input.message, at: input.at });
    } catch (e) {
      if (isNetwork(e)) await enqueue(id, { kind: 'event', body: { code: input.code, message: input.message, at: input.at } });
      return null;
    }
  },

  async saveProgress(input: { answers: Record<string, string[]>; values?: Record<string, number | null>; flagged: string[]; [k: string]: unknown }): Promise<void> {
    const body = { answers: input.answers, values: input.values ?? {}, flagged: input.flagged };
    try {
      await put(`/sessions/${sid()}/answers`, body);
    } catch (e) {
      if (isNetwork(e)) await enqueue(sid(), { kind: 'answers', body });
      throw e;
    }
  },

  async logBrowsing(_examId: string, entry: BrowsingLog): Promise<void> {
    if (!/^https?:/i.test(entry.url)) return; // sandbox:// pages are local placeholders, not real navigations
    const body = { url: entry.url, title: entry.title, ...(entry.query ? { query: entry.query } : {}), at: entry.at, flaggedAi: entry.flaggedAi };
    try {
      await post('/proctoring/browsing-logs', { sessionId: sid(entry.sessionId), entries: [body] });
    } catch (e) {
      if (isNetwork(e)) await enqueue(sid(entry.sessionId), { kind: 'browsing', body });
    }
  },

  async submitExam(input: { answers: Record<string, string[]>; values?: Record<string, number | null>; flagged: string[]; auto: boolean; reason?: string; [k: string]: unknown }): Promise<{ receiptId: string; submittedAt: string; status?: string }> {
    const reason = input.auto && /time is up/i.test(input.reason ?? '') ? 'TIME_UP' : 'MANUAL';
    return post<{ receiptId: string; submittedAt: string; status?: string }>(`/sessions/${sid()}/submit`, { answers: input.answers, values: input.values ?? {}, flagged: input.flagged, reason });
  },

  async verifyFace(input: { image: string }): Promise<{ match: boolean; confidence: number; reason?: string; degraded?: boolean }> {
    const r = await post<{ passed: boolean; matchScore: number | null; reason?: string; degraded?: boolean }>('/auth/face/verify', { image: input.image });
    return { match: r.passed, confidence: r.matchScore ?? 0, ...(r.reason ? { reason: r.reason } : {}), ...(r.degraded ? { degraded: true } : {}) };
  },

  async requestOtp(): Promise<OtpChallenge> {
    const r = await post<OtpChallenge & { devCode?: string }>('/auth/otp/send');
    otpChallengeId = r.challengeId;
    lastDevOtp = r.devCode;
    return r;
  },

  async verifyOtp(code: string): Promise<{ ok: boolean; attemptsLeft: number }> {
    const parsed = otpSchema.safeParse(code);
    if (!parsed.success) throw new Error(firstIssue(parsed.error));
    try {
      const r = await post<{ verified: true; attemptsLeft: number }>('/auth/otp/verify', { code: parsed.data, ...(otpChallengeId ? { challengeId: otpChallengeId } : {}) });
      return { ok: true, attemptsLeft: r.attemptsLeft };
    } catch (e) {
      if (e instanceof HttpError && (e.code === 'AUTH' || e.code === 'LOCKED')) return { ok: false, attemptsLeft: e.code === 'LOCKED' ? 0 : Number(e.details?.attemptsLeft ?? 0) };
      throw e;
    }
  },
};

/* ---------------------------------------------------------------- staff and dev */

export async function signInStaff(input: MentorLoginInput): Promise<AuthUser> {
  const r = await post<{ token: string; user: Omit<AuthUser, 'token'> }>('/auth/staff/login', input);
  setToken(r.token);
  return { ...r.user, token: r.token };
}

/** Development helpers used by the dev panel to reach any screen without going through the earlier ones. */
export const devApi = {
  /** Signs in the demo candidate, clearing any earlier session or device binding first. */
  async signInDemoCandidate(): Promise<{ auth: AuthUser; exam: Exam }> {
    await signInStaff({ email: 'admin@wue.in', password: 'Admin@123' });
    await post('/dev/reset-candidate', { userId: DEMO_CREDENTIALS.userId });
    await api.login(DEMO_CREDENTIALS);
    return { auth: current!.auth, exam: current!.exam };
  },
  /** A fresh join link for the demo candidate or demo mentor (signs in as admin to issue it). */
  async inviteLink(role: 'CANDIDATE' | 'MENTOR'): Promise<{ link: string; password: string }> {
    await signInStaff({ email: 'admin@wue.in', password: 'Admin@123' });
    if (role === 'CANDIDATE') await post('/dev/reset-candidate', { userId: DEMO_CREDENTIALS.userId });
    const r = await post<{ link: string; password: string }>('/dev/invite-link', { role });
    setToken(null);
    return r;
  },
  /** Password for a pasted join link (stored copy or seeded demo password); development only. */
  invitePassword: async (token: string) => (await post<{ password: string }>('/dev/invite-password', { token })).password,
  /** Marks the signed-in candidate as face- and OTP-verified so the exam can start. */
  verifyMe: () => post('/dev/verify-me'),
  simulate: (code: ViolationCode) => post<ViolationResult>('/dev/simulate-violation', { code, ...(current?.sessionId ? { sessionId: current.sessionId } : {}) }),
};

/* ---------------------------------------------------------------- mentor monitor */

export interface MonitorSession extends Session {
  candidateName: string;
  userId: string;
  /** Drives the colours of the webcam placeholder. */
  hue: number;
  frame: 'NORMAL' | 'NO_FACE' | 'MULTI' | 'AWAY';
  violationCount: number;
  lastViolation?: Violation;
  /** True while an AI site is open in the candidate's exam tab. */
  aiOpen: boolean;
  /** Signed URL of the candidate's reference photo. */
  photoUrl?: string;
}
export interface FeedViolation extends Violation { candidateName: string; userId: string }
export interface SessionDetail { violations: Violation[]; logs: BrowsingLog[] }

const seenFeed = new Map<string, Set<string>>();
const snapshotOf = (examId: string) => get<{ sessions: MonitorSession[]; feed: FeedViolation[] }>(`/monitor/exams/${encodeURIComponent(examId)}`);

async function findSession(sessionId: string): Promise<MonitorSession> {
  for (const examId of seenFeed.keys()) {
    const hit = (await snapshotOf(examId)).sessions.find((s) => s.id === sessionId);
    if (hit) return hit;
  }
  throw new Error('Session not found');
}

export const monitorApi = {
  listExams: () => get<Exam[]>('/monitor/exams'),
  async getSnapshot(examId: string) {
    const snap = await snapshotOf(examId);
    seenFeed.set(examId, new Set(snap.feed.map((v) => v.id)));
    return snap;
  },
  /** Polls the server; violations not seen in the previous poll are returned as new. */
  async tick(examId: string) {
    const seen = seenFeed.get(examId) ?? new Set<string>();
    const snap = await snapshotOf(examId);
    seenFeed.set(examId, new Set(snap.feed.map((v) => v.id)));
    return { sessions: snap.sessions, newViolations: snap.feed.filter((v) => !seen.has(v.id)) };
  },
  sendWarning: (sessionIds: string[], message: string) => post<{ sent: number }>('/sessions/warn', { ids: sessionIds, message }),
  async terminateSession(sessionId: string, reason: string) {
    await post(`/sessions/${encodeURIComponent(sessionId)}/terminate`, { reason });
    return findSession(sessionId);
  },
  getSessionDetail: (sessionId: string) => get<SessionDetail>(`/monitor/sessions/${encodeURIComponent(sessionId)}`),
  async reviewViolation(violationId: string, verdict: 'CONFIRMED' | 'OVERRULED') {
    const r = await post<{ violation: Violation; session: { id: string } }>(`/violations/${encodeURIComponent(violationId)}/review`, {
      verdict, reason: verdict === 'OVERRULED' ? 'Overruled from the live monitor after reviewing the evidence.' : 'Confirmed from the live monitor.',
    });
    return { violation: r.violation, session: await findSession(r.session.id) };
  },
};
