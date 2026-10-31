/**
 * Service worker. While an exam session is live it reports visited tabs, searches, and what is typed into
 * AI sites and answered there to /proctoring/browsing-logs, and leaving the exam tab or the browser as
 * WINDOW_BLUR events with a picture of what came to the front.
 */
import { call, store, type ContentMessage, type Stored } from './api';

type Entry = { url: string; title: string; query?: string; reply?: string; screenshot?: string; at: string };

const BLUR_COOLDOWN_MS = 10_000;
const queue: Entry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let lastBlur = 0;
const lastUrl = new Map<number, string>();

const live = async (): Promise<(Required<Pick<Stored, 'token' | 'sessionId'>> & Stored) | null> => {
  const s = await store.get();
  return s.token && s.sessionId ? { ...s, token: s.token, sessionId: s.sessionId } : null;
};
const loggable = (url?: string): url is string => !!url && /^https?:/i.test(url);

/** The text searched for on a results page, e.g. google.com/search?q=... */
function searched(url: string): string | undefined {
  const u = new URL(url);
  // Google's robot check also carries a "q", which is a code rather than a search.
  if (!/(^|\.)(google|bing|duckduckgo|yahoo|brave)\.[a-z.]+$/.test(u.hostname) || u.pathname.startsWith('/sorry')) return undefined;
  return u.searchParams.get('q') ?? u.searchParams.get('p') ?? undefined;
}

/** A picture of the tab in front, kept as proof. Chrome cannot capture its own pages, so this can come back empty. */
const shot = (windowId?: number): Promise<string | undefined> =>
  (windowId === undefined ? chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 50 }) : chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 50 })).catch(() => undefined);

function enqueue(entry: Entry): void {
  queue.push(entry);
  clearTimeout(flushTimer);
  // Batch for a few seconds; typed queries go out at once because they matter most.
  flushTimer = setTimeout(() => void flush(), entry.query || queue.length >= 20 ? 0 : 3000);
}

async function flush(): Promise<void> {
  const s = await live();
  const entries = queue.splice(0, 100);
  if (!s || entries.length === 0) return;
  try {
    await call('POST', '/proctoring/browsing-logs', { sessionId: s.sessionId, entries }, s.token);
  } catch {
    // Offline or the session ended; the entries are dropped rather than retried forever.
  }
}

async function blur(message: string): Promise<void> {
  const s = await live();
  if (!s || Date.now() - lastBlur < BLUR_COOLDOWN_MS) return;
  lastBlur = Date.now();
  const screenshot = await new Promise((r) => setTimeout(r, 600)).then(() => shot());
  await call('POST', '/proctoring/events', { sessionId: s.sessionId, code: 'WINDOW_BLUR', message, ...(screenshot ? { screenshot } : {}) }, s.token).catch(() => undefined);
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void (async () => {
    const s = await live();
    if (!s) return;
    const tab = await chrome.tabs.get(tabId);
    if (tabId !== s.examTabId) void blur(`Switched from the exam tab to ${loggable(tab.url) ? new URL(tab.url).hostname : 'another tab'}.`);
    if (loggable(tab.url)) enqueue({ url: tab.url, title: tab.title ?? '', at: new Date().toISOString() });
  })();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !loggable(tab.url) || lastUrl.get(tabId) === tab.url) return;
  const url = tab.url;
  lastUrl.set(tabId, url);
  void live().then((s) => {
    if (!s) return;
    const query = searched(url);
    enqueue({ url, title: tab.title ?? '', ...(query ? { query } : {}), at: new Date().toISOString() });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => lastUrl.delete(tabId));

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) void blur('Chrome lost focus: another application was brought to the front.');
});

chrome.runtime.onMessage.addListener((msg: ContentMessage, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'status') {
    void live().then((s) => reply({ live: Boolean(s) }));
    return true; // reply asynchronously
  }
  if (msg.type === 'typed' && sender.tab) {
    void live().then(async (s) => {
      if (!s) return;
      const screenshot = await shot(sender.tab?.windowId);
      enqueue({ url: msg.url, title: msg.title, query: msg.text, ...(screenshot ? { screenshot } : {}), at: new Date().toISOString() });
    });
  }
  if (msg.type === 'reply' && sender.tab) {
    void live().then((s) => s && enqueue({ url: msg.url, title: msg.title, query: msg.prompt, reply: msg.text, at: new Date().toISOString() }));
  }
});

/** Opens the exam tab, or focuses it if it is already open. */
async function openExam(): Promise<void> {
  const { examTabId } = await store.get();
  if (examTabId !== undefined) {
    try {
      const tab = await chrome.tabs.update(examTabId, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      // The tab was closed; open a new one below.
    }
  }
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('exam.html') });
  await store.set({ examTabId: tab.id });
}

chrome.action.onClicked.addListener(() => void openExam());

// Adding the extension goes straight to the exam sign-in.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') void openExam();
});
