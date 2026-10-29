// Development only: ready-made accounts for a local test round, without the organization website.
//   npm run test-kit                                   -> 5 testers + 1 proctor on LIVE-01
//   npm run test-kit -- --count 3
//   npm run test-kit -- --emails a@gmail.com,b@gmail.com   (testers 1 and 2 get OTP emails there)
// Everyone uses the same password. Each run resets the accounts and issues fresh links, so it is
// also how a new test round starts. Run it while `npm run start:lan` (or `npm start`) is running.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lanAddresses } from './lan.mjs';

const PASSWORD = 'Test@2026';
const EXAM_CODE = 'LIVE-01';
const PROCTOR = { email: 'proctor@example.com', name: 'Test Proctor' };

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const count = Math.min(20, Math.max(1, Number(arg('count') ?? 5) || 5));
const emails = (arg('emails') ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

/** The website's port: npm start moves it to 3001, 3002… when 3000 is busy. */
async function webPort(): Promise<number> {
  for (let port = 3000; port < 3020; port++) {
    try {
      const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
      if (r.headers.get('x-powered-by')?.includes('Next.js')) return port;
    } catch {
      /* not this port */
    }
  }
  return 3000;
}

async function main(): Promise<void> {
  try {
    await fetch('http://localhost:4000/health', { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error('The exam server is not running. Start it first with: npm run start:lan');
  }
  const lan = lanAddresses()[0]?.address ?? 'localhost';
  // Links are built from CLIENT_URL, so it must be set before the API config loads.
  process.env.CLIENT_URL = `http://${lan}:${await webPort()}`;
  const { config, ROOT_DIR } = await import('../apps/api/src/config.js');
  if (config.isProd) throw new Error('test-kit never runs in production.');
  const { prisma } = await import('../apps/api/src/lib/db.js');
  const { encrypt, hashPassword } = await import('../apps/api/src/lib/crypto.js');
  const { issueInvite } = await import('../apps/api/src/modules/invites.js');

  const exam = await prisma.exam.findFirst({ where: { code: EXAM_CODE, deletedAt: null } });
  if (!exam) throw new Error(`Exam ${EXAM_CODE} not found. Run "node scripts/start.mjs --reseed" once.`);
  const secret = { passwordHash: await hashPassword(PASSWORD), credentialCipher: encrypt(PASSWORD, config.JWT_SECRET) };

  const testers: { name: string; userId: string; email: string; link: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const userId = `TESTER${i}`;
    const email = emails[i - 1] ?? `tester${i}@example.com`;
    const fresh = { status: 'EMAILED' as const, failedLogins: 0, lockedUntil: null, faceVerifiedAt: null, faceScore: null, photoPath: null, ...secret };
    const c = await prisma.candidate.upsert({
      where: { examId_userId: { examId: exam.id, userId } },
      create: { examId: exam.id, userId, name: `Tester ${i}`, email, ...fresh },
      update: { email, ...fresh, tokenVersion: { increment: 1 } },
    });
    // A clean round: no earlier attempt, device lock or code carries over.
    await prisma.examSession.deleteMany({ where: { candidateId: c.id } });
    await prisma.deviceBinding.deleteMany({ where: { candidateId: c.id } });
    await prisma.otpCode.deleteMany({ where: { subjectId: c.id } });
    const { link } = await issueInvite({ examId: exam.id, endsAt: exam.endsAt, role: 'CANDIDATE', email, candidateId: c.id });
    testers.push({ name: c.name, userId, email, link });
  }

  const proctor = await prisma.user.upsert({
    where: { email: PROCTOR.email },
    create: { ...PROCTOR, role: 'MENTOR', ...secret },
    update: { role: 'MENTOR', deletedAt: null, failedLogins: 0, lockedUntil: null, ...secret, tokenVersion: { increment: 1 } },
  });
  await prisma.otpCode.deleteMany({ where: { subjectId: proctor.id } });
  const proctorLink = (await issueInvite({ examId: exam.id, endsAt: exam.endsAt, role: 'MENTOR', email: proctor.email, userId: proctor.id })).link;
  await prisma.$disconnect();

  const sheet = [
    `SMART PROCTOR TEST KIT · ${exam.code} · ${exam.title}`,
    `Password for everyone: ${PASSWORD}`,
    `Exam open until: ${exam.endsAt.toLocaleString()}`,
    '',
    'TESTERS (one link per computer; paste it in the Smart Proctor app)',
    ...testers.map((t) => `  ${t.name}  (${t.userId}, OTP to ${t.email})\n    ${t.link}`),
    '',
    'PROCTOR (desktop app: paste the link)',
    `  ${PROCTOR.name}  (${PROCTOR.email})\n    ${proctorLink}`,
    '',
    'WATCH ON THE WEBSITE',
    `  ${process.env.CLIENT_URL.replace(lan, 'localhost')}/login   organization account (admin@wue.in / Admin@123 unless ORG_ADMIN_* is set)`,
    '',
    `App download for testers: http://${lan}:${config.PORT}/api/v1/downloads/windows`,
    'The OTP code is shown on the verification screen while testing (and emailed when SMTP is set).',
    'Run "npm run test-kit" again to reset everyone for a new round.',
  ].join('\n');
  const dir = join(ROOT_DIR, '.data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'test-kit.txt'), `${sheet}\n`);
  console.log(`\n${sheet}\n\nSaved to .data/test-kit.txt`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
