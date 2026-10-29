import { io, type Socket } from 'socket.io-client';
import { startAudioMonitor, type AudioEvent } from './audio';
import { API_ORIGIN, HttpError, getToken, post, put } from './http';
import { getScreenStream } from './proctorMock';
import type { BrowsingLog, ViolationCode } from './types';

/* ---------------------------------------------------------------- offline queue */

type QueueItem =
  | { kind: 'event'; body: { code: ViolationCode; message?: string; at: string } }
  | { kind: 'browsing'; body: Omit<BrowsingLog, 'id' | 'sessionId'> };
type FrameKind = 'webcam' | 'screen';
/** A webcam or screen frame captured while offline; the image itself is stored under `key`. */
interface QueuedFrame { key: string; kind: FrameKind; at: string }
interface QueueState { sessionId: string; items: QueueItem[]; answers?: { answers: Record<string, string[]>; values?: Record<string, number | null>; flagged: string[] }; frames?: QueuedFrame[] }

const QUEUE_KEY = 'offline-queue';
/** Frames kept per kind while offline; when full, every other one is dropped so the whole outage stays covered. */
const MAX_FRAMES: Record<FrameKind, number> = { webcam: 120, screen: 30 };
let queue: QueueState | null = null;
let flushing = false;
let sendingFrame = false;
let serverReachable = true;
const memoryFrames = new Map<string, string>();
const queueListeners = new Set<(size: number) => void>();

/** No network, or the server stopped answering heartbeats. */
const isOffline = () => !navigator.onLine || !serverReachable;
const sessionClosed = (e: unknown) => e instanceof HttpError && (e.code === 'CONFLICT' || e.code === 'FORBIDDEN' || e.code === 'NOT_FOUND');

// Each frame gets its own encrypted file so adding one never rewrites the whole queue. The browser build keeps them in memory.
async function putFrame(key: string, image: string | null): Promise<void> {
  if (window.proctor) await (image ? window.proctor.store.set(key, image) : window.proctor.store.del(key));
  else if (image) memoryFrames.set(key, image);
  else memoryFrames.delete(key);
}
const getFrame = async (key: string): Promise<string | null> => (window.proctor ? window.proctor.store.get<string>(key) : memoryFrames.get(key) ?? null);

async function persist(): Promise<void> {
  const value = queue && (queue.items.length || queue.answers || queue.frames?.length) ? queue : null;
  try {
    if (window.proctor) {
      if (value) await window.proctor.store.set(QUEUE_KEY, value);
      else await window.proctor.store.del(QUEUE_KEY);
    } else if (value) localStorage.setItem(`dev102.${QUEUE_KEY}`, JSON.stringify(value));
    else localStorage.removeItem(`dev102.${QUEUE_KEY}`);
  } catch {
    /* storage full or unavailable: the in-memory queue still syncs while the app stays open */
  }
  queueListeners.forEach((l) => l(queueSize()));
}

export const queueSize = (): number => (queue?.items.length ?? 0) + (queue?.answers ? 1 : 0) + (queue?.frames?.length ?? 0);
export function onQueueChange(cb: (size: number) => void): () => void {
  queueListeners.add(cb);
  return () => queueListeners.delete(cb);
}

export async function restoreQueue(sessionId: string): Promise<void> {
  const raw = window.proctor ? await window.proctor.store.get<QueueState>(QUEUE_KEY) : JSON.parse(localStorage.getItem(`dev102.${QUEUE_KEY}`) ?? 'null');
  queue = raw && (raw as QueueState).sessionId === sessionId ? (raw as QueueState) : { sessionId, items: [] };
  queueListeners.forEach((l) => l(queueSize()));
}

export async function enqueue(sessionId: string, item: QueueItem | { kind: 'answers'; body: NonNullable<QueueState['answers']> }): Promise<void> {
  if (!queue || queue.sessionId !== sessionId) queue = { sessionId, items: [] };
  // Answers are idempotent snapshots: only the latest one needs to reach the server.
  if (item.kind === 'answers') queue.answers = item.body;
  else queue.items.push(item);
  if (queue.items.length > 2000) queue.items.splice(0, queue.items.length - 2000);
  await persist();
}

