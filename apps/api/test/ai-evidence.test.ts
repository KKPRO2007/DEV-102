import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const mocks = vi.hoisted(() => ({
  recordViolation: vi.fn(),
  saveEvidence: vi.fn(),
  toExam: vi.fn(),
}));

vi.mock('../src/lib/db.js', () => ({
  prisma: {
    browsingLog: { create: vi.fn((args: { data: Record<string, unknown> }) => ({ id: `log-${String(args.data.url)}`, ...args.data })) },
    $transaction: vi.fn(async (rows: unknown[]) => rows),
  },
}));
vi.mock('../src/lib/auth.js', () => {
  const asCandidate: RequestHandler = (_req, _res, next) => next();
  return { candidateOnly: [asCandidate] };
});
vi.mock('../src/lib/security.js', () => {
  const pass: RequestHandler = (_req, _res, next) => next();
  return { limits: { frames: pass, ingest: pass } };
});
vi.mock('../src/modules/sessions.js', () => ({
  ownSession: vi.fn(async () => ({ id: 'sess-1', examId: 'exam-1', candidateId: 'cand-1', status: 'LIVE', startedAt: new Date(), questionOrder: [], exam: { settings: {} } })),
}));
vi.mock('../src/lib/evidence.js', () => ({
  decodeImage: (s: string) => (s.startsWith('data:image/jpeg') ? { buffer: Buffer.from('jpeg'), mime: 'image/jpeg' } : null),
  evidencePath: (p: string) => p,
  saveEvidence: mocks.saveEvidence,
}));
vi.mock('../src/lib/agent.js', () => ({ agent: { analyzeBrowsing: vi.fn(async () => ({ violations: [] })) } }));
vi.mock('../src/lib/policy.js', () => ({ recordViolation: mocks.recordViolation }));
vi.mock('../src/lib/realtime.js', () => ({ realtime: { snapshot: vi.fn(), toExam: mocks.toExam } }));

const { proctoringRouter } = await import('../src/modules/proctoring.js');
const { errorMiddleware } = await import('../src/lib/core.js');

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/proctoring', proctoringRouter);
  app.use(errorMiddleware);
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  mocks.recordViolation.mockReset().mockResolvedValue({ status: 'LIVE' });
  mocks.saveEvidence.mockReset().mockResolvedValue('ev-1');
});

const SHOT = `data:image/jpeg;base64,${'A'.repeat(200)}`;
const log = (entry: Record<string, unknown>) =>
  fetch(`${base}/proctoring/browsing-logs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'sess-1', entries: [entry] }) });
const call = (code: string) => mocks.recordViolation.mock.calls.map((c) => c[0] as Record<string, unknown>).find((v) => v.code === code);

describe('screenshots of AI tools', () => {
  it('attaches the screenshot to the typed query, with the tool and the exact text', async () => {
    expect((await log({ url: 'https://chatgpt.com/', title: 'ChatGPT', query: 'solve question 4', screenshot: SHOT })).status).toBe(200);
    expect(mocks.saveEvidence).toHaveBeenCalledOnce();
    expect(call('AI_QUERY_DETECTED')).toMatchObject({ evidenceId: 'ev-1', message: 'Typed into chatgpt.com: "solve question 4"' });
    expect(call('AI_SITE_OPENED')).not.toHaveProperty('evidenceId');
  });

  it('attaches the screenshot to the visit when nothing was typed', async () => {
    await log({ url: 'https://claude.ai/new', title: 'Claude', screenshot: SHOT });
    expect(call('AI_SITE_OPENED')).toMatchObject({ evidenceId: 'ev-1', message: 'Opened claude.ai (Claude) in a sandbox tab.' });
    expect(call('AI_QUERY_DETECTED')).toBeUndefined();
  });

  it('records AI use without a screenshot, and stores none for ordinary sites', async () => {
    await log({ url: 'https://gemini.google.com/app', title: 'Gemini', query: 'hello' });
    expect(call('AI_QUERY_DETECTED')).not.toHaveProperty('evidenceId');
    mocks.recordViolation.mockClear();
    await log({ url: 'https://en.wikipedia.org/wiki/Prime', title: 'Prime', screenshot: SHOT });
    expect(mocks.saveEvidence).not.toHaveBeenCalled();
    expect(mocks.recordViolation).not.toHaveBeenCalled();
  });

  it('ignores a screenshot that is not an image', async () => {
    await log({ url: 'https://chatgpt.com/', title: 'ChatGPT', query: 'hi there', screenshot: `data:text/html;base64,${'A'.repeat(200)}` });
    expect(mocks.saveEvidence).not.toHaveBeenCalled();
    expect(call('AI_QUERY_DETECTED')).not.toHaveProperty('evidenceId');
  });
});

describe('screenshots taken while away from the exam window', () => {
  const event = (body: Record<string, unknown>) =>
    fetch(`${base}/proctoring/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'sess-1', ...body }) });

  it('stores the screenshot as evidence of the event, with the AI tool named', async () => {
    const message = 'ChatGPT open outside the exam (chrome: "ChatGPT - Google Chrome")';
    expect((await event({ code: 'AI_SITE_OPENED', message, screenshot: SHOT })).status).toBe(200);
    expect(mocks.saveEvidence).toHaveBeenCalledOnce();
    expect(call('AI_SITE_OPENED')).toMatchObject({ evidenceId: 'ev-1', message });
  });

  it('records an event without a screenshot as before', async () => {
    await event({ code: 'WINDOW_BLUR', message: 'The exam window lost focus for 3 seconds.' });
    expect(mocks.saveEvidence).not.toHaveBeenCalled();
    expect(call('WINDOW_BLUR')).not.toHaveProperty('evidenceId');
  });
});
