import type { ExamSession, Severity, SubmitReason, ViolationCode } from '@prisma/client';
import { logger } from './core.js';
import { prisma } from './db.js';
import { SEVERITY_RANK, VIOLATION_META, readExtras, readPolicy, readSettings, scoreAnswers, toSession, toViolation } from './domain.js';
import { signEvidenceUrl } from './evidence.js';
import { realtime } from './realtime.js';
import { randomToken } from './crypto.js';

export type Outcome = 'LOGGED' | 'SUPPRESSED' | 'WARNING' | 'AUTO_SUBMIT';
export interface RecordInput {
  sessionId: string;
  code: ViolationCode;
  message?: string;
  severity?: Severity;
  source?: 'client' | 'agent' | 'server' | 'native';
  confidence?: number;
  evidenceId?: string;
  at?: Date;
}
export interface RecordResult {
  outcome: Outcome;
  violationId: string | null;
  warnings: number;
  maxWarnings: number;
  riskScore: number;
  status: ExamSession['status'];
}

/** Recomputes risk from non-overruled, non-suppressed violations using the exam's weights. */
export async function recomputeRisk(sessionId: string): Promise<number> {
  const s = await prisma.examSession.findUniqueOrThrow({ where: { id: sessionId }, select: { exam: { select: { policy: true } } } });
  const policy = readPolicy(s.exam.policy);
  const rows = await prisma.violation.groupBy({
    by: ['severity'],
    where: { sessionId, outcome: { not: 'SUPPRESSED' }, OR: [{ reviewed: null }, { reviewed: 'CONFIRMED' }] },
    _count: true,
  });
  const total = rows.reduce((sum, r) => sum + policy.weights[r.severity] * r._count, 0);
  const risk = Math.min(100, total);
  await prisma.examSession.update({ where: { id: sessionId }, data: { riskScore: risk } });
  await prisma.riskPoint.create({ data: { sessionId, score: risk } });
  return risk;
}

/**
 * Policy engine. Applies the exam's ViolationPolicy to one event:
 * cooldown suppression → risk → immediate auto-submit on CRITICAL → warnings up to maxWarnings →
 * auto-submit at or above autoSubmitFrom once warnings are used up. Emits socket events.
 */
export async function recordViolation(input: RecordInput): Promise<RecordResult> {
  const session = await prisma.examSession.findUniqueOrThrow({
    where: { id: input.sessionId },
    include: { exam: true, candidate: { select: { name: true, userId: true } } },
  });
  const policy = readPolicy(session.exam.policy);
  const settings = readSettings(session.exam.settings);
  const maxWarnings = Math.min(policy.maxWarnings, settings.maxWarnings);
  const severity = input.severity ?? VIOLATION_META[input.code].severity;
  const at = input.at ?? new Date();

  if (session.status !== 'LIVE' && session.status !== 'WAITING') {
    return { outcome: 'LOGGED', violationId: null, warnings: session.warnings, maxWarnings, riskScore: session.riskScore, status: session.status };
  }

  const recent = policy.cooldownSec > 0
    ? await prisma.violation.findFirst({
        where: { sessionId: session.id, code: input.code, at: { gte: new Date(at.getTime() - policy.cooldownSec * 1000) } },
        select: { id: true },
      })
    : null;

  let outcome: Outcome = 'LOGGED';
  let warnings = session.warnings;
  const rank = SEVERITY_RANK[severity];
  if (recent) outcome = 'SUPPRESSED';
  // Proctor-only exams never warn the candidate or end the session; the proctor sees every flag.
  else if (settings.proctorOnly) outcome = 'LOGGED';
  else if (policy.autoSubmit && settings.autoSubmit && policy.autoSubmitOnCritical && severity === 'CRITICAL') outcome = 'AUTO_SUBMIT';
  else if (rank >= SEVERITY_RANK[policy.warnFrom]) {
    if (warnings < maxWarnings) { warnings += 1; outcome = 'WARNING'; }
    else if (policy.autoSubmit && settings.autoSubmit && rank >= SEVERITY_RANK[policy.autoSubmitFrom]) outcome = 'AUTO_SUBMIT';
  }

  const v = await prisma.violation.create({
    data: {
      sessionId: session.id, code: input.code, severity, at, outcome,
      message: (input.message ?? VIOLATION_META[input.code].message).slice(0, 500),
      source: input.source ?? 'client', confidence: input.confidence ?? null, evidenceId: input.evidenceId ?? null,
    },
  });
  if (warnings !== session.warnings) await prisma.examSession.update({ where: { id: session.id }, data: { warnings } });
  const riskScore = outcome === 'SUPPRESSED' ? session.riskScore : await recomputeRisk(session.id);

  let status: ExamSession['status'] = session.status;
  if (outcome === 'AUTO_SUBMIT') {
    const reason: SubmitReason = severity === 'CRITICAL' ? 'CRITICAL_VIOLATION' : 'REPEATED_VIOLATIONS';
    const done = await finalizeSession(session.id, reason, { disqualify: true });
    status = done.status;
  }

  const fresh = await prisma.examSession.findUniqueOrThrow({ where: { id: session.id } });
  const payload = {
    sessionId: session.id, examId: session.examId, candidateName: session.candidate.name, userId: session.candidate.userId,
    violation: toViolation(v, signEvidenceUrl), session: toSession(fresh), riskScore, warnings, maxWarnings, outcome, status,
  };
  if (outcome !== 'SUPPRESSED') realtime.toExam(session.examId, 'violation:new', payload);
  if (outcome === 'WARNING') {
    realtime.toSession(session.id, 'proctor:warning', { code: input.code, severity, message: v.message, warnings, maxWarnings, final: warnings >= maxWarnings });
  }
  return { outcome, violationId: v.id, warnings, maxWarnings, riskScore, status };
}

