/**
 * Default: live testing data only (one organization account and one real exam; seed-live.ts).
 * `--demo`: the full demo dataset below, which the smoke test uses.
 *
 * The demo dataset is the same one the web UI used in mock mode, so every screen looks
 * identical after wiring: 6 exams, 120 questions, 60 candidates, 30 sessions, 150 violations and
 * browsing logs with AI sites. Adds staff accounts, demo candidates, scored answers, evidence
 * images and risk history. Safe to re-run: it wipes and recreates everything.
 */
import { PrismaClient, type Prisma, type ViolationCode } from '@prisma/client';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  BROWSING_LOGS, CANDIDATES, EXAMS, QUESTIONS, SESSIONS, VIOLATIONS,
} from './seed-data';
import { encrypt, hashPassword } from '../../apps/api/src/lib/crypto';
import { DEFAULT_POLICY, VIOLATION_META, defaultExtras, readExtras, scoreAnswers } from '../../apps/api/src/lib/domain';
import { seedLive } from './seed-live';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
loadDotenv({ path: join(ROOT, '.env') });
const prisma = new PrismaClient();
const SECRET = process.env.JWT_SECRET ?? 'change_me';
const EVIDENCE_DIR = resolve(ROOT, process.env.EVIDENCE_DIR ?? '.data/evidence');
const MIN = 60_000;
/** The live demo exam (exm_01) opens 35 minutes before seeding and stays open this long, so demos keep working for hours. */
const DEMO_OPEN_MS = 8 * 60 * MIN;

export const DEMO = {
  admin: { email: 'admin@wue.in', password: 'Admin@123', name: 'Ritu Malhotra' },
  mentor: { email: 'mentor@wue.in', password: 'Mentor@123', name: 'Dr. Sandeep Kulkarni' },
  mentor2: { email: 'mentor2@wue.in', password: 'Mentor@123', name: 'Prof. Anita Deshmukh' },
  candidate: { examCode: 'CPA-26', userId: 'WUE26DEMO', password: 'Demo@2026', name: 'Aarav Sharma (Demo)', email: 'demo.candidate@wue.in' },
  candidate2: { examCode: 'DSA-MT', userId: 'WUE26DEMO2', password: 'Demo@2026', name: 'Ananya Iyer (Demo)', email: 'demo.candidate2@wue.in' },
};

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = rng(102);

/* Test portraits (database/prisma/faces, from randomuser.me) give every candidate a real face. */
const FACES_DIR = join(ROOT, 'database', 'prisma', 'faces');
const FEMALE = new Set(['Ananya', 'Diya', 'Kavya', 'Meera', 'Priya', 'Sneha', 'Isha', 'Riya', 'Nikita', 'Pooja', 'Neha', 'Tanvi', 'Aditi', 'Zoya', 'Lakshmi', 'Shreya']);
const faceCounters = { men: 0, women: 0 };
function faceFor(name: string): string {
  const g = FEMALE.has(name.split(' ')[0] ?? '') ? 'women' : 'men';
  return join(FACES_DIR, `${g}-${faceCounters[g]++ % 36}.jpg`);
}
const b64 = (file: string) => (existsSync(file) ? readFileSync(file).toString('base64') : '');

/* Evidence frames for seeded violations: a webcam-style shot built from the candidate's real portrait
   with the detector overlay (boxes, landmarks, scores). Live sessions store real webcam JPEGs instead. */