export async function enqueueFrame(sessionId: string, kind: FrameKind, image: string): Promise<void> {
  if (!queue || queue.sessionId !== sessionId) queue = { sessionId, items: [] };
  const key = `offline-frame-${Date.now()}-${kind}`;
  try {
    await putFrame(key, image);
  } catch {
    return; // storage full or unavailable: this frame is lost, the next one may fit
  }
  const frames = [...(queue.frames ?? []), { key, kind, at: new Date().toISOString() }];
  const same = frames.filter((f) => f.kind === kind);
  const thinned = same.length > MAX_FRAMES[kind] ? new Set(same.filter((_, i) => i % 2 === 1)) : new Set<QueuedFrame>();
  queue.frames = frames.filter((f) => !thinned.has(f));
  await Promise.all([...thinned].map((f) => putFrame(f.key, null).catch(() => undefined)));
  await persist();
}

async function dropFrames(frames: QueuedFrame[]): Promise<void> {
  if (!queue) return;
  const gone = new Set(frames.map((f) => f.key));
  queue.frames = (queue.frames ?? []).filter((f) => !gone.has(f.key));
  await Promise.all(frames.map((f) => putFrame(f.key, null).catch(() => undefined)));
  await persist();
}

/** Sends the oldest frame kept while offline, with its capture time, so the AI checks the outage after the fact. */
async function sendNextFrame(): Promise<void> {
  const f = queue?.frames?.[0];
  if (!queue || !f || sendingFrame || isOffline()) return;
  sendingFrame = true;
  try {
    const image = await getFrame(f.key);
    if (image) await post(f.kind === 'webcam' ? '/proctoring/frames' : '/proctoring/screen', { sessionId: queue.sessionId, image, capturedAt: f.at });
    await dropFrames([f]);
  } catch (e) {
    if (sessionClosed(e)) await dropFrames(queue.frames ?? []);
    else if (e instanceof HttpError && e.code === 'VALIDATION') await dropFrames([f]); // unreadable image: skip it
  } finally {
    sendingFrame = false;
  }
}

/** Replays queued work in order once the connection is back; stops at the first network failure. */
export async function flushQueue(): Promise<void> {
  if (!queue || flushing || !navigator.onLine) return;
  flushing = true;
  const sid = queue.sessionId;
  try {
    if (queue.answers) {
      await put(`/sessions/${sid}/answers`, queue.answers);
      queue.answers = undefined;
      await persist();
    }
    // Each batch leaves the queue only once the server accepted it, so a drop mid-sync neither loses nor resends entries.
    for (const kind of ['event', 'browsing'] as const) {
      const pending = () => queue?.items.filter((i) => i.kind === kind).slice(0, 100) ?? [];
      for (let batch = pending(); batch.length; batch = pending()) {
        const bodies = batch.map((i) => i.body);
        if (kind === 'event') await post('/proctoring/events', { sessionId: sid, events: bodies });
        else await post('/proctoring/browsing-logs', { sessionId: sid, entries: bodies });
        const sent = new Set<QueueItem>(batch);
        queue.items = queue.items.filter((i) => !sent.has(i));
        await persist();
      }
    }
  } catch (e) {
    // A finished session will never accept the backlog; drop it instead of retrying forever.
    if (sessionClosed(e)) {
      await dropFrames(queue.frames ?? []);
      queue = { sessionId: sid, items: [] };
      await persist();
    }
  } finally {
    flushing = false;
  }
}

/* ---------------------------------------------------------------- realtime */

export interface LiveHandlers {
  onWarning(info: { message: string; code?: ViolationCode; severity?: string; warnings?: number; maxWarnings?: number; final?: boolean; fromMentor: boolean }): void;
  onEnded(info: { reason: string; status?: string; receiptId?: string | null }): void;
  onKicked(reason: string): void;
  onClock(remainingSec: number): void;
  onReinstated(): void;
  /** Whether the server answers heartbeats; false after two misses even when the OS reports a network. */
  onServerReachable?(reachable: boolean): void;
}

let socket: Socket | null = null;

/** Stops every live channel: socket, heartbeat, webcam/screen uploads, audio checks and activity logging. */
export type StopLive = () => void;

