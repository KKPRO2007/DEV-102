import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/** Sending a candidate's link also emails a copy to the organization and the exam's proctors. */
const db = vi.hoisted(() => ({ proctors: [] as Array<{ user: { email: string; name: string; deletedAt: Date | null } | null }>, creator: null as { email: string; name: string } | null }));
const sent = vi.hoisted(() => [] as Array<{ to: string; kind: string; html: string }>);

vi.mock('../src/lib/db.js', () => ({
  prisma: {
    candidate: {
      findUnique: vi.fn(async () => ({
        id: 'c-1', name: 'Rahul Verma', email: 'rahul@example.com', userId: 'WUE261000', status: 'INVITED', examId: 'e-1',
        credentialCipher: null as string | null,
        exam: { id: 'e-1', title: 'Live Test', code: 'LIVE-01', createdById: 'org-1', startsAt: new Date('2026-10-29T10:00:00Z'), endsAt: new Date(Date.now() + 86_400_000) },
      })),
      update: vi.fn(async () => ({})),
    },
    user: {
      findFirst: vi.fn(async () => db.creator),
      findMany: vi.fn(async () => [{ email: 'other.admin@example.com', name: 'Other admin' }]),
    },
    invite: { findMany: vi.fn(async () => db.proctors), updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({ id: 'inv-1' })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));
const pass: RequestHandler = (_req, _res, next) => next();
vi.mock('../src/lib/auth.js', () => ({ adminOnly: [pass], staff: [pass], audit: () => undefined }));
vi.mock('../src/lib/mailer.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/mailer.js')>()),
  sendMail: vi.fn(async (m: { to: string; kind: string; html: string }) => { sent.push(m); return { ok: true }; }),
}));

const { prisma } = await import('../src/lib/db.js');
const { encrypt } = await import('../src/lib/crypto.js');
const { config } = await import('../src/config.js');
const { candidatesRouter } = await import('../src/modules/candidates.js');
const { errorMiddleware } = await import('../src/lib/core.js');

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(candidatesRouter);
  app.use(errorMiddleware);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  sent.length = 0;
  db.creator = { email: 'org@example.com', name: 'Organization' };
  db.proctors = [
    { user: { email: 'proctor@example.com', name: 'Proctor', deletedAt: null } },
    { user: { email: 'gone@example.com', name: 'Removed', deletedAt: new Date() } },
  ];
  const cand = vi.mocked(prisma.candidate.findUnique);
  cand.mockImplementation((async () => ({
    id: 'c-1', name: 'Rahul Verma', email: 'rahul@example.com', userId: 'WUE261000', status: 'INVITED', examId: 'e-1',
    credentialCipher: encrypt('Exam#1000', config.JWT_SECRET),
    exam: { id: 'e-1', title: 'Live Test', code: 'LIVE-01', createdById: 'org-1', startsAt: new Date('2026-10-29T10:00:00Z'), endsAt: new Date(Date.now() + 86_400_000) },
  })) as never);
});

const send = () => fetch(`${base}/candidates/c-1/send-credentials`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

describe('copies of a candidate link', () => {
  it('go to the exam creator and every active proctor, with the link and password', async () => {
    expect((await send()).status).toBe(200);
    const copies = sent.filter((m) => m.kind === 'credentials_copy');
    expect(copies.map((m) => m.to).sort()).toEqual(['org@example.com', 'proctor@example.com']);
    for (const m of copies) {
      expect(m.html).toContain('Exam#1000');
      expect(m.html).toContain('/join/');
      expect(m.html).toContain('Rahul Verma');
    }
    expect(sent.find((m) => m.kind === 'credentials')?.to).toBe('rahul@example.com');
  });

  it('go to every admin when the exam has no creator', async () => {
    db.creator = null;
    await send();
    expect(sent.filter((m) => m.kind === 'credentials_copy').map((m) => m.to).sort()).toEqual(['other.admin@example.com', 'proctor@example.com']);
  });
});
