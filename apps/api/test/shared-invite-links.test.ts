import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const state = vi.hoisted(() => ({ invite: null as Record<string, unknown> | null, adminGate: null as unknown }));
const adminGate: RequestHandler = (req, res, next) => req.header('x-role') === 'admin' ? next() : res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required.' } });
state.adminGate = adminGate;

vi.mock('../src/lib/db.js', () => ({ prisma: { invite: { findUnique: vi.fn(async () => state.invite) } } }));
vi.mock('../src/lib/auth.js', () => ({ adminOnly: [state.adminGate], audit: () => undefined }));

const { encrypt } = await import('../src/lib/crypto.js');
const { config } = await import('../src/config.js');
const { invitesRouter } = await import('../src/modules/invites.js');
const { errorMiddleware } = await import('../src/lib/core.js');

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(invitesRouter);
  app.use(errorMiddleware);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  state.invite = {
    id: 'inv-1', role: 'CANDIDATE', tokenCipher: encrypt('ab'.repeat(24), config.JWT_SECRET),
    revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
  };
});

describe('shared invite links', () => {
  it('returns the same active link to multiple authorized admins', async () => {
    const request = (admin: string, role = 'admin') => fetch(`${base}/invites/inv-1/link`, { headers: { 'x-role': role, 'x-admin-id': admin } });
    const first = await request('admin-1');
    const second = await request('admin-2');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(await (await request('candidate', 'candidate')).json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('rejects expired, revoked and legacy links that have no encrypted token', async () => {
    const url = `${base}/invites/inv-1/link`;
    state.invite = { ...state.invite, expiresAt: new Date(Date.now() - 1) };
    expect((await fetch(url, { headers: { 'x-role': 'admin' } })).status).toBe(409);
    state.invite = { ...state.invite, expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() };
    expect((await fetch(url, { headers: { 'x-role': 'admin' } })).status).toBe(409);
    state.invite = { ...state.invite, revokedAt: null, tokenCipher: null };
    expect((await fetch(url, { headers: { 'x-role': 'admin' } })).status).toBe(409);
  });
});
