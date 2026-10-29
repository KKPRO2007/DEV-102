import { Router } from 'express';
import { z } from 'zod';
import type { Candidate, Prisma } from '@prisma/client';
import { config } from '../config.js';
import { fail, handle, must, pageArgs, parse } from '../lib/core.js';
import { prisma } from '../lib/db.js';
import { adminOnly, audit, staff } from '../lib/auth.js';
import { decrypt, encrypt, hashPassword, randomPassword } from '../lib/crypto.js';
import { inviteStatus, toCandidate } from '../lib/domain.js';
import { renderTemplate, sendMail, templates } from '../lib/mailer.js';
import { issueInvite } from './invites.js';

const DEFAULT_SUBJECT = 'Your sign-in details for {{examName}}';
const DEFAULT_BODY = `Hello {{name}},

You have been registered for {{examName}}, starting {{startTime}}.

Your exam link: {{inviteLink}}
Password: {{password}}

Install the Smart Proctor app from {{appLink}}, paste the exam link, enter the password and complete the system check at least 15 minutes before the start. The link works on one computer only and expires when the exam ends.

Exam ID: {{examId}}
User ID: {{userId}}

All the best,
Where U Elevate Assessments`;

const templateSchema = z.object({ subject: z.string().max(300).optional(), body: z.string().max(10_000).optional() });

async function nextUserIds(count: number): Promise<string[]> {
  const yy = String(new Date().getFullYear()).slice(2);
  const prefix = `WUE${yy}`;
  const rows = await prisma.candidate.findMany({ where: { userId: { startsWith: prefix } }, select: { userId: true } });
  let max = 999;
  for (const r of rows) {
    const n = Number(r.userId.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return Array.from({ length: count }, (_, i) => `${prefix}${max + 1 + i}`);
}

async function issuePassword(c: Pick<Candidate, 'id'>): Promise<string> {
  const password = randomPassword();
  await prisma.candidate.update({
    where: { id: c.id },
    data: { passwordHash: await hashPassword(password), credentialCipher: encrypt(password, config.JWT_SECRET), failedLogins: 0, lockedUntil: null, tokenVersion: { increment: 1 } },
  });
  return password;
}

/**
 * After a candidate's link is emailed, the organization (the exam's creator, else every admin) and every
 * proctor invited to the exam get a copy with the same link and password. A failed copy never fails the send.
 */
async function copyToStaff(c: Candidate & { exam: { id: string; title: string; code: string; createdById: string | null } }, link: string, password: string, startTime: string) {
  const [creator, admins, proctors] = await Promise.all([
    c.exam.createdById ? prisma.user.findFirst({ where: { id: c.exam.createdById, deletedAt: null }, select: { email: true, name: true } }) : null,
    prisma.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, select: { email: true, name: true } }),
    prisma.invite.findMany({
      where: { examId: c.exam.id, role: 'MENTOR', revokedAt: null, expiresAt: { gt: new Date() } },
      select: { user: { select: { email: true, name: true, deletedAt: true } } },
    }),
  ]);
  const organization = creator ? [creator] : admins;
  const to = new Map<string, { name: string; role: 'organization' | 'proctor' }>();
  for (const u of organization) to.set(u.email, { name: u.name, role: 'organization' });
  for (const p of proctors) if (p.user && !p.user.deletedAt && !to.has(p.user.email)) to.set(p.user.email, { name: p.user.name, role: 'proctor' });
  await Promise.all([...to].map(([email, who]) =>
    sendMail({ to: email, ...templates.credentialsCopy(who.name, who.role, { name: c.name, email: c.email, userId: c.userId }, c.exam.title, c.exam.code, startTime, link, password), kind: 'credentials_copy', candidateId: c.id })
      .catch(() => undefined)));
}

