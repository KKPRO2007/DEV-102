import type { Server as HttpServer } from 'node:http';
import { Server, type Namespace, type Socket } from 'socket.io';
import { z } from 'zod';
import { allowedOrigin } from './security.js';
import { assertCurrent, verifyToken, type AuthClaims } from './auth.js';
import { logger } from './core.js';
import { prisma } from './db.js';

let nsp: Namespace | null = null;
const lastSnapshot = new Map<string, number>();

const rtcSchema = z.object({
  sessionId: z.string().min(1).max(64),
  to: z.string().max(64).optional(),
  payload: z.unknown(),
});

/**
 * /monitor namespace. Staff join "staff" and exam:{id} rooms; candidates are pinned to session:{id}.
 * WebRTC signaling is relayed only between a session's candidate and authenticated staff.
 */
export function initRealtime(server: HttpServer): Server {
  const io = new Server(server, {
    path: '/socket.io',
    cors: { origin: (origin, cb) => cb(null, allowedOrigin(origin)), credentials: false },
    maxHttpBufferSize: 2_000_000,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  nsp = io.of('/monitor');

  nsp.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    if (typeof token !== 'string') return next(new Error('AUTH'));
    try {
      const claims = verifyToken(token);
      assertCurrent(claims)
        .then(() => {
          socket.data.auth = claims;
          next();
        })
        .catch(() => next(new Error('AUTH')));
    } catch {
      next(new Error('AUTH'));
    }
  });

  nsp.on('connection', (socket: Socket) => {
    const claims = socket.data.auth as AuthClaims;
    const isStaff = claims.role !== 'CANDIDATE';
    if (isStaff) void socket.join('staff');

    socket.on('session:join', async (raw: unknown, ack?: (r: unknown) => void) => {
      const body = z.object({ sessionId: z.string().optional(), examId: z.string().optional() }).safeParse(raw);
      if (!body.success) return ack?.({ ok: false });
      if (isStaff) {
        if (body.data.examId) await socket.join(`exam:${body.data.examId}`);
        if (body.data.sessionId) await socket.join(`session:${body.data.sessionId}:staff`);
        return ack?.({ ok: true });
      }
      const s = body.data.sessionId ? await prisma.examSession.findUnique({ where: { id: body.data.sessionId }, select: { candidateId: true, examId: true } }) : null;
      if (!s || s.candidateId !== claims.sub) return ack?.({ ok: false });
      socket.data.sessionId = body.data.sessionId;
      await socket.join(`session:${body.data.sessionId}`);
      nsp?.to(`exam:${s.examId}`).emit('session:presence', { sessionId: body.data.sessionId, online: true });
      ack?.({ ok: true });
    });

    socket.on('session:leave', async (raw: unknown) => {
      const body = z.object({ examId: z.string().optional(), sessionId: z.string().optional() }).safeParse(raw);
      if (!body.success || !isStaff) return;
      if (body.data.examId) await socket.leave(`exam:${body.data.examId}`);
      if (body.data.sessionId) await socket.leave(`session:${body.data.sessionId}:staff`);
    });

    for (const event of ['rtc:offer', 'rtc:answer', 'rtc:ice'] as const) {
      socket.on(event, (raw: unknown) => {
        const msg = rtcSchema.safeParse(raw);
        if (!msg.success) return;
        if (isStaff) {
          nsp?.to(`session:${msg.data.sessionId}`).emit(event, { ...msg.data, from: socket.id });
        } else if (socket.data.sessionId === msg.data.sessionId) {
          const target = msg.data.to ? nsp?.to(msg.data.to) : nsp?.to(`session:${msg.data.sessionId}:staff`);
          target?.emit(event, { ...msg.data, from: socket.id });
        }
      });
    }

    socket.on('disconnect', () => {
      const sid = socket.data.sessionId as string | undefined;
      if (sid) nsp?.to('staff').emit('session:presence', { sessionId: sid, online: false });
    });
  });

  logger.info('realtime /monitor namespace ready');
  return io;
}

export const realtime = {
  toExam(examId: string, event: string, payload: unknown): void {
    nsp?.to(`exam:${examId}`).to('staff').emit(event, payload);
  },
  toSession(sessionId: string, event: string, payload: unknown): void {
    nsp?.to(`session:${sessionId}`).emit(event, payload);
  },
  /** Webcam snapshots reach proctors about once a second per session (the candidate app sends one per second). */
  snapshot(examId: string, sessionId: string, image: string): void {
    const now = Date.now();
    if (now - (lastSnapshot.get(sessionId) ?? 0) < 900) return;
    lastSnapshot.set(sessionId, now);
    nsp?.to(`exam:${examId}`).emit('frame:snapshot', { sessionId, image, at: new Date(now).toISOString() });
  },
  connections(): number {
    return nsp?.sockets.size ?? 0;
  },
};
