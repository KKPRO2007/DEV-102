import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { logger } from './core.js';
import { prisma } from './db.js';

let transport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!config.smtpEnabled) return null;
  transport ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    pool: true,
    maxConnections: 3,
  });
  return transport;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Branded Where U Elevate layout: blue gradient header, white card, plain-text-safe body. */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#eef3ff;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(30,64,175,.12)">
<tr><td style="background:linear-gradient(135deg,#0b2a6f,#1d4ed8 55%,#38bdf8);padding:28px 32px;color:#fff">
<div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.85">Where U Elevate · Smart Proctor</div>
<div style="font-size:22px;font-weight:700;margin-top:6px">${esc(title)}</div></td></tr>
<tr><td style="padding:28px 32px;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding:18px 32px;background:#f8fafc;font-size:12px;color:#64748b">You received this because you are registered for an assessment on Where U Elevate. Never share your password or one-time code with anyone.</td></tr>
</table></td></tr></table></body></html>`;
}

const linkify = (text: string) => text.replace(/https?:\/\/[^\s<]+/g, (raw) => {
  const trailing = raw.match(/[),.!?:;]+$/)?.[0] ?? '';
  const url = trailing ? raw.slice(0, -trailing.length) : raw;
  return `<a href="${url}" style="color:#1d4ed8">${url}</a>${trailing}`;
});

const textToHtml = (text: string) =>
  linkify(esc(text))
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

export const templates = {
  credentials: (subject: string, bodyText: string) => ({ subject, html: layout(subject, textToHtml(bodyText)), text: bodyText }),
  otp: (name: string, code: string, ttlMin: number) => ({
    subject: `Your verification code: ${code}`,
    text: `Hello ${name},\n\nYour one-time code is ${code}. It expires in ${ttlMin} minutes.`,
    html: layout('Verify it is you', `<p>Hello ${esc(name)},</p><p>Use this one-time code to continue to your exam:</p>
<div style="font-size:34px;font-weight:700;letter-spacing:.35em;color:#1d4ed8;background:#eff6ff;border-radius:12px;padding:16px;text-align:center;margin:18px 0">${esc(code)}</div>
<p style="color:#475569">It expires in ${ttlMin} minutes. If you did not request it, ignore this email.</p>`),
  }),
  credentialsCopy: (name: string, role: 'organization' | 'proctor', cand: { name: string; email: string; userId: string }, examTitle: string, examCode: string, startTime: string, link: string, password: string) => {
    const why = role === 'proctor' ? 'You are proctoring this exam' : 'Your organization sent these exam details';
    return {
      subject: `Copy: exam link sent to ${cand.name} (${examCode})`,
      text: `Hello ${name},

${why}. ${cand.name} (${cand.email}) was sent the details below for ${examTitle} (${examCode}), starting ${startTime}.

Candidate ID: ${cand.userId}
Exam link: ${link}
Password: ${password}

The link works on one computer only and expires when the exam ends.`,
      html: layout(`Copy: link sent to ${cand.name}`, `<p>Hello ${esc(name)},</p><p>${esc(why)}. <b>${esc(cand.name)}</b> (${esc(cand.email)}) was sent these details for <b>${esc(examTitle)}</b> (${esc(examCode)}), starting ${esc(startTime)}.</p>
<p style="margin:14px 0 4px;color:#475569">Candidate ID</p><div style="font-family:Consolas,monospace;font-size:15px">${esc(cand.userId)}</div>
<p style="margin:14px 0 4px;color:#475569">Exam link</p><div style="font-family:Consolas,monospace;font-size:13px;word-break:break-all;background:#eff6ff;border-radius:12px;padding:14px"><a href="${esc(link)}" style="color:#1d4ed8">${esc(link)}</a></div>
<p style="margin:14px 0 4px;color:#475569">Password</p><div style="font-family:Consolas,monospace;font-size:15px">${esc(password)}</div>
<p style="color:#475569;margin-top:16px">The link works on one computer only and expires when the exam ends. Keep this email private.</p>`),
    };
  },
  proctorInvite: (name: string, examTitle: string, examCode: string, startTime: string, link: string, password: string | null, appLink: string) => {
    const pw = password ? `Temporary password: ${password}` : 'Password: the one you already use for your proctor account';
    return {
      subject: `You are proctoring ${examTitle}`,
      text: `Hello ${name},

You have been assigned as a proctor for ${examTitle} (${examCode}), starting ${startTime}.

Your proctor link: ${link}
${pw}

