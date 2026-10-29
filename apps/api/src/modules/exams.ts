import { Router, type Request } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { z } from 'zod';
import { Prisma, type Severity } from '@prisma/client';
import { fail, handle, must, pageArgs, parse } from '../lib/core.js';
import { prisma } from '../lib/db.js';
import { adminOnly, audit, auth, staff } from '../lib/auth.js';
import {
  DEFAULT_POLICY, SEVERITIES, SEVERITY_RANK, VIOLATION_META, defaultExtras, examInclude, readExtras, readPolicy, readSettings, toExam, toQuestion,
} from '../lib/domain.js';
import { notifyResultReady } from '../lib/results.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(csv|xlsx)$/i.test(file.originalname)),
});

/* ---------------------------------------------------------------- schemas */

const iso = z.string().datetime({ offset: true });
const sev = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const host = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Allowed sites must be plain domains like docs.python.org').max(120);

const settingsSchema = z.object({
  shuffle: z.boolean(), negativeMarking: z.boolean(), allowedSites: z.array(host).max(50),
  maxWarnings: z.number().int().min(0).max(10), autoSubmit: z.boolean(), audioMonitoring: z.boolean(),
  proctorOnly: z.boolean().default(false), oneWay: z.boolean().default(false), liveAudio: z.boolean().default(false),
});
const extrasSchema = z.object({
  category: z.string().max(80), description: z.string().max(2000), instructions: z.string().max(5000),
  lateEntryMin: z.number().int().min(0).max(240), checkInMin: z.number().int().min(0).max(240),
  negativeValue: z.number().min(0).max(1), allowCalculator: z.boolean(), releaseResults: z.enum(['IMMEDIATE', 'AFTER_REVIEW', 'MANUAL']),
});
const weight = z.number().int().min(0).max(100);
export const policySchema = z.object({
  weights: z.object({ LOW: weight, MEDIUM: weight, HIGH: weight, CRITICAL: weight }),
  maxWarnings: z.number().int().min(0).max(5), warnFrom: sev, autoSubmit: z.boolean(), autoSubmitFrom: sev,
  autoSubmitOnCritical: z.boolean(), riskFlagAt: z.number().int().min(10).max(100), cooldownSec: z.number().int().min(0).max(300),
})
  .refine((p) => p.weights.LOW <= p.weights.MEDIUM && p.weights.MEDIUM <= p.weights.HIGH && p.weights.HIGH <= p.weights.CRITICAL, { message: 'Risk points must not decrease as severity increases.', path: ['weights'] })
  .refine((p) => SEVERITY_RANK[p.autoSubmitFrom as Severity] >= SEVERITY_RANK[p.warnFrom as Severity], { message: 'The auto-submit severity must be at least the warning severity.', path: ['autoSubmitFrom'] });

const examBase = z.object({
  title: z.string().trim().min(5, 'Exam title must be at least 5 characters.').max(160),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,24}$/, 'Codes use 3 to 24 letters, digits or dashes.').optional(),
  startsAt: iso, endsAt: iso,
  durationMin: z.number().int().min(5, 'Duration must be between 5 and 300 minutes.').max(300, 'Duration must be between 5 and 300 minutes.'),
  settings: settingsSchema.partial().optional(),
  status: z.enum(['DRAFT', 'SCHEDULED']).optional(),
  extras: extrasSchema.partial().optional(),
  policy: policySchema.optional(),
});

