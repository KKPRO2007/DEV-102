/**
 * The exam tab: exam link and password → one-time code → face check → consent → screen share → waiting room → exam → receipt.
 * Candidates join with the exam link and password from their email, like the desktop app. While the exam runs it autosaves answers, sends
 * heartbeats, and uploads webcam and screen frames; background.ts reports browsing. Nothing warns the candidate.
 */
import { parseInviteToken } from '../../desktop/src/lib/invite-token';
import { ApiError, call, deviceId, store } from './api';

interface Option { id: string; text: string }
interface Question { id: string; type: 'MCQ' | 'NUMERIC'; text: string; options: Option[]; multi: boolean; marks: number; unit?: string }
interface Paper {
  sessionId: string;
  exam: { title: string; code: string };
  questions: Question[];
  saved: { answers: Record<string, string[]>; values: Record<string, number>; flagged: string[] };
  remainingSec: number;
  instructions?: string;
}
interface Receipt { receiptId: string | null; submittedAt: string; answered: number; total: number; status: string }

const app = document.getElementById('app') as HTMLElement;
let token = '';
let camera: MediaStream | null = null;
let screen: MediaStream | null = null;

/* ---------------------------------------------------------------- tiny DOM helpers */

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const c of children) if (c) el.append(c);
  return el;
}
const show = (...children: Child[]) => app.replaceChildren(...children.filter((c): c is Node | string => Boolean(c)));
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

function card(title: string, sub: string, ...body: Child[]): HTMLElement {
  return h('main', { class: 'card' }, h('img', { src: 'icons/icon128.png', alt: '', class: 'logo' }), h('h1', {}, title), h('p', { class: 'muted' }, sub), ...body);
}

/** A form whose submit button shows progress and whose errors appear inline. */
function form(fields: Child[], label: string, onSubmit: () => Promise<void>): HTMLFormElement {
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'primary' }, label);
  const f = h('form', {}, ...fields, err, btn);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Please wait…';
    void onSubmit().catch((x: unknown) => { err.textContent = message(x); }).finally(() => { btn.disabled = false; btn.textContent = label; });
  });
  return f;
}
const field = (label: string, input: HTMLInputElement) => h('label', {}, label, input);

/* ---------------------------------------------------------------- steps */

function login(): void {
  const link = h('input', { required: true, autocomplete: 'off', placeholder: 'https://…/join/…' });
  const pass = h('input', { required: true, type: 'password', autocomplete: 'off' });
  show(card('Join your exam', 'Enter the exam link and password from your invitation email.',
    form([field('Exam link', link), field('Password', pass)], 'Continue', async () => {
      const invite = parseInviteToken(link.value);
      if (!invite) throw new Error('That is not a valid exam link. Copy the whole link from your email.');
      // Checked first, so a proctor's link is not locked to this browser by mistake.
      const { role } = await call<{ role: string }>('GET', `/auth/invites/${invite}`);
      if (role !== 'CANDIDATE') throw new Error('This is a proctor link. Proctors use the desktop app.');
      const r = await call<{ token: string }>('POST', '/auth/invites/login', { token: invite, password: pass.value, deviceId: await deviceId() });
      token = r.token;
      await store.set({ token });
      await otp();
    })));
  link.focus();
}

async function otp(): Promise<void> {
  const sent = await call<{ challengeId: string; sentTo: string; devCode?: string }>('POST', '/auth/otp/send', {}, token);
  const code = h('input', { required: true, inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6, autocomplete: 'one-time-code' });
  show(card('Enter your one-time code', `We sent a 6-digit code to ${sent.sentTo}.`,
    sent.devCode ? h('p', { class: 'hint' }, `Development server: your code is ${sent.devCode}`) : null,
    form([field('Code', code)], 'Verify', async () => {
      await call('POST', '/auth/otp/verify', { challengeId: sent.challengeId, code: code.value.trim() }, token);
      await face();
    })));
  code.focus();
}