export function startLive(sessionId: string, h: LiveHandlers, opts: { audioMonitoring?: boolean; liveAudio?: boolean } = {}): StopLive {
  const stops: (() => void)[] = [];

  socket = io(`${API_ORIGIN}/monitor`, { path: '/socket.io', auth: { token: getToken() }, transports: ['websocket'], reconnectionDelayMax: 5000 });
  const join = () => socket?.emit('session:join', { sessionId });
  socket.on('connect', join);
  socket.on('mentor:warn', (p: { message: string }) => h.onWarning({ message: p.message, fromMentor: true }));
  socket.on('proctor:warning', (p: { code: ViolationCode; severity: string; message: string; warnings: number; maxWarnings: number; final: boolean }) => h.onWarning({ ...p, fromMentor: false }));
  socket.on('session:submitted', (p: { reason: string; status: string; receiptId: string | null }) => h.onEnded(p));
  socket.on('session:terminate', (p: { reason: string }) => h.onEnded({ reason: `Terminated by the invigilator: ${p.reason}`, status: 'TERMINATED' }));
  socket.on('session:kicked', (p: { reason: string }) => h.onKicked(p.reason));
  socket.on('session:reinstated', () => h.onReinstated());
  stops.push(shareScreenOnRequest(socket, sessionId, Boolean(opts.liveAudio)));
  stops.push(() => {
    socket?.disconnect();
    socket = null;
  });

  // Server-synced clock and liveness; the server auto-submits on its own deadline regardless.
  let missed = 0;
  const beat = async () => {
    if (!navigator.onLine) return;
    try {
      const r = await post<{ status: string; remainingSec: number }>(`/sessions/${sessionId}/heartbeat`, {});
      missed = 0;
      serverReachable = true;
      h.onServerReachable?.(true);
      h.onClock(r.remainingSec);
      if (r.status !== 'LIVE') h.onEnded({ reason: 'The exam session has ended.', status: r.status });
      void flushQueue();
    } catch (e) {
      if (e instanceof HttpError && e.code === 'AUTH') h.onKicked(e.message);
      else if (e instanceof HttpError && e.code === 'NETWORK' && ++missed >= 2) {
        serverReachable = false;
        h.onServerReachable?.(false);
      }
    }
  };
  void beat();
  const hb = window.setInterval(() => void beat(), 10_000);
  stops.push(() => {
    window.clearInterval(hb);
    serverReachable = true;
  });
  const online = () => void flushQueue();
  window.addEventListener('online', online);
  stops.push(() => window.removeEventListener('online', online));

  stops.push(startFrameUploads(sessionId));
  stops.push(startActivityLog(sessionId));
  if (opts.audioMonitoring) stops.push(startAudioMonitor((e) => reportAudio(sessionId, e)));
  return () => stops.forEach((s) => s());
}

/* ---------------------------------------------------------------- live screen view (WebRTC) */

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
type RtcMessage = { sessionId: string; from?: string; payload?: { type?: string; sdp?: string; candidate?: string } & RTCIceCandidateInit };
export type ScreenState = 'connecting' | 'live' | 'unavailable' | 'ended';

/**
 * Candidate side: answers each proctor's offer with the entire-screen stream, one peer per proctor socket.
 * With `withAudio` the microphone travels on the same peer, live only (nothing is recorded).
 */
export function shareScreenOnRequest(s: Socket, sessionId: string, withAudio = false): () => void {
  const peers = new Map<string, { pc: RTCPeerConnection; ready: Promise<void> }>();
  const close = (id: string) => {
    peers.get(id)?.pc.close();
    peers.delete(id);
  };
  let mic: Promise<MediaStream | null> | null = null;
  const microphone = () => (mic ??= navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } }).catch(() => null));

  s.on('rtc:offer', (m: RtcMessage) => {
    const from = m.from;
    if (!from || m.sessionId !== sessionId || m.payload?.type !== 'offer') return;
    close(from);
    const stream = getScreenStream();
    if (!stream?.active) {
      s.emit('rtc:answer', { sessionId, to: from, payload: { type: 'unavailable' } });
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    stream.getVideoTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) s.emit('rtc:ice', { sessionId, to: from, payload: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) close(from); };
    const ready = (async () => {
      await pc.setRemoteDescription({ type: 'offer', sdp: m.payload?.sdp });
      if (withAudio) (await microphone())?.getAudioTracks().forEach((t) => pc.addTrack(t, stream));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      s.emit('rtc:answer', { sessionId, to: from, payload: { type: answer.type, sdp: answer.sdp } });
    })().catch(() => close(from));
    peers.set(from, { pc, ready });
  });

  s.on('rtc:ice', (m: RtcMessage) => {
    const peer = m.from ? peers.get(m.from) : undefined;
    if (!peer || !m.from || m.sessionId !== sessionId) return;
    if (m.payload?.type === 'bye') return close(m.from);
    const candidate = m.payload;
    if (candidate?.candidate) void peer.ready.then(() => peer.pc.addIceCandidate(candidate)).catch(() => undefined);
  });

  return () => {
    [...peers.keys()].forEach(close);
    void mic?.then((m) => m?.getTracks().forEach((t) => t.stop()));
  };
}

