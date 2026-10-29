import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Severity, ViolationCode } from '@prisma/client';

/** In-memory stand-in for the rows recordViolation touches: one exam, one session, its violations. */
const db = vi.hoisted(() => ({
  exam: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
  candidate: {} as Record<string, unknown>,
  violations: [] as Array<Record<string, unknown>>,
}));

vi.mock('../src/lib/db.js', () => {
  const sessionView = () => ({ ...db.session, exam: db.exam, candidate: { name: 'Asha Rao', userId: 'asha01' }, answers: [] });
  return {
    prisma: {
      examSession: {
        findUniqueOrThrow: vi.fn(async () => sessionView()),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(db.session, data)),
      },
      violation: {
        findFirst: vi.fn(async ({ where }: { where: { code: string; at: { gte: Date } } }) =>
          db.violations.find((v) => v.code === where.code && (v.at as Date) >= where.at.gte) ?? null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `v${db.violations.length + 1}`, reviewed: null, evidenceId: null, ...data };
          db.violations.push(row);
          return row;
        }),
        groupBy: vi.fn(async () => {
          const counts = new Map<Severity, number>();
          for (const v of db.violations) {
            if (v.outcome === 'SUPPRESSED' || (v.reviewed && v.reviewed !== 'CONFIRMED')) continue;
            counts.set(v.severity as Severity, (counts.get(v.severity as Severity) ?? 0) + 1);
          }
          return [...counts].map(([severity, _count]) => ({ severity, _count }));
        }),
      },
      riskPoint: { create: vi.fn(async () => ({})) },
      question: { findMany: vi.fn(async () => []) },
      candidate: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(db.candidate, data)) },
    },
  };
});

vi.mock('../src/lib/realtime.js', () => ({ realtime: { toExam: vi.fn(), toSession: vi.fn() } }));

const { recordViolation } = await import('../src/lib/policy.js');
const { realtime } = await import('../src/lib/realtime.js');

const START = new Date('2026-10-28T10:00:00Z');
let minute = 0;

/** Each event is a minute apart so the 30 s cooldown never hides one unless a test asks for it. */
function record(code: ViolationCode, at = new Date(START.getTime() + ++minute * 60_000)) {
  return recordViolation({ sessionId: 'sess-1', code, at });
}

function setup(policy: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  minute = 0;
  db.exam = { id: 'exam-1', title: 'Campus Placement Test', policy, settings, extras: {} };
  db.session = {
    id: 'sess-1', examId: 'exam-1', candidateId: 'cand-1', status: 'LIVE', warnings: 0, riskScore: 0,
    progress: 40, startedAt: START, receiptId: null, deadlineAt: new Date(START.getTime() + 3_600_000),
  };
  db.candidate = { id: 'cand-1', status: 'IN_EXAM' };
  db.violations = [];
}

describe('recordViolation with the default policy (2 warnings, warn from MEDIUM, auto-submit from HIGH)', () => {
  beforeEach(() => setup());

  it('logs a LOW event without using a warning', async () => {
    const r = await record('GAZE_AWAY');
    expect(r).toMatchObject({ outcome: 'LOGGED', warnings: 0, status: 'LIVE' });
    expect(realtime.toSession).not.toHaveBeenCalledWith('sess-1', 'proctor:warning', expect.anything());
  });

  it('warns on the first two MEDIUM or HIGH events and marks the second as final', async () => {
    const first = await record('WINDOW_BLUR');
    expect(first).toMatchObject({ outcome: 'WARNING', warnings: 1, maxWarnings: 2 });
    expect(realtime.toSession).toHaveBeenLastCalledWith('sess-1', 'proctor:warning', expect.objectContaining({ warnings: 1, final: false }));

    const second = await record('MULTIPLE_FACES');
    expect(second).toMatchObject({ outcome: 'WARNING', warnings: 2 });
    expect(realtime.toSession).toHaveBeenLastCalledWith('sess-1', 'proctor:warning', expect.objectContaining({ warnings: 2, final: true }));
    expect(db.session.warnings).toBe(2);
    expect(db.session.status).toBe('LIVE');
  });

  it('auto-submits and disqualifies on the next HIGH event once warnings are used up', async () => {
    await record('WINDOW_BLUR');
    await record('CLIPBOARD_USE');
    const r = await record('MULTIPLE_FACES');

    expect(r).toMatchObject({ outcome: 'AUTO_SUBMIT', status: 'TERMINATED', warnings: 2 });
    expect(db.session).toMatchObject({ status: 'TERMINATED', submitReason: 'REPEATED_VIOLATIONS' });
    expect(db.candidate.status).toBe('DISQUALIFIED');
    expect(realtime.toSession).toHaveBeenCalledWith('sess-1', 'session:submitted', expect.objectContaining({ reason: 'REPEATED_VIOLATIONS' }));
  });

  it('only logs a MEDIUM event after warnings are used up, because MEDIUM is below autoSubmitFrom', async () => {
    await record('WINDOW_BLUR');
    await record('CLIPBOARD_USE');
    const r = await record('NO_FACE');
    expect(r).toMatchObject({ outcome: 'LOGGED', status: 'LIVE', warnings: 2 });
  });

  it('auto-submits immediately on a CRITICAL event, even with no warnings used', async () => {
    const r = await record('FACE_MISMATCH');
    expect(r).toMatchObject({ outcome: 'AUTO_SUBMIT', status: 'TERMINATED', warnings: 0 });
    expect(db.session.submitReason).toBe('CRITICAL_VIOLATION');
  });

  it('suppresses a repeat of the same code inside the cooldown without using a warning', async () => {
    await record('WINDOW_BLUR', new Date(START.getTime()));
    const repeat = await record('WINDOW_BLUR', new Date(START.getTime() + 10_000));
    expect(repeat).toMatchObject({ outcome: 'SUPPRESSED', warnings: 1 });
    expect(realtime.toExam).toHaveBeenCalledTimes(1);
  });

  it('ignores events once the session has ended', async () => {
    db.session.status = 'SUBMITTED';
    const r = await record('FACE_MISMATCH');
    expect(r).toMatchObject({ outcome: 'LOGGED', violationId: null, status: 'SUBMITTED' });
    expect(db.violations).toHaveLength(0);
  });
});