function evidenceSvg(code: ViolationCode, at: Date, face: string, other: string): string {
  const img = (data: string, x: number, y: number, size: number, extra = '') =>
    data ? `<image href="data:image/jpeg;base64,${data}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" ${extra}/>` : '';
  const box = (x: number, y: number, w: number, color: string, label: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${w * 1.15}" rx="10" fill="none" stroke="${color}" stroke-width="3"/>` +
    `<rect x="${x}" y="${y - 24}" width="${label.length * 7.4 + 16}" height="22" rx="6" fill="${color}"/>` +
    `<text x="${x + 8}" y="${y - 8}" font-size="12.5" font-family="Segoe UI,Arial" font-weight="600" fill="#fff">${label}</text>` +
    [0.32, 0.68].map((fx) => `<circle cx="${x + w * fx}" cy="${y + w * 0.42}" r="3.2" fill="${color}"/>`).join('') +
    `<circle cx="${x + w * 0.5}" cy="${y + w * 0.6}" r="3" fill="${color}"/>`;
  const room = `<defs><radialGradient id="r" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#3b4a6b"/><stop offset="1" stop-color="#0b1225"/></radialGradient>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
    <clipPath id="c1"><rect x="200" y="70" width="240" height="276" rx="22"/></clipPath><clipPath id="c2"><rect x="90" y="96" width="200" height="230" rx="20"/></clipPath><clipPath id="c3"><rect x="360" y="110" width="190" height="218" rx="20"/></clipPath></defs>
    <rect width="640" height="400" fill="url(#r)"/><rect x="0" y="300" width="640" height="100" fill="#1b2438" opacity=".7"/>`;
  let scene: string;
  switch (code) {
    case 'MULTIPLE_FACES':
      scene = img(face, 90, 96, 200, 'clip-path="url(#c2)"') + img(other, 360, 110, 190, 'clip-path="url(#c3)" opacity=".92"') +
        box(90, 96, 200, '#16A34A', 'candidate 0.97') + box(360, 110, 190, '#DC2626', 'second face 0.91');
      break;
    case 'FACE_MISMATCH':
      scene = img(other, 200, 70, 240, 'clip-path="url(#c1)"') + box(200, 70, 240, '#DC2626', 'match 0.21 (needs 0.36)');
      break;
    case 'NO_FACE':
      scene = `<rect x="210" y="80" width="220" height="250" rx="18" fill="none" stroke="#F59E0B" stroke-width="3" stroke-dasharray="12 9"/>
        <text x="320" y="215" text-anchor="middle" font-size="16" font-family="Segoe UI,Arial" fill="#fcd34d">no face for 9 s</text>`;
      break;
    case 'CAMERA_BLOCKED':
      scene = `<rect width="640" height="400" fill="#05070d"/><text x="320" y="205" text-anchor="middle" font-size="18" font-family="Segoe UI,Arial" fill="#94a3b8">brightness 6 · camera covered</text>`;
      break;
    default:
      scene = img(face, 200, 70, 240, 'clip-path="url(#c1)"') + box(200, 70, 240, '#F59E0B', 'gaze yaw 34°');
  }
  const label = VIOLATION_META[code].label;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">${room}${scene}<rect width="640" height="400" fill="url(#v)"/>
    <circle cx="26" cy="26" r="7" fill="#ef4444"/><text x="40" y="31" font-size="13" font-family="Segoe UI,Arial" font-weight="700" fill="#fff">REC</text>
    <text x="614" y="31" text-anchor="end" font-size="12" font-family="Consolas,monospace" fill="#cbd5e1">CAM-0 · 640x400</text>
    <rect y="360" width="640" height="40" fill="#0b1f4d" fill-opacity=".92"/><text x="16" y="385" font-size="15" font-family="Segoe UI,Arial" font-weight="600" fill="#fff">${label}</text>
    <text x="624" y="385" text-anchor="end" font-size="13" font-family="Consolas,monospace" fill="#93c5fd">${at.toISOString().slice(0, 19).replace('T', ' ')} UTC</text></svg>`;
}

async function wipe(): Promise<void> {
  // Fixed table list, no user input: TRUNCATE is far faster than ordered deleteMany calls.
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog","EmailLog","Notification","OtpCode","RiskPoint","WarningMessage","ActivityLog","BrowsingLog","Violation","Evidence","Answer","ExamSession","DeviceBinding","Candidate","Question","Exam","User" CASCADE',
  );
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

async function main(): Promise<void> {
  const t0 = Date.now();
  await wipe();

  const [adminHash, mentorHash] = await Promise.all([hashPassword(DEMO.admin.password), hashPassword(DEMO.mentor.password)]);
  const admin = await prisma.user.create({ data: { email: DEMO.admin.email, name: DEMO.admin.name, role: 'ADMIN', passwordHash: adminHash } });
  await prisma.user.createMany({
    data: [
      { email: DEMO.mentor.email, name: DEMO.mentor.name, role: 'MENTOR', passwordHash: mentorHash },
      { email: DEMO.mentor2.email, name: DEMO.mentor2.name, role: 'MENTOR', passwordHash: mentorHash },
    ],
  });
  const mentor = await prisma.user.findUniqueOrThrow({ where: { email: DEMO.mentor.email } });

  /* exams: the first live exam gets a long window so demos keep working for hours after seeding */
  for (const e of EXAMS) {
    const startsAt = new Date(e.startsAt);
    const endsAt = e.id === 'exm_01' ? new Date(Date.now() + DEMO_OPEN_MS) : new Date(e.endsAt);
    await prisma.exam.create({
      data: {
        id: e.id, title: e.title, code: e.code, status: e.status === 'DRAFT' ? 'DRAFT' : 'SCHEDULED',
        startsAt, endsAt, durationMin: e.durationMin,
        settings: (e.id === 'exm_01' ? { ...e.settings, allowedSites: ['en.wikipedia.org', 'docs.python.org', 'khanacademy.org'] } : e.settings) as unknown as Prisma.InputJsonValue,
        extras: { ...defaultExtras(e.title), negativeValue: 0.25, lateEntryMin: e.status === 'LIVE' ? 480 : 10 } as unknown as Prisma.InputJsonValue,
        policy: { ...DEFAULT_POLICY, weights: { LOW: 3, MEDIUM: 8, HIGH: 15, CRITICAL: 30 }, maxWarnings: e.settings.maxWarnings } as unknown as Prisma.InputJsonValue,
        createdById: admin.id,
      },
    });
  }

  const byExam = new Map<string, number>();
  await prisma.question.createMany({
    data: QUESTIONS.map((q) => {
      const position = byExam.get(q.examId) ?? 0;
      byExam.set(q.examId, position + 1);
      return {
        id: q.id, examId: q.examId, position, text: q.text, options: q.options, correctIds: q.correctIds, multi: q.multi, marks: q.marks, difficulty: q.difficulty, tags: q.tags,
        type: q.type ?? 'MCQ', ...(q.answerKey ? { answerKey: q.answerKey as unknown as Prisma.InputJsonValue } : {}),
      };
    }),
  });

  /* candidates: password Exam@<last 4 of user id>, as shown on the web login demo panel */
  const candidateRows: Prisma.CandidateCreateManyInput[] = [];
  const faceOf = new Map<string, string>();
  for (const c of CANDIDATES) {
    const password = `Exam@${c.userId.slice(-4)}`;
    const face = faceFor(c.name);
    const photoPath = `face_${c.id}.jpg`;
    if (existsSync(face)) {
      copyFileSync(face, join(EVIDENCE_DIR, photoPath));
      faceOf.set(c.id, face);
    }
    candidateRows.push({
      id: c.id, examId: c.examId, userId: c.userId, name: c.name, email: c.email, status: c.status, emailStatus: c.emailStatus,
      passwordHash: await hashPassword(password), credentialCipher: encrypt(password, SECRET),
      ...(faceOf.has(c.id) ? { photoPath, faceVerifiedAt: new Date(), faceScore: 0.93 } : {}),
    });
  }
  for (const d of [DEMO.candidate, DEMO.candidate2]) {
    const exam = EXAMS.find((e) => e.code === d.examCode);
    if (!exam) continue;
    candidateRows.push({
      id: `cnd_${d.userId.toLowerCase()}`, examId: exam.id, userId: d.userId, name: d.name, email: d.email, status: 'EMAILED', emailStatus: 'SENT',
      passwordHash: await hashPassword(d.password), credentialCipher: encrypt(d.password, SECRET),
    });
  }
  await prisma.candidate.createMany({ data: candidateRows });

  /* sessions with scored answers */
  const questionsByExam = new Map<string, typeof QUESTIONS>();
  for (const q of QUESTIONS) questionsByExam.set(q.examId, [...(questionsByExam.get(q.examId) ?? []), q]);
  const answerRows: Prisma.AnswerCreateManyInput[] = [];
  for (const s of SESSIONS) {
    const exam = EXAMS.find((e) => e.id === s.examId);
    if (!exam) continue;
    const qs = questionsByExam.get(s.examId) ?? [];
    const startedAt = new Date(s.startedAt);
    const examEnd = s.examId === 'exm_01' ? Date.now() + DEMO_OPEN_MS : new Date(exam.endsAt).getTime();
    const deadlineAt = new Date(Math.min(startedAt.getTime() + exam.durationMin * MIN, examEnd));
    const ability = 0.35 + rnd() * 0.6;
    const answered = Math.round((qs.length * s.progress) / 100);
    const answers = new Map<string, string[]>();
    const values = new Map<string, number>();
    qs.slice(0, answered).forEach((q) => {
      if (q.type === 'NUMERIC' && q.answerKey) {
        // Right with the candidate's ability, otherwise off by a few units.
        const value = rnd() < ability ? q.answerKey.value : q.answerKey.value + 1 + Math.floor(rnd() * 5);
        values.set(q.id, value);
        answerRows.push({ sessionId: s.id, questionId: q.id, optionIds: [], value });
        return;
      }
      const pick = rnd() < ability ? q.correctIds : [q.options[Math.floor(rnd() * q.options.length)]?.id ?? 'a'];
      answers.set(q.id, pick);
      answerRows.push({ sessionId: s.id, questionId: q.id, optionIds: pick });
    });
    const done = s.status === 'SUBMITTED' || s.status === 'TERMINATED';
    const { score } = scoreAnswers(qs, answers, { enabled: exam.settings.negativeMarking, value: 0.25 }, values);
    await prisma.examSession.create({
      data: {
        id: s.id, candidateId: s.candidateId, examId: s.examId, status: s.status, progress: s.progress, riskScore: s.riskScore, warnings: s.warnings,
        questionOrder: qs.map((q) => q.id), startedAt, deadlineAt, consentAt: startedAt, faceVerifiedAt: startedAt, faceScore: 0.9, otpVerifiedAt: startedAt,
        deviceId: `seed-device-${s.candidateId}`,
        // Seeded sessions have no client attached, so they never send heartbeats; null keeps the sweeper away.
        lastHeartbeatAt: null,
        ...(done ? {
          submittedAt: new Date(Math.min(deadlineAt.getTime(), startedAt.getTime() + exam.durationMin * MIN * 0.95)),
          submitReason: s.status === 'TERMINATED' ? 'CRITICAL_VIOLATION' : 'MANUAL',
          score, receiptId: `RCPT-${s.id.toUpperCase().replace('_', '')}`,
        } : {}),
      },
    });
  }
  await prisma.answer.createMany({ data: answerRows });

  /* violations with evidence files, plus a risk curve per session */
  const evidenceRows: Prisma.EvidenceCreateManyInput[] = [];
  const violationRows: Prisma.ViolationCreateManyInput[] = [];
  for (const v of VIOLATIONS) {
    const at = new Date(v.at);
    let evidenceId: string | undefined;
    if (v.evidenceUrl) {
      evidenceId = `evd_${v.id}`;
      const file = `${evidenceId}.svg`;
      const candidateId = SESSIONS.find((x) => x.id === v.sessionId)?.candidateId ?? '';
      const own = faceOf.get(candidateId) ?? '';
      const other = [...faceOf.values()][Math.floor(rnd() * faceOf.size)] ?? '';
      writeFileSync(join(EVIDENCE_DIR, file), evidenceSvg(v.code, at, b64(own), b64(other)));
      evidenceRows.push({ id: evidenceId, sessionId: v.sessionId, kind: 'webcam', path: file, mime: 'image/svg+xml', createdAt: at });
    }
    violationRows.push({
      id: v.id, sessionId: v.sessionId, code: v.code, severity: v.severity, at, message: v.message, source: 'agent', confidence: 0.7 + rnd() * 0.29,
      evidenceId, reviewed: v.reviewed ?? null, reviewedById: v.reviewed ? mentor.id : null, reviewedAt: v.reviewed ? new Date(at.getTime() + 30 * MIN) : null,
      reviewReason: v.reviewed === 'OVERRULED' ? 'Evidence does not show misconduct.' : v.reviewed ? 'Evidence confirms the event.' : null,
    });
  }
  await prisma.evidence.createMany({ data: evidenceRows });
  await prisma.violation.createMany({ data: violationRows });

  const riskRows: Prisma.RiskPointCreateManyInput[] = [];
  for (const s of SESSIONS) {
    const mine = VIOLATIONS.filter((v) => v.sessionId === s.id).sort((a, b) => a.at.localeCompare(b.at));
    let risk = 0;
    riskRows.push({ sessionId: s.id, at: new Date(s.startedAt), score: 0 });
    for (const v of mine) {
      if (v.reviewed !== 'OVERRULED') risk = Math.min(100, risk + ({ LOW: 3, MEDIUM: 8, HIGH: 15, CRITICAL: 30 } as const)[v.severity]);
      riskRows.push({ sessionId: s.id, at: new Date(v.at), score: risk });
    }
  }
  await prisma.riskPoint.createMany({ data: riskRows });

  await prisma.browsingLog.createMany({
    data: BROWSING_LOGS.map((b) => ({ id: b.id, sessionId: b.sessionId, at: new Date(b.at), url: b.url, title: b.title, query: b.query ?? null, flaggedAi: b.flaggedAi })),
  });

  await prisma.notification.createMany({
    data: [
      { tone: 'danger', title: 'Critical violation in CPA-26', body: 'An AI query was detected in a live session. Review the evidence.', href: '/admin/exams/exm_01/reports', at: new Date(Date.now() - 3 * MIN) },
      { tone: 'warning', title: 'Email delivery failed for some candidates', body: 'CDF-01 credentials bounced. Check the addresses and resend.', href: '/admin/exams/exm_03/credentials', at: new Date(Date.now() - 18 * MIN) },
      { tone: 'info', title: 'Mentor joined live monitoring', body: `${DEMO.mentor.name} is watching DSA-MT.`, at: new Date(Date.now() - 41 * MIN) },
      { tone: 'success', title: 'Question import completed', body: '20 MCQs imported into Cloud & DevOps Fundamentals.', href: '/admin/exams/exm_03/questions', read: true, at: new Date(Date.now() - 95 * MIN) },
      { tone: 'success', title: 'PYT-SEP results are ready', body: '10 submissions evaluated.', href: '/admin/exams/exm_04/reports', read: true, at: new Date(Date.now() - 180 * MIN) },
    ],
  });
  await prisma.auditLog.create({ data: { actorId: admin.id, actorRole: 'ADMIN', action: 'seed.run', meta: { exams: EXAMS.length } } });

  const counts = await Promise.all([prisma.exam.count(), prisma.question.count(), prisma.candidate.count(), prisma.examSession.count(), prisma.violation.count(), prisma.browsingLog.count()]);
  console.log(`[seed] exams=${counts[0]} questions=${counts[1]} candidates=${counts[2]} sessions=${counts[3]} violations=${counts[4]} browsing=${counts[5]} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[seed] Admin ${DEMO.admin.email} / ${DEMO.admin.password} · Mentor ${DEMO.mentor.email} / ${DEMO.mentor.password}`);
  console.log(`[seed] Candidate exam ${DEMO.candidate.examCode} · user ${DEMO.candidate.userId} · password ${DEMO.candidate.password}`);
}

/**
 * `--refresh-demo`: once the demo exam can no longer take a fresh start (late entry closed, or less than its
 * duration left), move its window to now as if just seeded. Leaves every other row alone; never runs in production.
 */
async function refreshDemo(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;
  const exam = await prisma.exam.findUnique({ where: { id: 'exm_01' }, select: { code: true, title: true, startsAt: true, endsAt: true, durationMin: true, extras: true } });
  if (!exam) return;
  const now = Date.now();
  const { lateEntryMin } = readExtras(exam.extras, exam.title);
  const lateClosed = lateEntryMin > 0 && now > exam.startsAt.getTime() + lateEntryMin * MIN;
  const tooShort = exam.endsAt.getTime() - now < exam.durationMin * MIN;
  if (!lateClosed && !tooShort) return;
  const startsAt = new Date(now - 35 * MIN);
  const endsAt = new Date(now + DEMO_OPEN_MS);
  await prisma.exam.update({ where: { id: 'exm_01' }, data: { startsAt, endsAt } });
  console.log(`[seed] ${exam.code} had closed for new starts; its window now runs until ${endsAt.toLocaleTimeString()}.`);
}

async function live(): Promise<void> {
  await wipe();
  await seedLive(prisma);
}

(process.argv.includes('--refresh-demo') ? refreshDemo() : process.argv.includes('--demo') ? main() : live())
  .catch((error: unknown) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