/** Mentor side: receive-only peer for one session's screen. The returned function hangs up. */
export function watchScreen(sessionId: string, onStream: (stream: MediaStream) => void, onState: (state: ScreenState) => void): () => void {
  const s = io(`${API_ORIGIN}/monitor`, { path: '/socket.io', auth: (cb) => cb({ token: getToken() }), transports: ['websocket'], reconnectionDelayMax: 5000 });
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let answered: () => void = () => undefined;
  const remoteSet = new Promise<void>((resolve) => { answered = resolve; });
  let stopped = false;

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    onStream(e.streams[0] ?? new MediaStream([e.track]));
    onState('live');
  };
  pc.onicecandidate = (e) => { if (e.candidate) s.emit('rtc:ice', { sessionId, payload: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => { if (!stopped && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) onState('ended'); };

  s.on('rtc:answer', (m: RtcMessage) => {
    if (m.sessionId !== sessionId || stopped) return;
    if (m.payload?.type === 'unavailable') return onState('unavailable');
    if (m.payload?.type !== 'answer') return;
    void pc.setRemoteDescription({ type: 'answer', sdp: m.payload.sdp }).then(answered).catch(() => onState('ended'));
  });
  s.on('rtc:ice', (m: RtcMessage) => {
    const candidate = m.payload;
    if (m.sessionId !== sessionId || !candidate?.candidate) return;
    void remoteSet.then(() => pc.addIceCandidate(candidate)).catch(() => undefined);
  });

  onState('connecting');
  s.once('connect', () => {
    void (async () => {
      const desc = await pc.createOffer();
      await pc.setLocalDescription(desc);
      s.emit('rtc:offer', { sessionId, payload: { type: desc.type, sdp: desc.sdp } });
    })().catch(() => onState('ended'));
  });

  return () => {
    stopped = true;
    s.emit('rtc:ice', { sessionId, payload: { type: 'bye' } });
    pc.close();
    window.setTimeout(() => s.disconnect(), 500); // let the hang-up reach the candidate first
  };
}

/* ---------------------------------------------------------------- mentor monitor */

export interface MonitorHandlers {
  /** Something about the exam's sessions changed (status, progress, violation, presence). */
  onChange(): void;
  onSnapshot(e: { sessionId: string; image: string; at: string }): void;
  onConnection(connected: boolean): void;
}

const MONITOR_EVENTS = ['violation:new', 'violation:reviewed', 'session:status', 'session:progress', 'session:presence', 'browsing:new'] as const;

/** Staff socket for one exam's room: pushes changes and webcam snapshots instead of polling. */
export function watchExam(examId: string, h: MonitorHandlers): () => void {
  const s = io(`${API_ORIGIN}/monitor`, { path: '/socket.io', auth: (cb) => cb({ token: getToken() }), transports: ['websocket'], reconnectionDelayMax: 5000 });
  s.on('connect', () => {
    s.emit('session:join', { examId });
    h.onConnection(true);
    h.onChange();
  });
  s.on('disconnect', () => h.onConnection(false));
  s.on('connect_error', () => h.onConnection(false));
  for (const event of MONITOR_EVENTS) s.on(event, () => h.onChange());
  s.on('frame:snapshot', (e: { sessionId: string; image: string; at: string }) => h.onSnapshot(e));
  return () => {
    s.emit('session:leave', { examId });
    s.disconnect();
  };
}

/* ---------------------------------------------------------------- audio events */

/** Only the event is sent; the warning comes back over the socket like any other violation. */
function reportAudio(sessionId: string, e: AudioEvent): void {
  const queued = () => void enqueue(sessionId, { kind: 'event', body: { code: e.code, message: e.message, at: new Date().toISOString() } });
  if (!navigator.onLine) return queued();
  void post('/proctoring/events', { sessionId, code: e.code, message: e.message, ...(e.confidence !== undefined ? { confidence: e.confidence } : {}) })
    .catch((err: unknown) => { if (!(err instanceof HttpError) || err.code === 'NETWORK') queued(); });
}

/* ---------------------------------------------------------------- webcam and screen frames */

function grab(video: HTMLVideoElement, width: number, quality: number): string | null {
  if (!video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * width);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function startFrameUploads(sessionId: string): () => void {
  const camVideo = document.createElement('video');
  camVideo.muted = true;
  const screenVideo = document.createElement('video');
  screenVideo.muted = true;

  const attachPreviewCamera = () => {
    const preview = document.querySelector<HTMLVideoElement>('[data-proctor-camera]');
    const stream = preview?.srcObject;
    if (!(stream instanceof MediaStream) || !stream.active || camVideo.srcObject === stream) return;
    camVideo.srcObject = stream;
    void camVideo.play().catch(() => undefined);
  };
  attachPreviewCamera();

  // A live frame that fails on the network is kept like an offline one.
  const keepOnNetworkError = (kind: FrameKind, frame: string) => (e: unknown) => {
    if (e instanceof HttpError && e.code === 'NETWORK') void enqueueFrame(sessionId, kind, frame);
  };

  // The webcam is checked every second so a phone or a second person is caught within a second or two.
  // Offline, a smaller frame is kept every 16th webcam tick (~16 s) and every 3rd screen tick (60 s).
  let camTick = 0;
  let camBusy = false;
  const camTimer = window.setInterval(() => {
    attachPreviewCamera();
    camTick += 1;
    if (isOffline()) {
      const kept = camTick % 16 === 0 ? grab(camVideo, 480, 0.6) : null;
      if (kept) void enqueueFrame(sessionId, 'webcam', kept);
      return;
    }
    // The backlog goes first, so the agent sees frames in the order they were taken.
    // Skip a tick while the previous frame is still being analysed, so a slow network never piles up requests.
    if (queue?.frames?.length || camBusy) return;
    const frame = grab(camVideo, 640, 0.72);
    if (!frame) return;
    camBusy = true;
    void post('/proctoring/frames', { sessionId, image: frame }).catch(keepOnNetworkError('webcam', frame)).finally(() => { camBusy = false; });
  }, 1000);
  const backfill = window.setInterval(() => void sendNextFrame(), 1000);

  let screenTick = 0;
  const screenTimer = window.setInterval(() => {
    const stream = getScreenStream();
    if (!stream) return;
    if (screenVideo.srcObject !== stream) {
      screenVideo.srcObject = stream;
      void screenVideo.play();
    }
    screenTick += 1;
    if (isOffline()) {
      const kept = screenTick % 3 === 0 ? grab(screenVideo, 960, 0.5) : null;
      if (kept) void enqueueFrame(sessionId, 'screen', kept);
      return;
    }
    const frame = grab(screenVideo, 1280, 0.6);
    if (frame) void post('/proctoring/screen', { sessionId, image: frame }).catch(keepOnNetworkError('screen', frame));
  }, 20_000);

  return () => {
    window.clearInterval(camTimer);
    window.clearInterval(backfill);
    window.clearInterval(screenTimer);
    camVideo.srcObject = null;
    screenVideo.srcObject = null;
  };
}

/* ---------------------------------------------------------------- activity summaries */

/**
 * Keystroke timing and mouse movement inside the exam window only. Raw key values are never
 * recorded: only counts, inter-key intervals and distances, batched every 30 seconds.
 */
function startActivityLog(sessionId: string): () => void {
  let keys = 0;
  let intervals: number[] = [];
  let lastKey = 0;
  let pasteLike = 0;
  let moves = 0;
  let distance = 0;
  let clicks = 0;
  let last: { x: number; y: number } | null = null;
  let idleSince = Date.now();
  let longestIdle = 0;

  const touch = () => {
    const now = Date.now();
    longestIdle = Math.max(longestIdle, now - idleSince);
    idleSince = now;
  };
  const onKey = () => {
    const now = performance.now();
    if (lastKey) {
      const gap = now - lastKey;
      intervals.push(Math.round(gap));
      if (gap < 15) pasteLike++; // bursts faster than a human can type suggest injected input
    }
    lastKey = now;
    keys++;
    touch();
  };
  const onMove = (e: MouseEvent) => {
    if (last) distance += Math.hypot(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
    moves++;
    touch();
  };
  const onClick = () => {
    clicks++;
    touch();
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mousedown', onClick, true);

  const flush = () => {
    if (!navigator.onLine) return;
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] ?? 0 : 0;
    const batches = [
      { kind: 'keys', data: { count: keys, medianIntervalMs: median, fastBursts: pasteLike, samples: intervals.slice(0, 150) } },
      { kind: 'mouse', data: { moves, distancePx: Math.round(distance), clicks, longestIdleMs: Math.max(longestIdle, Date.now() - idleSince) } },
    ];
    keys = 0; intervals = []; pasteLike = 0; moves = 0; distance = 0; clicks = 0; longestIdle = 0;
    void post('/proctoring/activity', { sessionId, batches }).catch(() => undefined);
  };
  const timer = window.setInterval(flush, 30_000);
  return () => {
    flush();
    window.clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mousedown', onClick, true);
  };
}
