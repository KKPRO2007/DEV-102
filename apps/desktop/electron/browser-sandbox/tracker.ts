/**
 * Preload injected into every sandbox tab. Captures what the candidate types into search boxes,
 * text areas and AI chat inputs (when submitted or after a pause) and reports it to the exam
 * window, which logs it to the proctor. Shows a permanent notice so tracking is never hidden.
 */
import { ipcRenderer } from 'electron';

const MIN_LEN = 3;
let lastSent = '';
let timer: ReturnType<typeof setTimeout> | undefined;

function fieldText(el: Element | null): string {
  if (!el) return '';
  if (el instanceof HTMLInputElement) return ['text', 'search', 'url', ''].includes(el.type) ? el.value : '';
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLElement && el.isContentEditable) return el.innerText;
  return '';
}

function send(text: string, trigger: 'submit' | 'pause'): void {
  if (timer) clearTimeout(timer);
  const value = text.replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (value.length < MIN_LEN || value === lastSent) return;
  lastSent = value;
  ipcRenderer.sendToHost('sandbox:typed', { text: value, trigger, url: location.href, title: document.title });
}

document.addEventListener(
  'keydown',
  (e) => {
    const el = document.activeElement;
    const text = fieldText(el);
    if (!text) return;
    if (e.key === 'Enter' && !e.shiftKey) send(text, 'submit');
  },
  true,
);

document.addEventListener(
  'input',
  () => {
    if (timer) clearTimeout(timer);
    const el = document.activeElement;
    // A short pause is enough: the proctor sees typing almost as it happens.
    timer = setTimeout(() => send(fieldText(el), 'pause'), 800);
  },
  true,
);

// Pasted text (for example a copied exam question) is reported straight away.
document.addEventListener(
  'paste',
  () => {
    const el = document.activeElement;
    setTimeout(() => send(fieldText(el), 'pause'), 50);
  },
  true,
);

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement | null;
  const field = form?.querySelector('input[type=search], input[type=text], textarea, [contenteditable=true]') ?? null;
  send(fieldText(field), 'submit');
}, true);

// Copy and paste into tabs is blocked so exam questions cannot be pasted into a chat.
for (const type of ['copy', 'cut', 'paste'] as const) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    ipcRenderer.sendToHost('sandbox:clipboard', { type, url: location.href });
  }, true);
}

window.addEventListener('DOMContentLoaded', () => {
  const bar = document.createElement('div');
  bar.textContent = 'Proctored exam browser · everything you type here is recorded and visible to your invigilator';
  bar.setAttribute('style', 'position:fixed;z-index:2147483647;left:0;right:0;bottom:0;padding:4px 10px;font:12px Segoe UI,Arial,sans-serif;color:#fff;background:rgba(29,78,216,.92);text-align:center;pointer-events:none');
  document.documentElement.appendChild(bar);
});