async function deliverCredentials(candidateId: string, tpl: { subject?: string | undefined; body?: string | undefined }) {
  const c = must(await prisma.candidate.findUnique({ where: { id: candidateId }, include: { exam: true } }), 'Candidate');
  const password = c.credentialCipher ? decrypt(c.credentialCipher, config.JWT_SECRET) : null;
  if (!password) {
    return { candidateId, emailStatus: 'FAILED' as const, error: 'The candidate already signed in, so the original password is gone. Reset the password to email new details.' };
  }
  if (c.exam.endsAt <= new Date()) return { candidateId, emailStatus: 'FAILED' as const, error: 'This exam has already ended.' };
  const invite = await issueInvite({ examId: c.examId, endsAt: c.exam.endsAt, role: 'CANDIDATE', email: c.email, candidateId: c.id });
  const vars = {
    name: c.name, examName: c.exam.title, examId: c.exam.code, userId: c.userId, password, inviteLink: invite.link,
    startTime: c.exam.startsAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }),
    appLink: config.APP_DOWNLOAD_URL,
  };
  // Custom templates written before join links existed still get the link.
  const body = tpl.body && !tpl.body.includes('{{inviteLink}}') ? `${tpl.body}

Your exam link: {{inviteLink}}` : tpl.body || DEFAULT_BODY;
  const mail = templates.credentials(renderTemplate(tpl.subject || DEFAULT_SUBJECT, vars), renderTemplate(body, vars));
  const r = await sendMail({ to: c.email, ...mail, kind: 'credentials', candidateId: c.id });
  await prisma.candidate.update({
    where: { id: c.id },
    data: { emailStatus: r.ok ? 'SENT' : 'FAILED', ...(r.ok && c.status === 'INVITED' ? { status: 'EMAILED' } : {}) },
  });
  if (r.ok) await copyToStaff(c, invite.link, password, vars.startTime);
  return {
    candidateId, emailStatus: r.ok ? ('SENT' as const) : ('FAILED' as const), ...(r.error ? { error: r.error } : {}),
    // Development only: with no SMTP configured the link is returned so the flow can be tested locally.
    inviteId: invite.id,
    ...(!config.isProd ? { devLink: invite.link } : {}),
    outbox: r.outbox ?? false,
  };
}

/** Bounded concurrency so a large batch does not overwhelm the SMTP server. */
async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }));
  return out;
}

const credentialRow = (c: Candidate, examCode: string, password: string) => ({ candidateId: c.id, name: c.name, email: c.email, examCode, userId: c.userId, password });

export const candidatesRouter = Router();

candidatesRouter.get('/candidates', ...staff, handle(async (req) => {
  const q = req.query as Record<string, string | undefined>;
  const { page, pageSize, skip, take } = pageArgs(q);
  const where: Prisma.CandidateWhereInput = {
    exam: { deletedAt: null },
    ...(q.examId ? { examId: q.examId } : {}),
    ...(q.status && q.status !== 'ALL' ? { status: q.status as Candidate['status'] } : {}),
    ...(q.emailStatus && q.emailStatus !== 'ALL' ? { emailStatus: q.emailStatus as Candidate['emailStatus'] } : {}),
    ...(q.q ? { OR: ['name', 'email', 'userId'].map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) } : {}),
  };
  const sortable = ['name', 'email', 'userId', 'status', 'emailStatus', 'createdAt'];
  const orderBy = sortable.includes(q.sort ?? '') ? { [q.sort as string]: q.dir === 'desc' ? 'desc' : 'asc' } : { userId: 'asc' as const };
  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({ where, orderBy, skip, take, include: { invites: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
  ]);
  return {
    items: rows.map(({ invites: [inv], ...c }) => ({ ...toCandidate(c), ...(inv ? { invite: { id: inv.id, status: inviteStatus(inv), deviceBound: Boolean(inv.deviceId) } } : {}) })),
    total, page, pageSize,
  };
}));

candidatesRouter.post('/exams/:id/candidates/import', ...adminOnly, handle(async (req) => {
  const exam = must(await prisma.exam.findFirst({ where: { id: String(req.params.id), deletedAt: null } }), 'Exam');
  const { rows } = parse(z.object({ rows: z.array(z.object({ name: z.string().max(120), email: z.string().max(200) })).min(1).max(5000) }), req.body);
  const emailOk = z.string().email();
  const invalid: { row: number; message: string }[] = [];
  const fresh: { name: string; email: string }[] = [];
  const existing = new Set((await prisma.candidate.findMany({ where: { examId: exam.id }, select: { email: true } })).map((c) => c.email));
  let duplicates = 0;
  rows.forEach((r, i) => {
    const name = r.name.trim();
    const email = r.email.trim().toLowerCase();
    if (name.length < 2) invalid.push({ row: i + 1, message: 'Name is required.' });
    else if (!emailOk.safeParse(email).success) invalid.push({ row: i + 1, message: `"${r.email}" is not a valid email.` });
    else if (existing.has(email)) duplicates++;
    else { existing.add(email); fresh.push({ name, email }); }
  });
  const ids = await nextUserIds(fresh.length);
  const passwords = fresh.map(() => randomPassword());
  const hashes: string[] = [];
  for (const p of passwords) hashes.push(await hashPassword(p));
  const created = await prisma.$transaction(fresh.map((f, i) => prisma.candidate.create({
    data: { examId: exam.id, name: f.name, email: f.email, userId: ids[i] as string, passwordHash: hashes[i] as string, credentialCipher: encrypt(passwords[i] as string, config.JWT_SECRET) },
  })));
  audit(req, 'candidate.import', exam.id, { added: created.length, duplicates, invalid: invalid.length });
  return { added: created.map(toCandidate), credentials: created.map((c, i) => credentialRow(c, exam.code, passwords[i] as string)), duplicates, invalid };
}));

