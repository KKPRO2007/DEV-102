import { HttpError, del, get, http, patch, post, put, qs, setToken } from './http'
import { takeBuffered } from './realtime'
import type { ViolationPolicy } from './examPolicy'
import type { BrowsingLog, Candidate, Exam, InviteStatus, Question, Role, Session, Severity, Violation, ViolationCode } from './types'

/* ------------------------------------------------------------------ errors */

/** Error surfaced to pages: HTTP status, server error code and whether retrying can help. */
export class ApiError extends Error {
  constructor(message: string, readonly status = 500, readonly code = 'SERVER', readonly retryable = true) {
    super(message)
    this.name = 'ApiError'
  }
}

async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof HttpError) throw new ApiError(e.message, e.status || 503, e.code, ['NETWORK', 'SERVER', 'RATE_LIMITED'].includes(e.code))
    throw e
  }
}
const items = <T>(p: Promise<{ items: T[] }>) => p.then((r) => r.items)

/* ------------------------------------------------------------------ shared metadata */

export const VIOLATION_META: Record<ViolationCode, { label: string; severity: Severity }> = {
  MULTIPLE_FACES: { label: 'Multiple faces detected', severity: 'HIGH' },
  NO_FACE: { label: 'No face in frame', severity: 'MEDIUM' },
  GAZE_AWAY: { label: 'Looking away from screen', severity: 'LOW' },
  FACE_MISMATCH: { label: 'Face does not match ID photo', severity: 'CRITICAL' },
  AI_SITE_OPENED: { label: 'Opened an AI website', severity: 'HIGH' },
  AI_QUERY_DETECTED: { label: 'Typed an AI-style query', severity: 'CRITICAL' },
  BLACKLISTED_APP: { label: 'Blacklisted app running', severity: 'HIGH' },
  SCREEN_MIRRORING: { label: 'Screen mirroring detected', severity: 'HIGH' },
  MULTI_MONITOR: { label: 'Extra monitor connected', severity: 'HIGH' },
  VM_DETECTED: { label: 'Virtual machine detected', severity: 'CRITICAL' },
  REMOTE_DESKTOP: { label: 'Remote desktop session active', severity: 'CRITICAL' },
  EXTERNAL_DEVICE: { label: 'External device attached', severity: 'MEDIUM' },
  CLIPBOARD_USE: { label: 'Clipboard used', severity: 'MEDIUM' },
  SHORTCUT_BLOCKED: { label: 'Blocked shortcut pressed', severity: 'LOW' },
  SCREEN_SHARE_STOPPED: { label: 'Screen share stopped', severity: 'HIGH' },
  CAMERA_BLOCKED: { label: 'Camera blocked or covered', severity: 'HIGH' },
  MULTI_LOGIN: { label: 'Second login detected', severity: 'CRITICAL' },
  NETWORK_LOST: { label: 'Network connection lost', severity: 'LOW' },
  WINDOW_BLUR: { label: 'Exam window lost focus', severity: 'MEDIUM' },
  VOICE_DETECTED: { label: 'Voice detected', severity: 'MEDIUM' },
  MIC_BLOCKED: { label: 'Microphone muted or disconnected', severity: 'HIGH' },
  PHONE_DETECTED: { label: 'Phone visible on camera', severity: 'HIGH' },
  NOTES_DETECTED: { label: 'Book or notes visible on camera', severity: 'MEDIUM' },
}

export const SEVERITY_COLOR: Record<Severity, string> = { LOW: '#94A3B8', MEDIUM: '#F59E0B', HIGH: '#EA580C', CRITICAL: '#DC2626' }

/* ------------------------------------------------------------------ auth and public */

export interface AuthUser { id: string; name: string; email: string; role: Role; examId?: string; candidateId?: string }

/** Seeded demo accounts (database/prisma/seed.ts). */
export const DEMO_CREDENTIALS = {
  admin: { identifier: 'admin@wue.in', password: 'Admin@123' },
  mentor: { identifier: 'mentor@wue.in', password: 'Mentor@123' },
  candidate: { examId: 'CPA-26', identifier: 'WUE26DEMO', password: 'Demo@2026' },
} as const

/** Candidates sign in with an exam code; staff with an email. */
export async function login(input: { identifier: string; password: string; examId?: string }): Promise<{ token: string; user: AuthUser }> {
  const r = await call(input.examId
    ? post<{ token: string; user: AuthUser }>('/auth/login', { examId: input.examId, userId: input.identifier, password: input.password, channel: 'web' })
    : post<{ token: string; user: AuthUser }>('/auth/staff/login', { email: input.identifier, password: input.password }))
  setToken(r.token)
  return r
}