/**
 * Ends a session: scores the saved answers, sets the receipt and statuses, and notifies both sides.
 * Idempotent: a session that already ended is returned unchanged.
 */
export async function finalizeSession(sessionId: string, reason: SubmitReason, opts: { disqualify?: boolean } = {}) {
  const s = await prisma.examSession.findUniqueOrThrow({ where: { id: sessionId }, include: { exam: true, answers: true } });
  if (s.status === 'SUBMITTED' || s.status === 'TERMINATED') return s;
  const questions = await prisma.question.findMany({ where: { examId: s.examId }, select: { id: true, marks: true, correctIds: true, type: true, answerKey: true } });
  const settings = readSettings(s.exam.settings);
  const extras = readExtras(s.exam.extras, s.exam.title);
  const values = new Map(s.answers.flatMap((a) => (a.value === null ? [] : [[a.questionId, a.value] as const])));
  const { score } = scoreAnswers(questions, new Map(s.answers.map((a) => [a.questionId, a.optionIds])), { enabled: settings.negativeMarking, value: extras.negativeValue }, values);
  const terminated = opts.disqualify || reason === 'TERMINATED_BY_MENTOR';
  const updated = await prisma.examSession.update({
    where: { id: sessionId },
    data: {
      status: terminated ? 'TERMINATED' : 'SUBMITTED', submitReason: reason, submittedAt: new Date(), score,
      receiptId: s.receiptId ?? `RCPT-${randomToken(4).toUpperCase()}`, progress: terminated ? s.progress : 100,
    },
  });
  await prisma.candidate.update({ where: { id: s.candidateId }, data: { status: terminated ? 'DISQUALIFIED' : 'SUBMITTED' } });
  realtime.toSession(sessionId, 'session:submitted', { reason, receiptId: updated.receiptId, status: updated.status });
  realtime.toExam(s.examId, 'session:status', { session: toSession(updated), reason });
  logger.info({ sessionId, reason, score }, 'session finalized');
  return updated;
}

/** A mentor overruled the violation that ended the session: reopen it if time remains, otherwise clear the disqualification. */
export async function maybeReinstate(sessionId: string): Promise<boolean> {
  const s = await prisma.examSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (s.status !== 'TERMINATED' || (s.submitReason !== 'CRITICAL_VIOLATION' && s.submitReason !== 'REPEATED_VIOLATIONS')) return false;
  const trigger = await prisma.violation.findFirst({ where: { sessionId, outcome: 'AUTO_SUBMIT' }, orderBy: { at: 'desc' } });
  if (!trigger || trigger.reviewed !== 'OVERRULED') return false;
  const timeLeft = s.deadlineAt.getTime() > Date.now() + 60_000;
  const updated = await prisma.examSession.update({
    where: { id: sessionId },
    data: timeLeft
      ? { status: 'LIVE', submitReason: null, submittedAt: null, warnings: Math.max(0, s.warnings - 1) }
      : { status: 'SUBMITTED', submitReason: 'MANUAL' },
  });
  await prisma.candidate.update({ where: { id: s.candidateId }, data: { status: timeLeft ? 'IN_EXAM' : 'SUBMITTED' } });
  realtime.toExam(s.examId, 'session:status', { session: toSession(updated), reason: 'REINSTATED' });
  realtime.toSession(sessionId, 'session:reinstated', { status: updated.status });
  return true;
}