const optionSchema = z.object({ id: z.string().regex(/^[a-z]$/), text: z.string().trim().min(1, 'Options cannot be empty.').max(1000) });
const questionText = z.string().trim().min(10, 'Question text is too short.').max(5000);
const numericQuestionSchema = z.object({
  type: z.literal('NUMERIC'),
  text: questionText,
  answerKey: z.object({
    value: z.number({ invalid_type_error: 'Enter the correct value as a number.' }).finite(),
    tolerance: z.number().finite().min(0, 'Tolerance cannot be negative.').max(1e9).default(0),
    unit: z.string().trim().max(20, 'Keep the unit under 20 characters.').nullish().transform((u) => u || null),
  }),
  marks: z.number().int().min(1).max(10),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
const questionSchema = z.object({
  type: z.literal('MCQ').optional(),
  text: questionText,
  options: z.array(optionSchema).min(2, 'Add at least two options.').max(6),
  correctIds: z.array(z.string()).min(1, 'Mark the correct answer.'),
  multi: z.boolean().optional(),
  marks: z.number().int().min(1).max(10),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
}).refine((q) => q.correctIds.every((id) => q.options.some((o) => o.id === id)), { message: 'Correct answers must reference existing options.', path: ['correctIds'] })
  .refine((q) => new Set(q.options.map((o) => o.id)).size === q.options.length, { message: 'Option ids must be unique.', path: ['options'] });
type QuestionInput = z.infer<typeof questionSchema> | z.infer<typeof numericQuestionSchema>;

/** Picks the schema by type so each kind keeps its own, specific error messages. */
const parseQuestion = (v: unknown): QuestionInput =>
  (v as { type?: unknown } | null)?.type === 'NUMERIC' ? parse(numericQuestionSchema, v) : parse(questionSchema, v);

/* ---------------------------------------------------------------- helpers */

const json = (v: unknown) => v as Prisma.InputJsonValue;
async function loadExam(id: string) {
  return must(await prisma.exam.findFirst({ where: { id, deletedAt: null }, include: examInclude }), 'Exam');
}

function statusWhere(status: string | undefined): Prisma.ExamWhereInput {
  const now = new Date();
  switch (status) {
    case 'DRAFT': return { status: 'DRAFT' };
    case 'SCHEDULED': return { status: { not: 'DRAFT' }, startsAt: { gt: now } };
    case 'LIVE': return { status: { not: 'DRAFT' }, startsAt: { lte: now }, endsAt: { gt: now } };
    case 'COMPLETED': return { status: { not: 'DRAFT' }, endsAt: { lte: now } };
    default: return {};
  }
}

function checkWindow(startsAt: Date, endsAt: Date, durationMin: number): void {
  if (endsAt <= startsAt) fail('VALIDATION', 'End time must be after the start time.');
  if (endsAt.getTime() - startsAt.getTime() < durationMin * 60_000) fail('VALIDATION', 'The exam window must be at least as long as the exam duration.');
}

function codeFromTitle(title: string): string {
  const letters = title.split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return `${letters || 'EXAM'}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function normalizeQuestion(q: QuestionInput) {
  const common = { text: q.text, marks: q.marks, difficulty: q.difficulty, tags: q.tags };
  if (q.type === 'NUMERIC') return { ...common, type: 'NUMERIC' as const, options: [], correctIds: [], multi: false, answerKey: q.answerKey };
  return { ...common, type: 'MCQ' as const, options: q.options, correctIds: [...new Set(q.correctIds)].sort(), multi: (q.multi ?? false) || q.correctIds.length > 1, answerKey: null };
}

/** Prisma payload; a question switched back to multiple choice loses its old answer key. */
const questionData = (q: ReturnType<typeof normalizeQuestion>) => ({ ...q, options: json(q.options), answerKey: q.answerKey ? json(q.answerKey) : Prisma.DbNull });

/* ---------------------------------------------------------------- import parsing */

export interface ImportDraft {
  text: string; options: string[]; correct: number[]; marks: number; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; tags: string[]
  /** Set for numeric rows: no options, a number in the correct column. */
  numeric?: { value: number; tolerance: number }
}
export interface ImportRowError { row: number; message: string }
export const QUESTION_CSV_HEADER = 'question,optionA,optionB,optionC,optionD,correct,marks,difficulty,tags,tolerance';

export function validateQuestionRows(rows: string[][], existingTexts: string[]): { valid: ImportDraft[]; errors: ImportRowError[] } {
  const valid: ImportDraft[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Set(existingTexts.map((t) => t.trim().toLowerCase()));
  const hasHeader = /^(question|text)$/i.test(rows[0]?.[0]?.trim() ?? '');
  rows.forEach((raw, idx) => {
    if (hasHeader && idx === 0) return;
    const cells = raw.map((c) => String(c ?? '').trim());
    const row = idx + 1;
    const [text = '', a = '', b = '', c = '', d = '', correctRaw = '', marksRaw = '', diffRaw = '', tagsRaw = '', toleranceRaw = ''] = cells;
    const options = [a, b, c, d].filter(Boolean);
    const numericValue = options.length === 0 && correctRaw !== '' ? Number(correctRaw) : NaN;
    const tolerance = toleranceRaw ? Number(toleranceRaw) : 0;
    const correct = correctRaw.toUpperCase().split(/[|;,\s]+/).filter(Boolean).map((l) => 'ABCD'.indexOf(l));
    const marks = marksRaw ? Number(marksRaw) : 1;
    const difficulty = (diffRaw ? diffRaw.toUpperCase() : 'MEDIUM') as ImportDraft['difficulty'];
    const bad = (message: string) => errors.push({ row, message });
    if (text.length < 10) return bad('Question text must be at least 10 characters.');
    if (Number.isFinite(numericValue)) {
      if (!Number.isFinite(tolerance) || tolerance < 0) return bad('Tolerance must be a number of 0 or more.');
    } else if (options.length < 2) return bad('At least two options are required, or leave the options empty and put a number in "correct" for a numeric question.');
    else if (correct.length === 0 || correct.some((i) => i < 0 || !(cells[1 + i] ?? ''))) return bad('The "correct" column must reference filled options, e.g. B or A|C.');
    if (!Number.isInteger(marks) || marks < 1 || marks > 10) return bad('Marks must be a whole number from 1 to 10.');
    if (!['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) return bad('Difficulty must be EASY, MEDIUM or HARD.');
    if (seen.has(text.toLowerCase())) return bad('Duplicate question text.');
    seen.add(text.toLowerCase());
    const tags = tagsRaw.split('|').map((t) => t.trim()).filter(Boolean).slice(0, 12);
    if (Number.isFinite(numericValue)) valid.push({ text, options: [], correct: [], marks, difficulty, tags, numeric: { value: numericValue, tolerance } });
    else valid.push({ text, options, correct: [...new Set(correct)], marks, difficulty, tags });
  });
  return { valid, errors };
}

async function rowsFromUpload(req: Request): Promise<string[][]> {
  if (req.file) {
    if (/\.xlsx$/i.test(req.file.originalname)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
      const ws = wb.worksheets[0] ?? fail('VALIDATION', 'The workbook has no sheets.');
      const out: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (r) => {
        const values = Array.isArray(r.values) ? r.values.slice(1) : [];
        out.push(values.map((v) => (v && typeof v === 'object' && 'text' in v ? String((v as { text: unknown }).text) : String(v ?? ''))));
      });
      return out;
    }
    return parseCsvSync(req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''), { relaxColumnCount: true, skipEmptyLines: true, trim: true }) as string[][];
  }
  const body = parse(z.object({ csv: z.string().min(1).max(2_000_000) }), req.body);
  return parseCsvSync(body.csv.replace(/^\uFEFF/, ''), { relaxColumnCount: true, skipEmptyLines: true, trim: true }) as string[][];
}

const draftToQuestion = (d: ImportDraft) => (d.numeric
  ? { type: 'NUMERIC' as const, text: d.text, answerKey: { ...d.numeric, unit: null }, marks: d.marks, difficulty: d.difficulty, tags: d.tags }
  : {
      text: d.text, options: d.options.map((text, i) => ({ id: 'abcdef'[i] as string, text })),
      correctIds: d.correct.map((i) => 'abcdef'[i] as string), multi: d.correct.length > 1, marks: d.marks, difficulty: d.difficulty, tags: d.tags,
    });

/* ---------------------------------------------------------------- routes */

export const examsRouter = Router();

examsRouter.get('/', ...staff, handle(async (req) => {
  const q = req.query as Record<string, string | undefined>;
  const { page, pageSize, skip, take } = pageArgs(q);
  const where: Prisma.ExamWhereInput = {
    deletedAt: null,
    ...statusWhere(q.status),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] } : {}),
  };
  const dir = q.dir === 'desc' ? 'desc' : 'asc';
  const sortable = ['title', 'code', 'startsAt', 'endsAt', 'durationMin'] as const;
  const orderBy = sortable.includes(q.sort as (typeof sortable)[number]) ? { [q.sort as string]: dir } : { startsAt: 'desc' as const };
  const [total, rows] = await Promise.all([
    prisma.exam.count({ where }),
    prisma.exam.findMany({ where, include: examInclude, orderBy, skip, take }),
  ]);
  return { items: rows.map(toExam), total, page, pageSize };
}));

examsRouter.get('/code-check', ...staff, handle(async (req) => {
  const code = String(req.query.code ?? '').trim();
  const taken = code ? Boolean(await prisma.exam.findFirst({ where: { code: { equals: code, mode: 'insensitive' } }, select: { id: true } })) : false;
  return { taken };
}));

examsRouter.get('/:id', ...staff, handle(async (req) => toExam(await loadExam(String(req.params.id)))));

examsRouter.get('/:id/detail', ...staff, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  return { exam: toExam(e), extras: readExtras(e.extras, e.title), policy: readPolicy(e.policy) };
}));

examsRouter.post('/', ...adminOnly, handle(async (req, res) => {
  const body = parse(examBase, req.body);
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  checkWindow(startsAt, endsAt, body.durationMin);
  const code = body.code ?? codeFromTitle(body.title);
  if (await prisma.exam.findFirst({ where: { code: { equals: code, mode: 'insensitive' } }, select: { id: true } })) fail('CONFLICT', `The code ${code} is already used by another exam.`);
  const settings = { ...readSettings({}), ...body.settings };
  const exam = await prisma.exam.create({
    data: {
      title: body.title, code, startsAt, endsAt, durationMin: body.durationMin, status: body.status ?? 'DRAFT',
      settings: json(settings), extras: json({ ...defaultExtras(body.title), ...body.extras }),
      policy: json(body.policy ?? { ...DEFAULT_POLICY, maxWarnings: Math.min(5, settings.maxWarnings) }), createdById: auth(req).sub,
    },
    include: examInclude,
  });
  audit(req, 'exam.create', exam.id, { code });
  res.status(201);
  return toExam(exam);
}));

examsRouter.patch('/:id', ...adminOnly, handle(async (req) => {
  const current = await loadExam(String(req.params.id));
  const body = parse(examBase.partial(), req.body);
  const startsAt = body.startsAt ? new Date(body.startsAt) : current.startsAt;
  const endsAt = body.endsAt ? new Date(body.endsAt) : current.endsAt;
  const durationMin = body.durationMin ?? current.durationMin;
  checkWindow(startsAt, endsAt, durationMin);
  if (body.code && body.code !== current.code && (await prisma.exam.findFirst({ where: { code: { equals: body.code, mode: 'insensitive' }, NOT: { id: current.id } } }))) {
    fail('CONFLICT', `The code ${body.code} is already used by another exam.`);
  }
  const exam = await prisma.exam.update({
    where: { id: current.id },
    data: {
      ...(body.title ? { title: body.title } : {}), ...(body.code ? { code: body.code } : {}), ...(body.status ? { status: body.status } : {}),
      startsAt, endsAt, durationMin,
      ...(body.settings ? { settings: json({ ...readSettings(current.settings), ...body.settings }) } : {}),
      ...(body.extras ? { extras: json({ ...readExtras(current.extras, current.title), ...body.extras }) } : {}),
      ...(body.policy ? { policy: json(body.policy) } : {}),
    },
    include: examInclude,
  });
  audit(req, 'exam.update', exam.id, { fields: Object.keys(body) });
  return toExam(exam);
}));

async function softDelete(id: string): Promise<boolean> {
  const e = await prisma.exam.findFirst({ where: { id, deletedAt: null } });
  if (!e) return false;
  if (toExam({ ...e }).status === 'LIVE') return false;
  await prisma.exam.update({ where: { id }, data: { deletedAt: new Date(), code: `${e.code}~${Date.now().toString(36)}` } });
  return true;
}

examsRouter.delete('/:id', ...adminOnly, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  if (toExam(e).status === 'LIVE') fail('CONFLICT', 'Live exams cannot be deleted. End the sessions first.');
  await softDelete(e.id);
  audit(req, 'exam.delete', e.id);
  return { id: e.id };
}));

examsRouter.post('/bulk-delete', ...adminOnly, handle(async (req) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().max(64)).min(1).max(200) }), req.body);
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) ((await softDelete(id)) ? deleted : skipped).push(id);
  audit(req, 'exam.bulk_delete', undefined, { deleted, skipped });
  return { deleted, skipped };
}));

examsRouter.post('/:id/duplicate', ...adminOnly, handle(async (req, res) => {
  const src = await loadExam(String(req.params.id));
  const questions = await prisma.question.findMany({ where: { examId: src.id }, orderBy: { position: 'asc' } });
  const siblings = await prisma.exam.count({ where: { code: { startsWith: `${src.code}-C` } } });
  const week = 7 * 86_400_000;
  const copy = await prisma.exam.create({
    data: {
      title: `${src.title} (Copy)`.slice(0, 160), code: `${src.code}-C${siblings + 1}`.slice(0, 24), status: 'DRAFT',
      startsAt: new Date(src.startsAt.getTime() + week), endsAt: new Date(src.endsAt.getTime() + week), durationMin: src.durationMin,
      settings: json(src.settings), policy: json(src.policy), createdById: auth(req).sub,
      // A copy is a new sitting: its results are not released just because the original's were.
      extras: json({ ...readExtras(src.extras, src.title), resultsReleasedAt: null, resultsReleasedBy: null }),
      questions: { create: questions.map(({ id: _id, examId: _e, createdAt: _c, ...q }) => ({ ...q, options: json(q.options), answerKey: q.answerKey === null ? Prisma.DbNull : json(q.answerKey) })) },
    },
    include: examInclude,
  });
  audit(req, 'exam.duplicate', copy.id, { from: src.id });
  res.status(201);
  return toExam(copy);
}));

examsRouter.post('/:id/publish', ...adminOnly, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const problems: string[] = [];
  if ((e._count?.questions ?? 0) < 1) problems.push('Add at least one question.');
  if (e.endsAt <= new Date()) problems.push('The exam window has already ended.');
  if (e.endsAt.getTime() - e.startsAt.getTime() < e.durationMin * 60_000) problems.push('The window is shorter than the duration.');
  if (problems.length) fail('VALIDATION', problems.join(' '), { problems });
  const exam = await prisma.exam.update({ where: { id: e.id }, data: { status: 'SCHEDULED' }, include: examInclude });
  await prisma.notification.create({ data: { tone: 'info', title: `${exam.code} published`, body: `${exam.title} is scheduled for ${exam.startsAt.toISOString()}.`, href: `/organization/exams/${exam.id}` } });
  audit(req, 'exam.publish', exam.id);
  return toExam(exam);
}));

examsRouter.post('/:id/release-results', ...adminOnly, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const extras = readExtras(e.extras, e.title);
  if (extras.releaseResults !== 'MANUAL') fail('CONFLICT', 'This exam releases results automatically. Set "Release results" to Manually to use this.');
  if (extras.resultsReleasedAt) return { releasedAt: extras.resultsReleasedAt, releasedBy: extras.resultsReleasedBy ?? null, notified: 0 };
  const releasedAt = new Date().toISOString();
  await prisma.exam.update({ where: { id: e.id }, data: { extras: json({ ...extras, resultsReleasedAt: releasedAt, resultsReleasedBy: auth(req).sub }) } });
  const sessions = await prisma.examSession.findMany({ where: { examId: e.id, status: 'SUBMITTED' }, select: { id: true } });
  // One at a time in the background, so a large exam does not flood the mail server or hold the request.
  void (async () => { for (const s of sessions) await notifyResultReady(s.id); })();
  audit(req, 'exam.releaseResults', e.id, { candidates: sessions.length });
  return { releasedAt, releasedBy: auth(req).sub, notified: sessions.length };
}));

examsRouter.put('/:id/policy', ...adminOnly, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const policy = parse(policySchema, req.body);
  await prisma.exam.update({ where: { id: e.id }, data: { policy: json(policy), settings: json({ ...readSettings(e.settings), maxWarnings: policy.maxWarnings, autoSubmit: policy.autoSubmit }) } });
  audit(req, 'exam.policy', e.id);
  return policy;
}));

examsRouter.get('/:id/candidate-summary', ...staff, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const rows = await prisma.candidate.groupBy({ by: ['status', 'emailStatus'], where: { examId: e.id }, _count: true });
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((s, r) => s + r._count, 0);
  return {
    total: sum(() => true),
    pending: sum((r) => r.emailStatus === 'PENDING'),
    emailed: sum((r) => r.status === 'EMAILED'),
    failed: sum((r) => r.emailStatus === 'FAILED'),
    inExam: sum((r) => r.status === 'IN_EXAM'),
    submitted: sum((r) => r.status === 'SUBMITTED'),
    disqualified: sum((r) => r.status === 'DISQUALIFIED'),
  };
}));

examsRouter.get('/:id/violation-summary', ...staff, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const where = { session: { examId: e.id } };
  const [byCode, bySev, flagged, autoSubmitted] = await Promise.all([
    prisma.violation.groupBy({ by: ['code'], where, _count: true }),
    prisma.violation.groupBy({ by: ['severity'], where, _count: true }),
    prisma.examSession.count({ where: { examId: e.id, riskScore: { gte: readPolicy(e.policy).riskFlagAt } } }),
    prisma.examSession.count({ where: { examId: e.id, submitReason: { in: ['CRITICAL_VIOLATION', 'REPEATED_VIOLATIONS'] } } }),
  ]);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, bySev.find((r) => r.severity === s)?._count ?? 0])) as Record<Severity, number>;
  return {
    total: byCode.reduce((s, r) => s + r._count, 0),
    flaggedSessions: flagged,
    autoSubmitted,
    byType: byCode.map((r) => ({ code: r.code, label: VIOLATION_META[r.code].label, severity: VIOLATION_META[r.code].severity, count: r._count })).sort((a, b) => b.count - a.count),
    bySeverity,
  };
}));

/* ---------------------------------------------------------------- questions */

examsRouter.get('/:id/questions/template', ...staff, (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="question-import-template.csv"');
  res.send(`${QUESTION_CSV_HEADER}\n"What is the time complexity of binary search?",O(n),O(log n),O(n log n),O(1),B,2,EASY,algorithms|complexity\n"Select all prime numbers.",21,29,31,39,B|C,2,MEDIUM,maths\n`);
});

examsRouter.get('/:id/questions', ...staff, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const q = req.query as Record<string, string | undefined>;
  const where: Prisma.QuestionWhereInput = {
    examId: e.id,
    ...(q.difficulty && q.difficulty !== 'ALL' ? { difficulty: q.difficulty as 'EASY' | 'MEDIUM' | 'HARD' } : {}),
    ...(q.q ? { OR: [{ text: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q.toLowerCase() } }] } : {}),
  };
  if (!q.page) return (await prisma.question.findMany({ where, orderBy: { position: 'asc' } })).map((x) => toQuestion(x));
  const { page, pageSize, skip, take } = pageArgs(q);
  const sortable = ['text', 'marks', 'difficulty', 'position'];
  const orderBy = sortable.includes(q.sort ?? '') ? { [q.sort as string]: q.dir === 'desc' ? 'desc' : 'asc' } : { position: 'asc' as const };
  const [total, rows] = await Promise.all([prisma.question.count({ where }), prisma.question.findMany({ where, orderBy, skip, take })]);
  return { items: rows.map((x) => toQuestion(x)), total, page, pageSize };
}));

async function nextPosition(examId: string): Promise<number> {
  const last = await prisma.question.findFirst({ where: { examId }, orderBy: { position: 'desc' }, select: { position: true } });
  return (last?.position ?? -1) + 1;
}

examsRouter.post('/:id/questions', ...adminOnly, handle(async (req, res) => {
  const e = await loadExam(String(req.params.id));
  const q = normalizeQuestion(parseQuestion(req.body));
  const created = await prisma.question.create({ data: { ...questionData(q), examId: e.id, position: await nextPosition(e.id) } });
  audit(req, 'question.create', created.id, { examId: e.id });
  res.status(201);
  return toQuestion(created);
}));

const updateQuestion = handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const existing = must(await prisma.question.findFirst({ where: { id: String(req.params.qid), examId: e.id } }), 'Question');
  const q = normalizeQuestion(parseQuestion(req.body));
  const updated = await prisma.question.update({ where: { id: existing.id }, data: questionData(q) });
  audit(req, 'question.update', updated.id);
  return toQuestion(updated);
});
examsRouter.put('/:id/questions/order', ...adminOnly, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const { ids } = parse(z.object({ ids: z.array(z.string().max(64)).max(2000) }), req.body);
  const all = await prisma.question.findMany({ where: { examId: e.id }, orderBy: { position: 'asc' }, select: { id: true } });
  const known = new Set(all.map((q) => q.id));
  const ordered = [...ids.filter((id) => known.has(id)), ...all.map((q) => q.id).filter((id) => !ids.includes(id))];
  await prisma.$transaction(ordered.map((id, position) => prisma.question.update({ where: { id }, data: { position } })));
  return { ordered: ordered.length };
}));

examsRouter.put('/:id/questions/:qid', ...adminOnly, updateQuestion);
examsRouter.patch('/:id/questions/:qid', ...adminOnly, updateQuestion);

examsRouter.post('/:id/questions/:qid/duplicate', ...adminOnly, handle(async (req, res) => {
  const e = await loadExam(String(req.params.id));
  const src = must(await prisma.question.findFirst({ where: { id: String(req.params.qid), examId: e.id } }), 'Question');
  await prisma.question.updateMany({ where: { examId: e.id, position: { gt: src.position } }, data: { position: { increment: 1 } } });
  const { id: _id, createdAt: _c, ...rest } = src;
  const copy = await prisma.question.create({ data: { ...rest, options: json(rest.options), answerKey: rest.answerKey === null ? Prisma.DbNull : json(rest.answerKey), position: src.position + 1 } });
  res.status(201);
  return toQuestion(copy);
}));

examsRouter.delete('/:id/questions/:qid', ...adminOnly, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const r = await prisma.question.deleteMany({ where: { id: String(req.params.qid), examId: e.id } });
  audit(req, 'question.delete', String(req.params.qid));
  return { removed: r.count };
}));

examsRouter.post('/:id/questions/bulk-delete', ...adminOnly, handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const { ids } = parse(z.object({ ids: z.array(z.string().max(64)).min(1).max(1000) }), req.body);
  const r = await prisma.question.deleteMany({ where: { examId: e.id, id: { in: ids } } });
  audit(req, 'question.bulk_delete', e.id, { count: r.count });
  return { removed: r.count };
}));

examsRouter.post('/:id/questions/import/preview', ...adminOnly, upload.single('file'), handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  const rows = await rowsFromUpload(req);
  if (rows.length > 2001) fail('VALIDATION', 'Import at most 2000 questions at a time.');
  const existing = (await prisma.question.findMany({ where: { examId: e.id }, select: { text: true } })).map((q) => q.text);
  return { ...validateQuestionRows(rows, existing), totalRows: rows.length };
}));

/** Accepts editor drafts ({ rows: Question-like[] }), validated preview drafts ({ drafts }) or a CSV/XLSX file. */
examsRouter.post('/:id/questions/import', ...adminOnly, upload.single('file'), handle(async (req) => {
  const e = await loadExam(String(req.params.id));
  let items: ReturnType<typeof normalizeQuestion>[] = [];
  let errors: ImportRowError[] = [];
  if (req.file || typeof req.body?.csv === 'string') {
    const existing = (await prisma.question.findMany({ where: { examId: e.id }, select: { text: true } })).map((q) => q.text);
    const report = validateQuestionRows(await rowsFromUpload(req), existing);
    items = report.valid.map((d) => normalizeQuestion(parseQuestion(draftToQuestion(d))));
    errors = report.errors;
  } else if (Array.isArray(req.body?.drafts)) {
    const drafts = parse(z.array(z.object({ text: z.string(), options: z.array(z.string()), correct: z.array(z.number().int()), marks: z.number().int(), difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']), tags: z.array(z.string()), numeric: z.object({ value: z.number().finite(), tolerance: z.number().finite().min(0) }).optional() })).max(2000), req.body.drafts);
    items = drafts.map((d) => normalizeQuestion(parseQuestion(draftToQuestion(d))));
  } else {
    const rows = parse(z.array(z.unknown()).min(1).max(2000), req.body?.rows);
    items = rows.map((r) => normalizeQuestion(parseQuestion(r)));
  }
  const start = await nextPosition(e.id);
  const created = await prisma.$transaction(items.map((q, i) => prisma.question.create({ data: { ...questionData(q), examId: e.id, position: start + i } })));
  if (created.length) await prisma.notification.create({ data: { tone: 'success', title: 'Question import completed', body: `${created.length} questions imported into ${e.title}.`, href: `/organization/exams/${e.id}/questions` } });
  audit(req, 'question.import', e.id, { added: created.length, errors: errors.length });
  return { added: created.length, errors, questions: created.map((q) => toQuestion(q)) };
}));