export interface PlatformStats { examsConducted: number; candidatesProctored: number; violationsCaught: number; uptimePct: number }
export const getPlatformStats = () => call(get<PlatformStats>('/public/stats'))

/* ------------------------------------------------------------------ dashboard */

export interface KpiSeries { value: number; deltaPct: number; series: number[] }
export interface DashboardSummary { liveExams: KpiSeries; candidatesOnline: KpiSeries; violationsToday: KpiSeries; avgRisk: KpiSeries }
export interface LivePoint { ts: number; label: string; online: number; violations: number }
export interface ViolationTypeStat { code: ViolationCode; label: string; severity: Severity; count: number }
export type ActivityKind = 'VIOLATION' | 'SESSION_STARTED' | 'SESSION_SUBMITTED' | 'WARNING_SENT' | 'TERMINATED' | 'EMAIL_SENT' | 'EXAM_PUBLISHED'
export interface ActivityItem { id: string; kind: ActivityKind; at: string; examCode: string; candidateName?: string; code?: ViolationCode; severity?: Severity; text: string }
export type NotificationTone = 'info' | 'success' | 'warning' | 'danger'
export interface AdminNotification { id: string; title: string; body: string; at: string; tone: NotificationTone; read: boolean; href?: string }

export const getDashboardSummary = () => call(get<DashboardSummary>('/admin/dashboard/summary'))
export const getLiveSeries = () => call(get<LivePoint[]>('/admin/dashboard/live-series'))
export const getViolationsByType = () => call(get<ViolationTypeStat[]>('/admin/dashboard/violations-by-type'))
export const getRecentActivity = () => call(get<ActivityItem[]>('/admin/activity?limit=14'))
export const listNotifications = () => call(get<AdminNotification[]>('/admin/notifications'))
export const markAllNotificationsRead = () => call(post<void>('/admin/notifications/read-all'))

/* ------------------------------------------------------------------ exams */

export type NewExamInput = Omit<Exam, 'id' | 'status' | 'candidateCount'>
export interface ExamExtras {
  category: string; description: string; instructions: string; lateEntryMin: number; checkInMin: number
  negativeValue: number; allowCalculator: boolean; releaseResults: 'IMMEDIATE' | 'AFTER_REVIEW' | 'MANUAL'
  /** Set when an admin releases a MANUAL exam's results. */
  resultsReleasedAt?: string | null; resultsReleasedBy?: string | null
}
export interface ExamDetail { exam: Exam; extras: ExamExtras; policy: ViolationPolicy }
export interface CreateExamPayload { status: 'DRAFT' | 'SCHEDULED'; exam: NewExamInput; extras: ExamExtras; policy: ViolationPolicy }

export const listExams = () => call(items(get<{ items: Exam[] }>('/exams?pageSize=200&sort=startsAt&dir=desc')))
export const getUpcomingExams = () => call(items(get<{ items: Exam[] }>('/exams?status=SCHEDULED&sort=startsAt&dir=asc&pageSize=5')))
export const getExam = (id: string) => call(get<Exam>(`/exams/${id}`))
export const getExamDetail = (id: string) => call(get<ExamDetail>(`/exams/${id}/detail`))
export const isExamCodeTaken = (code: string) => call(get<{ taken: boolean }>(`/exams/code-check${qs({ code })}`)).then((r) => r.taken)
export const createExamFromWizard = (p: CreateExamPayload) => call(post<Exam>('/exams', { ...p.exam, status: p.status, extras: p.extras, policy: p.policy }))
export const updateExam = (id: string, change: Partial<Omit<Exam, 'id'>>) => call(patch<Exam>(`/exams/${id}`, change))
export const updateExamSettings = (id: string, settings: Exam['settings']) => updateExam(id, { settings })
export const duplicateExam = (id: string) => call(post<Exam>(`/exams/${id}/duplicate`))
export const deleteExam = (id: string) => call(del<{ id: string }>(`/exams/${id}`)).then(() => undefined)
export const deleteExams = (ids: string[]) => call(post<{ deleted: string[]; skipped: string[] }>('/exams/bulk-delete', { ids }))
export const savePolicy = (id: string, policy: ViolationPolicy) => call(put<ViolationPolicy>(`/exams/${id}/policy`, policy)).then(() => undefined)

export interface CandidateSummary { total: number; pending: number; emailed: number; failed: number; inExam: number; submitted: number; disqualified: number }
export interface ExamViolationSummary {
  total: number; flaggedSessions: number; autoSubmitted: number
  byType: { code: ViolationCode; label: string; severity: Severity; count: number }[]
  bySeverity: Record<Severity, number>
}
export const getCandidateSummary = (id: string) => call(get<CandidateSummary>(`/exams/${id}/candidate-summary`))
export const getExamViolationSummary = (id: string) => call(get<ExamViolationSummary>(`/exams/${id}/violation-summary`))

