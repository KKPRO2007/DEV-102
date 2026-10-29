/**
 * While the candidate is away from the exam window (another browser or app), proctors still see
 * what they use: the real screen as screenshots, and the AI tool named from the open window titles.
 * Typing in other programs is not key-logged; it shows in the screenshots and the live screen.
 */
import { api } from './api';
import { grabScreen } from './live';

/** AI tools by the name their window or browser tab shows. */
const AI_TOOLS: [string, RegExp][] = [
  ['ChatGPT', /chat\s?gpt|openai/i],
  ['Claude', /\bclaude\b/i],
  ['Gemini', /\bgemini\b|\bbard\b|ai studio|notebooklm/i],
  ['Copilot', /\bcopilot\b/i],
  ['Perplexity', /perplexity/i],
  ['DeepSeek', /deepseek/i],
  ['Grok', /\bgrok\b/i],
  ['Meta AI', /meta ai/i],
  ['Mistral Le Chat', /le chat|mistral/i],
  ['Qwen', /\bqwen\b|tongyi/i],
  ['Kimi', /\bkimi\b/i],
  ['Poe', /\bpoe\b/i],
  ['Character.AI', /character\.ai/i],
  ['HuggingChat', /huggingchat/i],
  ['Blackbox AI', /blackbox ai/i],
  ['Phind', /\bphind\b/i],
  ['Brainly', /brainly/i],
  ['Chegg', /chegg/i],
  ['Course Hero', /course\s?hero/i],
  ['QuillBot', /quillbot/i],
  ['Photomath', /photomath/i],
  ['Gauth', /gauth/i],
  ['Symbolab', /symbolab/i],
  ['Mathway', /mathway/i],
  ['Wolfram Alpha', /wolfram/i],
];

export interface AiWindow { tool: string; app: string; title: string }

/** The first open window (browser tab or desktop app) that is an AI tool, by its title or program name. */
export function aiWindow(windows: { app: string; title: string }[]): AiWindow | null {
  for (const w of windows) {
    const hit = AI_TOOLS.find(([, re]) => re.test(w.title) || re.test(w.app));
    if (hit) return { tool: hit[0], app: w.app, title: w.title };
  }
  return null;
}

const AWAY_EVERY_MS = 5000;

/** Starts reporting when the exam window loses focus; returns the stop function. */
export function watchAway(sessionId: string): () => void {
  let timer: number | undefined;
  let busy = false;

  const check = async () => {
    if (busy || document.hasFocus()) return;
    busy = true;
    try {
      const [windows, screenshot] = await Promise.all([window.proctor?.windowTitles().catch(() => []) ?? [], grabScreen(1280, 0.6)]);
      const ai = aiWindow(windows);
      const message = ai
        ? `${ai.tool} open outside the exam (${ai.app}: "${ai.title}")`
        : 'Away from the exam window; the screenshot shows what was on screen.';
      await api.reportViolation({ sessionId, code: ai ? 'AI_SITE_OPENED' : 'WINDOW_BLUR', message, at: new Date().toISOString(), ...(screenshot ? { screenshot } : {}) });
    } finally {
      busy = false;
    }
  };
  const onBlur = () => {
    window.clearInterval(timer);
    // A first look after a second, then every few seconds while the candidate stays away.
    window.setTimeout(() => void check(), 1000);
    timer = window.setInterval(() => void check(), AWAY_EVERY_MS);
  };
  const onFocus = () => window.clearInterval(timer);

  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };
}