describe('audio monitoring events', () => {
  beforeEach(() => setup());

  it('warns on VOICE_DETECTED but never auto-submits on talking alone', async () => {
    const outcomes = [];
    for (let i = 0; i < 4; i++) outcomes.push((await record('VOICE_DETECTED')).outcome);
    expect(outcomes).toEqual(['WARNING', 'WARNING', 'LOGGED', 'LOGGED']);
    expect(db.session.status).toBe('LIVE');
  });

  it('treats MIC_BLOCKED like a covered camera: auto-submit once warnings are used up', async () => {
    await record('VOICE_DETECTED');
    await record('VOICE_DETECTED');
    const r = await record('MIC_BLOCKED');
    expect(r).toMatchObject({ outcome: 'AUTO_SUBMIT', status: 'TERMINATED' });
    expect(db.session.submitReason).toBe('REPEATED_VIOLATIONS');
  });
});

describe('object detection events', () => {
  beforeEach(() => setup());

  it('treats PHONE_DETECTED as HIGH: warns first, then auto-submits once warnings are used up', async () => {
    const outcomes = [];
    for (let i = 0; i < 3; i++) outcomes.push((await record('PHONE_DETECTED')).outcome);
    expect(outcomes).toEqual(['WARNING', 'WARNING', 'AUTO_SUBMIT']);
    expect(db.session.submitReason).toBe('REPEATED_VIOLATIONS');
  });

  it('never auto-submits on NOTES_DETECTED alone', async () => {
    const outcomes = [];
    for (let i = 0; i < 4; i++) outcomes.push((await record('NOTES_DETECTED')).outcome);
    expect(outcomes).toEqual(['WARNING', 'WARNING', 'LOGGED', 'LOGGED']);
    expect(db.session.status).toBe('LIVE');
  });
});

describe('recordViolation with a configured threshold', () => {
  it('allows exactly policy.maxWarnings warnings before auto-submitting', async () => {
    setup({ maxWarnings: 3 }, { maxWarnings: 5 });
    const outcomes = [];
    for (const code of ['WINDOW_BLUR', 'CLIPBOARD_USE', 'NO_FACE', 'MULTIPLE_FACES'] as const) outcomes.push((await record(code)).outcome);
    expect(outcomes).toEqual(['WARNING', 'WARNING', 'WARNING', 'AUTO_SUBMIT']);
  });

  it('uses the lower of the policy and exam-settings limits', async () => {
    setup({ maxWarnings: 5 }, { maxWarnings: 1 });
    const first = await record('WINDOW_BLUR');
    expect(first).toMatchObject({ outcome: 'WARNING', maxWarnings: 1 });
    expect((await record('MULTIPLE_FACES')).outcome).toBe('AUTO_SUBMIT');
  });

  it('respects a stricter warnFrom and autoSubmitFrom', async () => {
    setup({ maxWarnings: 1, warnFrom: 'LOW', autoSubmitFrom: 'LOW' });
    expect((await record('GAZE_AWAY')).outcome).toBe('WARNING');
    expect((await record('SHORTCUT_BLOCKED')).outcome).toBe('AUTO_SUBMIT');
  });

  it('never auto-submits when auto-submit is turned off, even for CRITICAL events', async () => {
    setup({ autoSubmit: false });
    const outcomes = [];
    for (const code of ['FACE_MISMATCH', 'VM_DETECTED', 'REMOTE_DESKTOP'] as const) outcomes.push((await record(code)).outcome);
    expect(outcomes).toEqual(['WARNING', 'WARNING', 'LOGGED']);
    expect(db.session.status).toBe('LIVE');
  });

  it('honours the exam setting that turns auto-submit off', async () => {
    setup({}, { autoSubmit: false });
    expect((await record('AI_QUERY_DETECTED')).outcome).toBe('WARNING');
    expect(db.session.status).toBe('LIVE');
  });

  it('in proctor-only mode logs every event for the proctor but never warns the candidate or ends the exam', async () => {
    setup({}, { proctorOnly: true });
    vi.mocked(realtime.toSession).mockClear();
    const outcomes = [];
    for (const code of ['GAZE_AWAY', 'PHONE_DETECTED', 'AI_QUERY_DETECTED', 'MULTI_LOGIN'] as const) outcomes.push((await record(code)).outcome);
    expect(outcomes).toEqual(['LOGGED', 'LOGGED', 'LOGGED', 'LOGGED']);
    expect(db.session.status).toBe('LIVE');
    expect(db.session.warnings).toBe(0);
    expect(vi.mocked(realtime.toSession)).not.toHaveBeenCalled();
    expect(vi.mocked(realtime.toExam)).toHaveBeenCalledWith('exam-1', 'violation:new', expect.objectContaining({ outcome: 'LOGGED' }));
  });
});
