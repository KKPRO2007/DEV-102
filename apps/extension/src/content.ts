/**
 * Runs on AI sites. While an exam is live it reports what the candidate types and what the AI answers.
 * The candidate agreed to this on the consent screen.
 */
import { trackPage } from './page-tracker';
import type { ContentMessage } from './api';

const send = (msg: ContentMessage) => void chrome.runtime.sendMessage(msg).catch(() => undefined);

// Only track once a session is live: outside an exam the extension stays silent on these sites. The first answer can
// come back empty while the worker wakes, and a tab may have been open since before the exam, so it keeps asking.
const status: ContentMessage = { type: 'status' };
function start(): void {
  void chrome.runtime.sendMessage(status).then((r: { live?: boolean } | undefined) => {
    if (!r?.live) return setTimeout(start, 3000);
    return trackPage({
      typed: (text) => send({ type: 'typed', text, url: location.href, title: document.title }),
      reply: (prompt, text) => send({ type: 'reply', prompt, text, url: location.href, title: document.title }),
    });
  }).catch(() => setTimeout(start, 3000));
}
start();