/* ------------------------------------------------------------------ questions */

export type QuestionDraft = Omit<Question, 'id' | 'examId'>
export const listQuestions = (examId: string) => call(get<Question[]>(`/exams/${examId}/questions`))
export const saveQuestion = (examId: string, draft: QuestionDraft, id?: string) =>
  call(id ? put<Question>(`/exams/${examId}/questions/${id}`, draft) : post<Question>(`/exams/${examId}/questions`, draft))
export const duplicateQuestion = (examId: string, id: string) => call(post<Question>(`/exams/${examId}/questions/${id}/duplicate`))
export const deleteQuestions = (examId: string, ids: string[]) => call(post(`/exams/${examId}/questions/bulk-delete`, { ids })).then(() => undefined)
export const reorderQuestions = (examId: string, ids: string[]) => call(put(`/exams/${examId}/questions/order`, { ids })).then(() => undefined)
export const importQuestions = (examId: string, rows: QuestionDraft[]) =>
  call(post<{ questions: Question[] }>(`/exams/${examId}/questions/import`, { rows })).then((r) => r.questions)

/* ------------------------------------------------------------------ candidates and credentials */

export interface ImportRowError { row: number; message: string }
export interface CredentialRow { candidateId: string; name: string; email: string; examCode: string; userId: string; password: string }
export interface EmailResult { candidateId: string; emailStatus: Candidate['emailStatus']; error?: string; inviteId?: string; devLink?: string; outbox?: boolean }

export const listCandidates = (p: { examId?: string; q?: string; page?: number; pageSize?: number; sort?: string; dir?: 'asc' | 'desc' } = {}) =>
  call(get<{ items: Candidate[]; total: number }>(`/candidates${qs(p)}`))
export const importCandidates = (examId: string, rows: { name: string; email: string }[]) =>
  call(post<{ added: Candidate[]; duplicates: number; invalid: ImportRowError[]; credentials: CredentialRow[] }>(`/exams/${examId}/candidates/import`, { rows }))
/** The server fills {{password}} from its encrypted copy, so passwords never round-trip through the browser. */
export const sendCredentialEmail = (candidateId: string, template?: { subject: string; body: string }) =>
  call(post<EmailResult>(`/candidates/${candidateId}/send-credentials`, template ?? {}))
export const resetCandidatePassword = (candidateId: string) => call(post<CredentialRow>(`/candidates/${candidateId}/reset-password`))
/** Fails with CONFLICT once the candidate has signed in (the stored copy is deleted then). */
export const revealCandidatePassword = (candidateId: string) => call(post<{ password: string }>(`/candidates/${candidateId}/reveal-password`))

/* ------------------------------------------------------------------ join links */

export interface ProctorInvite { inviteId: string; userId: string | null; name: string; email: string; status: InviteStatus; usedAt: string | null; deviceBound: boolean; createdAt: string }
export interface ProctorProfileLookup { profile: { name: string; email: string } | null; alreadyInvited: boolean; emailUnavailable: boolean }
/** devLink is returned only in development when no SMTP server is configured. */
export interface InviteSent { inviteId: string; devLink?: string; password?: string; outbox?: boolean }
export const listProctors = (examId: string) => call(get<ProctorInvite[]>(`/exams/${examId}/proctors`))
export const lookupProctorEmail = (examId: string, email: string) => call(get<ProctorProfileLookup>(`/exams/${examId}/proctors/lookup?email=${encodeURIComponent(email)}`))
export const inviteProctor = (examId: string, input: { name: string; email: string }) =>
  call(post<InviteSent & { userId: string; created: boolean }>(`/exams/${examId}/proctors`, input))
