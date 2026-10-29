import type { Express, RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError, logger } from './core.js';

/** Desktop renderer origins are fixed: the Vite dev server and the packaged file:// app (sent as "null"). */
const DESKTOP_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'null', 'app://dev102'];

/** Development only: npm start moves the website to the next free port (3001, 3002…) when 3000 is busy. */
const DEV_LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;

export const allowedOrigin = (origin: string | undefined): boolean =>
  !origin || config.clientOrigins.includes(origin) || DESKTOP_ORIGINS.includes(origin) || config.extensionOrigins.includes(origin)
  || (!config.isProd && DEV_LOCALHOST.test(origin));

const limiter = (windowMin: number, limit: number, message: string) =>
  rateLimit({
    windowMs: windowMin * 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${req.auth?.sub ?? ''}|${req.ip ?? ''}`,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', message)),
  });

export const limits = {
  auth: limiter(15, 30, 'Too many sign-in attempts. Wait a few minutes and try again.'),
  otp: limiter(10, 8, 'Too many code requests. Wait a few minutes before asking for another code.'),
  ingest: limiter(1, 600, 'Too many monitoring events from this device.'),
  frames: limiter(1, 90, 'Frames are being sent too fast.'),
  general: limiter(1, 900, 'Too many requests. Slow down and try again.'),
};

const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

const accessLog: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level]({ reqId: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) }, 'request');
  });
  next();
};

export function applySecurity(app: Express): void {
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(requestId, accessLog);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'", 'data:'], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => (allowedOrigin(origin) ? cb(null, true) : cb(new AppError('FORBIDDEN', 'Origin not allowed'))),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Device-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 600,
    }),
  );
}
