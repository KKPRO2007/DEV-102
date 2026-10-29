/** Thin fetch client for the DEV102 API: bearer token, envelope unwrap, timeouts and typed errors. */
const SERVER_KEY = 'dev102.server';
const BUILT_IN = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** Turns "192.168.1.20", "192.168.1.20:4000" or a full URL into an origin such as http://192.168.1.20:4000. */
export function normalizeServer(input: string): string | null {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.pathname !== '/' || u.search || u.hash || u.username) return null;
    // A bare address runs the API on its default port.
    if (!/^https?:\/\//i.test(raw) && !u.port) u.port = '4000';
    return u.origin;
  } catch {
    return null;
  }
}

function savedServer(): string | null {
  try {
    return normalizeServer(localStorage.getItem(SERVER_KEY) ?? '');
  } catch {
    return null;
  }
}

/**
 * The exam server this app talks to: the one chosen on the sign-in screen (for example the
 * organization's laptop on the same Wi-Fi, or its tunnel address), else the build default.
 * A live binding, so every module sees a change.
 */
export let API_ORIGIN = savedServer() ?? BUILT_IN;
const base = () => `${API_ORIGIN}/api/v1`;

/** Saves the exam server; returns the normalised origin, or null if the address is not valid. */
export function setServer(input: string): string | null {
  const origin = input.trim() ? normalizeServer(input) : BUILT_IN;
  if (!origin) return null;
  API_ORIGIN = origin;
  try {
    if (origin === BUILT_IN) localStorage.removeItem(SERVER_KEY);
    else localStorage.setItem(SERVER_KEY, origin);
  } catch {
    /* storage unavailable: the choice lasts for this run */
  }
  return origin;
}

export type HttpErrorCode = 'NETWORK' | 'AUTH' | 'FORBIDDEN' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'LOCKED' | 'RATE_LIMITED' | 'SERVER';

export class HttpError extends Error {
  constructor(message: string, readonly code: HttpErrorCode, readonly status: number, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
  }
}

let token: string | null = sessionStorage.getItem('dev102.token');
const authListeners = new Set<() => void>();

export function setToken(next: string | null): void {
  token = next;
  if (next) sessionStorage.setItem('dev102.token', next);
  else sessionStorage.removeItem('dev102.token');
}
export const getToken = (): string | null => token;
/** Called when the server rejects the token (expired, or this account signed in elsewhere). */
export function onAuthLost(cb: () => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

export async function http<T>(method: string, path: string, body?: unknown, opts: { timeoutMs?: number; raw?: boolean } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new HttpError(navigator.onLine ? 'Could not reach the exam server. Check your connection and try again.' : 'You are offline.', 'NETWORK', 0);
  } finally {
    window.clearTimeout(timer);
  }
  if (opts.raw && res.ok) return res as unknown as T;
  const json = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: { code: HttpErrorCode; message: string; details?: Record<string, unknown> } } | null;
  if (!res.ok || !json?.ok) {
    const err = json?.error;
    const code = err?.code ?? (res.status >= 500 ? 'SERVER' : 'VALIDATION');
    if (code === 'AUTH' && token && !path.startsWith('/auth/login') && !path.startsWith('/auth/staff')) authListeners.forEach((l) => l());
    throw new HttpError(err?.message ?? `Request failed (${res.status})`, code, res.status, err?.details);
  }
  return json.data as T;
}

export const get = <T>(path: string) => http<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => http<T>('POST', path, body ?? {});
export const put = <T>(path: string, body: unknown) => http<T>('PUT', path, body);

/** Real round-trip latency plus a ~1 MB download to estimate throughput. */
export async function measureNetwork(onProgress?: (mbps: number, pct: number) => void): Promise<{ mbps: number; latencyMs: number }> {
  const pings: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await fetch(`${API_ORIGIN}/health`, { cache: 'no-store' });
    pings.push(performance.now() - t);
  }
  const latencyMs = Math.round(Math.min(...pings));
  const t0 = performance.now();
  const res = await fetch(`${base()}/net/speed?bytes=1500000&r=${Math.random()}`, { cache: 'no-store' });
  const reader = res.body?.getReader();
  let received = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      const sec = (performance.now() - t0) / 1000;
      onProgress?.((received * 8) / 1e6 / Math.max(sec, 0.05), Math.min(100, (received / 1_500_000) * 100));
    }
  }
  const sec = (performance.now() - t0) / 1000;
  return { mbps: Math.round(((received * 8) / 1e6 / Math.max(sec, 0.05)) * 10) / 10, latencyMs };
}