Install the Smart Proctor app from ${appLink}, paste the link, enter the password, then complete face and email verification. The link works on one computer only and expires when the exam ends.`,
      html: layout('Your proctor invitation', `<p>Hello ${esc(name)},</p><p>You have been assigned as a proctor for <b>${esc(examTitle)}</b> (${esc(examCode)}), starting ${esc(startTime)}.</p>
<p style="margin:18px 0 6px;color:#475569">Your proctor link</p>
<div style="font-family:Consolas,monospace;font-size:13px;word-break:break-all;background:#eff6ff;border-radius:12px;padding:14px"><a href="${esc(link)}" style="color:#1d4ed8">${esc(link)}</a></div>
<p style="margin-top:14px">${password ? `Temporary password: <b style="font-family:Consolas,monospace">${esc(password)}</b>` : 'Password: the one you already use for your proctor account.'}</p>
<p>Install the <a href="${esc(appLink)}">Smart Proctor app</a>, paste the link, enter the password, then complete face and email verification.</p>
<p style="color:#475569">The link works on one computer only and expires when the exam ends.</p>`),
    };
  },
  result: (name: string, examTitle: string, receiptId: string, release: 'IMMEDIATE' | 'AFTER_REVIEW' | 'MANUAL' = 'AFTER_REVIEW') => {
    const when = { IMMEDIATE: 'Your score is available in the candidate lobby.', AFTER_REVIEW: 'Results are released after review.', MANUAL: 'Results are released by your exam organiser.' }[release];
    return {
      subject: `Submission received: ${examTitle}`,
      text: `Hello ${name},\n\nWe received your submission for ${examTitle}. Reference: ${receiptId}.\n\n${when}`,
      html: layout('Submission received', `<p>Hello ${esc(name)},</p><p>We received your submission for <b>${esc(examTitle)}</b>.</p><p>Reference number: <b>${esc(receiptId)}</b></p><p>${when}</p>`),
    };
  },
  resultReady: (name: string, examTitle: string, lobbyUrl: string) => ({
    subject: `Your results are ready: ${examTitle}`,
    text: `Hello ${name},\n\nYour results for ${examTitle} are ready. Sign in to the candidate lobby to see them: ${lobbyUrl}`,
    html: layout('Your results are ready', `<p>Hello ${esc(name)},</p><p>Your results for <b>${esc(examTitle)}</b> are ready.</p><p><a href="${esc(lobbyUrl)}">Sign in to the candidate lobby</a> to see your score.</p>`),
  }),
};

export interface MailInput { to: string; subject: string; html: string; text: string; kind: string; candidateId?: string }

/**
 * Sends with up to 3 attempts and exponential backoff and records every outcome in EmailLog.
 * Without SMTP settings the message goes to the dev outbox (EmailLog with the rendered body).
 */
export async function sendMail(m: MailInput): Promise<{ ok: boolean; error?: string; outbox?: boolean }> {
  const log = await prisma.emailLog.create({
    data: { to: m.to, kind: m.kind, subject: m.subject, candidateId: m.candidateId ?? null, status: 'PENDING' },
  });
  const t = getTransport();
  if (!t) {
    if (config.isProd) {
      const error = 'SMTP is not configured; real email delivery is unavailable.';
      await prisma.emailLog.update({ where: { id: log.id }, data: { status: 'FAILED', attempts: 0, error } });
      logger.error({ to: m.to, kind: m.kind }, error);
      return { ok: false, error };
    }
    // OTP bodies are not stored, even in the outbox, to keep codes out of the database.
    await prisma.emailLog.update({ where: { id: log.id }, data: { status: 'SENT', attempts: 1, html: m.kind === 'otp' ? null : m.html } });
    logger.info({ to: m.to, kind: m.kind }, 'email written to dev outbox (SMTP not configured)');
    return { ok: true, outbox: true };
  }
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await t.sendMail({ from: config.MAIL_FROM || config.SMTP_USER, to: m.to, subject: m.subject, html: m.html, text: m.text });
      await prisma.emailLog.update({ where: { id: log.id }, data: { status: 'SENT', attempts: attempt } });
      return { ok: true };
    } catch (err) {
      lastError = (err as Error).message.slice(0, 300);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  await prisma.emailLog.update({ where: { id: log.id }, data: { status: 'FAILED', attempts: 3, error: lastError } });
  logger.warn({ to: m.to, kind: m.kind, error: lastError }, 'email delivery failed');
  return { ok: false, error: lastError };
}

export const renderTemplate = (text: string, vars: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);

export function maskEmail(email: string): string {
  const [user = '', host = ''] = email.split('@');
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(2, user.length - 2))}@${host}`;
}