/** Public: what a join link is for, shown on /join/<token> before the person opens the desktop app. */
export interface InvitePreview { role: 'CANDIDATE' | 'MENTOR'; name: string; email: string; userId?: string; exam: { code: string; title: string; startsAt: string; endsAt: string; durationMin: number }; deviceBound: boolean }
export const previewInvite = (token: string) => call(get<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`))
export const resendInvite = (inviteId: string) => call(post<InviteSent>(`/invites/${inviteId}/resend`))
export const getInviteLink = (inviteId: string) => call(get<{ link: string }>(`/invites/${inviteId}/link`))
export const revealProctorPassword = (inviteId: string) => call(post<{ password: string }>(`/invites/${inviteId}/reveal-password`))
export const resetProctorPassword = (inviteId: string) => call(post<{ password: string }>(`/invites/${inviteId}/reset-password`))
export const revokeInvite = (inviteId: string) => call(post<{ inviteId: string; status: InviteStatus }>(`/invites/${inviteId}/revoke`))

/* ------------------------------------------------------------------ reports */

export interface ExamReport {
  examName: string; maxScore: number; passMark: number
  rows: { id: string; name: string; userId: string; score: number; durationMin: number; violations: number; risk: number; sessionId?: string }[]
  events: { candidateId: string; type: string; hour: number }[]
}
export const getExamReport = (examId: string) => call(get<ExamReport>(`/reports/exams/${examId}/summary`))

/* ------------------------------------------------------------------ mentor */

export type FinalOutcome = 'CLEAR' | 'WARN' | 'RETEST' | 'DISQUALIFY'
export interface ReviewRecord { violationId: string; verdict: 'CONFIRMED' | 'OVERRULED'; reason: string; at: string }
export interface FinalDecision { sessionId: string; outcome: FinalOutcome; note: string; decidedAt: string }
export interface RiskPoint { at: string; score: number }
export interface QueueItem { session: Session; candidate: Candidate; examTitle: string; examCode: string; violations: Violation[] }
export interface AssignedExam { exam: Exam; sessionCount: number; liveCount: number; flaggedCount: number }
export interface MentorDashboardData { mentorName: string; exams: AssignedExam[]; queue: QueueItem[] }
export interface SessionDetail { session: Session; candidate: Candidate; exam: Exam; violations: Violation[]; browsing: BrowsingLog[]; riskHistory: RiskPoint[]; decision?: FinalDecision }
export interface LiveEvent { sessionId: string; candidateName: string; violation: Violation; riskScore: number; warnings: number }

export const getMentorDashboard = () => call(get<MentorDashboardData>('/mentor/dashboard'))
export const getSessionDetail = (sessionId: string) => call(get<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}/detail`))
export const submitViolationReview = (input: { violationId: string; verdict: ReviewRecord['verdict']; reason: string }) =>
  call(post<{ record: ReviewRecord }>(`/violations/${encodeURIComponent(input.violationId)}/review`, { verdict: input.verdict, reason: input.reason })).then((r) => r.record)
export const submitFinalDecision = (input: { sessionId: string; outcome: FinalOutcome; note: string }) =>
  call(post<FinalDecision>(`/sessions/${encodeURIComponent(input.sessionId)}/decision`, { outcome: input.outcome, note: input.note }))

/** Violations arrive over Socket.IO and are buffered; pages written for polling drain one at a time. */
export function pollLiveEvent(sessionId?: string): Promise<LiveEvent | null> {
  const e = takeBuffered(sessionId)
  return Promise.resolve(e ? { sessionId: e.sessionId, candidateName: e.candidateName, violation: e.violation, riskScore: e.riskScore, warnings: e.warnings } : null)
}

export { http }

/* ------------------------------------------------------------------ candidate portal */

export interface Lobby {
  candidate: Candidate
  exam: Exam
  session?: Session
  msToStart: number
  canEnter: boolean
  instructions: string
  lateEntryMin: number
  faceRegistered: boolean
  result?: {
    receiptId: string | null; submittedAt: string; reason: string | null
    release?: ResultRelease
    /** Why the result is held back; absent once released. */
    message?: string
    summary?: ResultSummary
  }
}
export const getLobby = () => call(get<Lobby>('/candidate/lobby'))

export interface ResultRelease { scoreReleased: boolean; reviewReleased: boolean; blockedBy: string | null; reviewOpensAt: string | null }
export interface ResultSummary {
  score: number; totalMarks: number; percent: number; correct: number; wrong: number; unanswered: number
  negativeMarking: { enabled: boolean; value: number }
}
export interface ReviewItem {
  position: number; questionId: string; text: string; marks: number; earned: number
  status: 'CORRECT' | 'WRONG' | 'UNANSWERED'
  options: { id: string; text: string; picked: boolean; correct: boolean }[]
  /** Numeric questions only: what was typed and what was accepted. */
  numeric?: { given: number | null; value: number; tolerance: number; unit: string | null }
}
export interface CandidateResults {
  exam: { id: string; title: string; code: string }
  receiptId: string | null
  summary: ResultSummary
  questions: ReviewItem[]
  release: ResultRelease
}
export const getCandidateResults = () => call(get<CandidateResults>('/candidate/results'))
export const releaseExamResults = (examId: string) =>
  call(post<{ releasedAt: string; releasedBy: string | null; notified: number }>(`/exams/${examId}/release-results`))
