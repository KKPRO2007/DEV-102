/**
 * Live testing data: one organization account and one real exam, nothing else.
 * Candidates and proctors are added from the website, which emails them real join links.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../../apps/api/src/lib/crypto';
import { DEFAULT_POLICY, DEFAULT_SETTINGS, defaultExtras } from '../../apps/api/src/lib/domain';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const LIVE_ORG = {
  email: process.env.ORG_ADMIN_EMAIL || 'admin@wue.in',
  password: process.env.ORG_ADMIN_PASSWORD || 'Admin@123',
  name: process.env.ORG_ADMIN_NAME || 'Organization admin',
};
export const LIVE_EXAM = { id: 'live_01', code: 'LIVE-01', title: 'Smart Proctor Live Test' };

type Q = [text: string, options: [string, string, string, string], correct: 0 | 1 | 2 | 3, tags: string[]];

/** Real computer-science and aptitude questions, each with exactly one correct option. */
const QUESTIONS: Q[] = [
  ['What is the time complexity of binary search on a sorted array of n elements?', ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 1, ['algorithms']],
  ['Which data structure follows the First In, First Out (FIFO) order?', ['Stack', 'Queue', 'Binary tree', 'Hash table'], 1, ['data structures']],
  ['Which SQL clause filters rows after a GROUP BY has been applied?', ['WHERE', 'ORDER BY', 'HAVING', 'LIMIT'], 2, ['databases']],
  ['In object-oriented programming, defining several methods with the same name but different parameters is called:', ['Overriding', 'Overloading', 'Encapsulation', 'Abstraction'], 1, ['oop']],
  ['Which HTTP status code means "Not Found"?', ['200', '301', '404', '500'], 2, ['web']],
  ['What is the worst-case time complexity of quicksort?', ['O(n log n)', 'O(n)', 'O(n²)', 'O(log n)'], 2, ['algorithms']],
  ['Which layer of the OSI model is responsible for routing packets between networks?', ['Data link', 'Network', 'Transport', 'Session'], 1, ['networks']],
  ['What does the "A" in ACID stand for in database transactions?', ['Availability', 'Atomicity', 'Accuracy', 'Authorization'], 1, ['databases']],
  ['Which of these is NOT a JavaScript primitive type?', ['string', 'boolean', 'object', 'symbol'], 2, ['javascript']],
  ['A deadlock requires all of the following conditions EXCEPT:', ['Mutual exclusion', 'Hold and wait', 'Preemption', 'Circular wait'], 2, ['operating systems']],
  ['What is the result of 17 % 5 in most programming languages?', ['2', '3', '3.4', '12'], 0, ['programming']],
  ['Which traversal of a binary search tree visits the keys in ascending order?', ['Pre-order', 'In-order', 'Post-order', 'Level-order'], 1, ['data structures']],
  ['Which Git command creates a new branch and switches to it?', ['git branch -d name', 'git checkout -b name', 'git merge name', 'git push -u name'], 1, ['tools']],
  ['How many bits are in one byte?', ['4', '8', '16', '32'], 1, ['fundamentals']],
  ['A train 120 m long passes a pole in 6 seconds. What is its speed?', ['20 m/s', '18 m/s', '72 m/s', '24 m/s'], 0, ['aptitude']],
  ['If 5 workers finish a job in 12 days, how many days would 6 workers take at the same rate?', ['8', '10', '14', '15'], 1, ['aptitude']],
  ['What comes next in the series 2, 6, 12, 20, 30, …?', ['40', '42', '44', '36'], 1, ['aptitude']],
  ['A price rises by 20% and then falls by 20%. The overall change is:', ['No change', '4% decrease', '4% increase', '2% decrease'], 1, ['aptitude']],
  ['Which protocol is used to translate a domain name into an IP address?', ['HTTP', 'FTP', 'DNS', 'SMTP'], 2, ['networks']],
  ['Which sorting algorithm is stable and runs in O(n log n) in the worst case?', ['Quicksort', 'Heapsort', 'Merge sort', 'Selection sort'], 2, ['algorithms']],
];

const IDS = ['a', 'b', 'c', 'd'] as const;

export async function seedLive(prisma: PrismaClient): Promise<void> {
  const admin = await prisma.user.create({
    data: { email: LIVE_ORG.email, name: LIVE_ORG.name, role: 'ADMIN', passwordHash: await hashPassword(LIVE_ORG.password) },
  });
  const now = Date.now();
  await prisma.exam.create({
    data: {
      id: LIVE_EXAM.id, code: LIVE_EXAM.code, title: LIVE_EXAM.title, status: 'SCHEDULED',
      // Open from a few minutes ago for 30 days, so testing can start at any time.
      startsAt: new Date(now - 5 * MIN), endsAt: new Date(now + 30 * DAY), durationMin: 30,
      settings: {
        ...DEFAULT_SETTINGS,
        // Same questions in the same order for everyone, one way only, and only the proctor is told about violations.
        shuffle: false, oneWay: true, proctorOnly: true, autoSubmit: false, audioMonitoring: true, liveAudio: true,
      } as unknown as Prisma.InputJsonValue,
      extras: {
        ...defaultExtras(LIVE_EXAM.title),
        category: 'Live proctoring test', lateEntryMin: 0, releaseResults: 'MANUAL',
        instructions: 'Answer each question before moving on: you cannot go back. Your webcam, microphone, screen and every site you open are monitored by your proctor.',
      } as unknown as Prisma.InputJsonValue,
      policy: { ...DEFAULT_POLICY, autoSubmit: false } as unknown as Prisma.InputJsonValue,
      createdById: admin.id,
    },
  });
  await prisma.question.createMany({
    data: QUESTIONS.map(([text, options, correct, tags], position) => ({
      id: `live_q${String(position + 1).padStart(2, '0')}`, examId: LIVE_EXAM.id, position, text,
      options: options.map((o, i) => ({ id: IDS[i], text: o })), correctIds: [IDS[correct]],
      multi: false, marks: 1, difficulty: 'MEDIUM', tags,
    })),
  });
  await prisma.auditLog.create({ data: { actorId: admin.id, actorRole: 'ADMIN', action: 'seed.live', meta: { exam: LIVE_EXAM.code, questions: QUESTIONS.length } } });
  console.log(`[seed] Live test data: ${LIVE_EXAM.code} "${LIVE_EXAM.title}" with ${QUESTIONS.length} questions, open for 30 days.`);
  console.log(`[seed] Organization sign-in: ${LIVE_ORG.email} / ${LIVE_ORG.password} (set ORG_ADMIN_EMAIL and ORG_ADMIN_PASSWORD in .env to change it).`);
  console.log('[seed] Add candidates and proctors on the website: Organization panel > LIVE-01 > Credentials.');
}