async function face(): Promise<void> {
  camera ??= await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }).catch(() => {
    throw new Error('Allow camera access for this extension, then try again. The camera is required during the exam.');
  });
  const video = h('video', { autoplay: true, muted: true, playsInline: true, class: 'camera' });
  video.srcObject = camera;
  show(card('Face check', 'Look at the camera with your face centred and well lit, then capture.',
    video,
    form([], 'Capture and verify', async () => {
      const image = grab(video, 640, 0.85);
      if (!image) throw new Error('The camera is not ready yet. Wait a moment and try again.');
      const r = await call<{ passed: boolean; reason?: string }>('POST', '/auth/face/verify', { image }, token);
      if (!r.passed) throw new Error(r.reason ?? 'Your face did not match the photo on file. Adjust your lighting and try again.');
      consent();
    })));
}

function consent(): void {
  const ok = h('input', { type: 'checkbox', required: true });
  show(card('Before you start', 'During the exam your proctor can see:',
    h('ul', {},
      h('li', {}, 'your entire screen, until you finish;'),
      h('li', {}, 'your webcam, with pictures kept as proof of flagged events;'),
      h('li', {}, 'every site you open in Chrome and when you switch tabs;'),
      h('li', {}, 'your searches, what you type on AI sites and what they answer.')),
    form([h('label', { class: 'check' }, ok, 'I understand and agree to be monitored')], 'Share entire screen', share)));
}

/** Asks for the whole screen, shows it back, and only then lets the candidate go on. Used again when an exam is reopened. */
async function share(): Promise<void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' }, audio: false } as DisplayMediaStreamOptions).catch(() => {
    throw new Error('Screen sharing is required to take this exam. Choose Entire screen and press Share.');
  });
  const track = stream.getVideoTracks()[0];
  const surface = (track?.getSettings() as (MediaTrackSettings & { displaySurface?: string }) | undefined)?.displaySurface;
  if (surface && surface !== 'monitor') {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(`You shared a ${surface}. Choose Entire screen.`);
  }
  screen = stream;
  const preview = h('video', { autoplay: true, muted: true, playsInline: true, class: 'preview' });
  preview.srcObject = stream;
  show(card('This is what your proctor sees', 'Your entire screen is shared until you finish the exam.',
    preview,
    h('p', { class: 'hint' }, 'Sharing is active'),
    form([], 'Continue to exam', start)));
}

async function start(): Promise<void> {
  try {
    const paper = await call<Paper>('POST', '/sessions/start', { consent: true }, token);
    await store.set({ sessionId: paper.sessionId });
    exam(paper);
  } catch (e) {
    if (e instanceof ApiError && e.details?.waiting) return waitingRoom(Date.now() + Date.parse(String(e.details.startsAt)) - Date.parse(String(e.details.serverTime)));
    throw e;
  }
}

/** Everything is ready; the exam opens by itself when the countdown ends. The server's clock decides. */
function waitingRoom(opensAt: number): void {
  const time = h('p', { class: 'countdown', role: 'timer' });
  show(card('You are in the waiting room', 'Stay here. Your exam starts by itself when the timer ends.', time));
  let looked = 0;
  const tick = () => {
    const left = Math.max(0, Math.ceil((opensAt - Date.now()) / 1000));
    time.textContent = left > 0 ? `${String(Math.floor(left / 3600)).padStart(2, '0')}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}` : 'Starting…';
    // A look at the server every 30 s picks up a changed start time; at zero the exam opens.
    if (left > 0 && ++looked < 30) return;
    looked = 0;
    window.clearInterval(timer);
    void start().catch((e: unknown) => show(card('Could not open the exam', message(e))));
  };
  const timer = window.setInterval(tick, 1000);
  tick();
}

/* ---------------------------------------------------------------- exam */