candidatesRouter.post('/exams/:id/candidates/generate', ...adminOnly, handle(async (req) => {
  const exam = must(await prisma.exam.findFirst({ where: { id: String(req.params.id), deletedAt: null } }), 'Exam');
  const { candidateIds } = parse(z.object({ candidateIds: z.array(z.string().max(64)).max(5000).optional() }), req.body ?? {});
  const list = await prisma.candidate.findMany({ where: { examId: exam.id, ...(candidateIds ? { id: { in: candidateIds } } : {}) }, orderBy: { userId: 'asc' } });
  const out = [];
  for (const c of list) out.push(credentialRow(c, exam.code, await issuePassword(c)));
  audit(req, 'candidate.generate_credentials', exam.id, { count: out.length });
  return out;
}));

candidatesRouter.post('/candidates/:id/send-credentials', ...adminOnly, handle(async (req) => {
  const tpl = parse(templateSchema, req.body ?? {});
  const r = await deliverCredentials(String(req.params.id), tpl);
  audit(req, 'candidate.send_credentials', String(req.params.id), { status: r.emailStatus });
  return r;
}));

candidatesRouter.post('/exams/:id/candidates/send-credentials', ...adminOnly, handle(async (req) => {
  const body = parse(templateSchema.extend({ ids: z.array(z.string().max(64)).min(1).max(5000) }), req.body);
  const own = await prisma.candidate.findMany({ where: { examId: String(req.params.id), id: { in: body.ids } }, select: { id: true } });
  const results = await pool(own.map((c) => c.id), 3, (id) => deliverCredentials(id, body));
  const sent = results.filter((r) => r.emailStatus === 'SENT').length;
  if (sent) {
    const exam = await prisma.exam.findUnique({ where: { id: String(req.params.id) }, select: { code: true } });
    await prisma.notification.create({ data: { tone: sent === results.length ? 'success' : 'warning', title: 'Credentials sent', body: `Login details emailed to ${sent} of ${results.length} candidates of ${exam?.code ?? 'the exam'}.`, href: `/organization/exams/${req.params.id}/credentials` } });
  }
  audit(req, 'candidate.send_credentials_batch', String(req.params.id), { sent, total: results.length });
  return results;
}));

candidatesRouter.post('/candidates/:id/reset-password', ...adminOnly, handle(async (req) => {
  const c = must(await prisma.candidate.findUnique({ where: { id: String(req.params.id) }, include: { exam: true } }), 'Candidate');
  const password = await issuePassword(c);
  await prisma.deviceBinding.deleteMany({ where: { candidateId: c.id } });
  audit(req, 'candidate.reset_password', c.id);
  return credentialRow(c, c.exam.code, password);
}));

/** The emailed password, while the candidate has not signed in yet (it is deleted at first sign-in). */
candidatesRouter.post('/candidates/:id/reveal-password', ...adminOnly, handle(async (req) => {
  const c = must(await prisma.candidate.findUnique({ where: { id: String(req.params.id) } }), 'Candidate');
  const password = c.credentialCipher ? decrypt(c.credentialCipher, config.JWT_SECRET) : null;
  if (!password) return fail('CONFLICT', 'This candidate has already signed in, so the original password is gone. Use Reset & copy to issue a new one.');
  audit(req, 'candidate.reveal_password', c.id);
  return { password };
}));

candidatesRouter.post('/candidates/:id/reset-device', ...adminOnly, handle(async (req) => {
  const r = await prisma.deviceBinding.deleteMany({ where: { candidateId: String(req.params.id) } });
  audit(req, 'candidate.reset_device', String(req.params.id));
  return { cleared: r.count > 0 };
}));

candidatesRouter.delete('/candidates/:id', ...adminOnly, handle(async (req) => {
  const c = must(await prisma.candidate.findUnique({ where: { id: String(req.params.id) } }), 'Candidate');
  if (c.status === 'IN_EXAM') fail('CONFLICT', 'This candidate is taking the exam right now.');
  await prisma.candidate.delete({ where: { id: c.id } });
  audit(req, 'candidate.delete', c.id);
  return { id: c.id };
}));