function exam(p: Paper): void {
  const answers: Record<string, string[]> = { ...p.saved.answers };
  const values: Record<string, number | null> = { ...p.saved.values };
  const flagged = new Set(p.saved.flagged);
  let index = 0;
  let remaining = p.remainingSec;
  let dirty = false;
  let ended = false;
  const timers: number[] = [];

  const clock = h('span', { class: 'clock' });
  const saveState = h('span', { class: 'muted' }, 'All answers saved');
  const nav = h('nav', { class: 'grid', ariaLabel: 'Questions' });
  const body = h('section', { class: 'question' });
  const thumb = h('video', { autoplay: true, muted: true, playsInline: true, class: 'thumb', ariaHidden: 'true' });
  thumb.srcObject = camera;
  const submitBtn = h('button', { class: 'primary', type: 'button' }, 'Submit exam');

  const answered = (q: Question) => (q.type === 'NUMERIC' ? values[q.id] != null : (answers[q.id]?.length ?? 0) > 0);

  const save = async () => {
    if (!dirty || ended) return;
    dirty = false;
    saveState.textContent = 'Saving…';
    try {
      await call('PUT', `/sessions/${p.sessionId}/answers`, { answers, values, flagged: [...flagged] }, token);
      saveState.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      dirty = true;
      saveState.textContent = `Not saved: ${message(e)}`;
      if (e instanceof ApiError && e.code === 'CONFLICT') void finish('MANUAL');
    }
  };
  let saveTimer = 0;
  const changed = () => {
    dirty = true;
    saveState.textContent = 'Unsaved changes…';
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 1200);
    renderNav();
  };

  function renderNav(): void {
    nav.replaceChildren(...p.questions.map((q, i) => {
      const b = h('button', { type: 'button', class: `qnum${i === index ? ' current' : ''}${answered(q) ? ' answered' : ''}${flagged.has(q.id) ? ' flagged' : ''}`, ariaLabel: `Question ${i + 1}` }, String(i + 1));
      b.onclick = () => { index = i; render(); };
      return b;
    }));
  }

  function render(): void {
    const q = p.questions[index];
    let input: HTMLElement;
    if (q.type === 'NUMERIC') {
      const n = h('input', { type: 'number', step: 'any', inputMode: 'decimal', value: values[q.id] != null ? String(values[q.id]) : '', ariaLabel: 'Your answer' });
      n.oninput = () => {
        const v = n.value.trim() === '' ? null : Number(n.value);
        values[q.id] = v !== null && Number.isFinite(v) ? v : null;
        changed();
      };
      input = h('div', { class: 'numeric' }, n, q.unit ? h('span', { class: 'muted' }, q.unit) : null);
    } else {
      input = h('div', { class: 'options' }, ...q.options.map((o) => {
        const box = h('input', { type: q.multi ? 'checkbox' : 'radio', name: q.id, checked: answers[q.id]?.includes(o.id) ?? false });
        box.onchange = () => {
          const cur = answers[q.id] ?? [];
          answers[q.id] = q.multi ? (box.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)) : [o.id];
          changed();
        };
        return h('label', { class: 'option' }, box, o.text);
      }));
    }
    const flag = h('button', { type: 'button', class: 'ghost' }, flagged.has(q.id) ? 'Unflag' : 'Flag for review');
    flag.onclick = () => { if (!flagged.delete(q.id)) flagged.add(q.id); changed(); render(); };
    const prev = h('button', { type: 'button', class: 'ghost', disabled: index === 0 }, 'Previous');
    prev.onclick = () => { index--; render(); };
    const next = h('button', { type: 'button', class: 'ghost', disabled: index === p.questions.length - 1 }, 'Next');
    next.onclick = () => { index++; render(); };
    body.replaceChildren(
      h('p', { class: 'muted' }, `Question ${index + 1} of ${p.questions.length} · ${q.marks} mark${q.marks === 1 ? '' : 's'}${q.multi ? ' · select all that apply' : ''}`),
      h('h2', {}, q.text),
      input,
      h('div', { class: 'row' }, prev, flag, next),
    );
    renderNav();
  }

  const tick = () => {
    remaining = Math.max(0, remaining - 1);
    clock.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left`;
    clock.classList.toggle('low', remaining <= 300);
    if (remaining === 0) void finish('TIME_UP');
  };

  async function finish(reason: 'MANUAL' | 'TIME_UP'): Promise<void> {
    if (ended) return;
    ended = true;
    timers.forEach(clearInterval);
    clearTimeout(saveTimer);
    submitBtn.disabled = true;
    const send = () => call<Receipt>('POST', `/sessions/${p.sessionId}/submit`, { answers, values, flagged: [...flagged], reason }, token);
    try {
      let r: Receipt | null = null;
      // Time-up has nobody to press Submit again, so it keeps trying through a network drop.
      for (let tries = 0; !r; tries++) {
        r = await send().catch(async (e: unknown) => {
          if (reason !== 'TIME_UP' || !(e instanceof ApiError) || e.code !== 'NETWORK' || tries >= 40) throw e;
          await new Promise((wait) => setTimeout(wait, 3000));
          return null;
        });
      }
      done(p, r, reason);
    } catch (e) {
      ended = false;
      submitBtn.disabled = false;
      saveState.textContent = `Submit failed: ${message(e)}`;
    }
  }

  submitBtn.onclick = () => {
    const left = p.questions.filter((q) => !answered(q)).length;
    if (confirm(left ? `${left} question${left === 1 ? ' is' : 's are'} unanswered. Submit anyway?` : 'Submit your exam? You cannot change answers afterwards.')) void finish('MANUAL');
  };

  timers.push(window.setInterval(tick, 1000));
  timers.push(window.setInterval(() => {
    void call<{ status: string; remainingSec: number }>('POST', `/sessions/${p.sessionId}/heartbeat`, { currentQuestion: index }, token)
      .then((r) => {
        remaining = r.remainingSec;
        if (r.status !== 'LIVE') void finish('MANUAL');
      })
      .catch(() => undefined);
  }, 15_000));
  // The webcam goes every 2 s so a phone or a second person is caught quickly; a slow network skips a turn.
  let sending = false;
  timers.push(window.setInterval(() => {
    const image = sending ? null : grab(thumb, 640, 0.72);
    if (!image || !navigator.onLine) return;
    sending = true;
    void call('POST', '/proctoring/frames', { sessionId: p.sessionId, image }, token).catch(() => undefined).finally(() => { sending = false; });
  }, 2000));
  const screenVideo = h('video', { autoplay: true, muted: true, playsInline: true });
  screenVideo.srcObject = screen;
  timers.push(window.setInterval(() => {
    const image = grab(screenVideo, 1280, 0.6);
    if (image && navigator.onLine) void call('POST', '/proctoring/screen', { sessionId: p.sessionId, image }, token).catch(() => undefined);
  }, 20_000));
  screen?.getVideoTracks()[0]?.addEventListener('ended', () => {
    void call('POST', '/proctoring/events', { sessionId: p.sessionId, code: 'SCREEN_SHARE_STOPPED' }, token).catch(() => undefined);
  });
  window.addEventListener('beforeunload', (e) => { if (!ended) { void save(); e.preventDefault(); } });

  show(h('div', { class: 'exam' },
    h('header', {}, h('div', {}, h('strong', {}, p.exam.title), h('span', { class: 'muted' }, ` · ${p.exam.code}`)), saveState, clock, submitBtn),
    h('div', { class: 'layout' }, h('aside', {}, nav, p.instructions ? h('p', { class: 'muted small' }, p.instructions) : null), body),
    thumb));
  tick();
  render();
}

function done(p: Paper, r: Receipt, reason: 'MANUAL' | 'TIME_UP'): void {
  camera?.getTracks().forEach((t) => t.stop());
  camera = null;
  screen?.getTracks().forEach((t) => t.stop());
  screen = null;
  void store.clear('sessionId', 'token');
  const title = r.status === 'TERMINATED' ? 'Your exam was ended by the invigilator' : reason === 'TIME_UP' ? 'Time is up: your exam was submitted' : 'Your exam has been submitted';
  show(card(title, `${p.exam.title} (${p.exam.code}) · ${new Date(r.submittedAt).toLocaleString()}`,
    h('dl', { class: 'facts' },
      h('dt', {}, 'Answered'), h('dd', {}, `${r.answered} of ${r.total}`),
      h('dt', {}, 'Reference'), h('dd', {}, r.receiptId ?? '—')),
    h('p', { class: 'muted' }, 'You can close this tab. Monitoring has stopped.')));
}

function grab(video: HTMLVideoElement, width: number, quality: number): string | null {
  if (!video.videoWidth) return null;
  const c = h('canvas', { width, height: Math.round((video.videoHeight / video.videoWidth) * width) });
  c.getContext('2d')?.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/* ---------------------------------------------------------------- start */

void (async () => {
  const tab = await chrome.tabs.getCurrent();
  await store.set({ examTabId: tab?.id });
  const saved = await store.get();
  if (saved.token && saved.sessionId) {
    // Reopened mid-exam: sharing needs a click, then /sessions/start returns the live paper with saved answers.
    token = saved.token;
    try {
      camera = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      show(card('Share your screen again', 'Your answers are saved. Share your entire screen to carry on.', form([], 'Share entire screen', share)));
      return;
    } catch {
      await store.clear('sessionId', 'token');
    }
  }
  login();
})();
