# Database

PostgreSQL with Prisma. Schema: [`database/prisma/schema.prisma`](../database/prisma/schema.prisma). Seed: [`database/prisma/seed.ts`](../database/prisma/seed.ts).

## Local server

`npm start` (or `npm run db` alone) runs a real PostgreSQL server from the `embedded-postgres` package, so neither Docker nor a system install is needed. Data lives in `.data/pg` (UTF-8, scram-sha-256). It is used whenever `DATABASE_URL` points at `localhost`. Point it at Neon or Supabase and the embedded server is skipped.

```bash
npm run db:push
```

```bash
npm run db:seed
```

```bash
npm run db:studio
```

To start from scratch, stop the services, delete `.data/`, and run `npm start` again.

For production, create migrations with `npm run db:migrate` and apply them with `npm run db:deploy`.

## Tables

| Table | Purpose |
| --- | --- |
| `User` | Staff accounts (ADMIN, MENTOR) with lockout counters and a token version for revocation |
| `Exam` | Title, code, window, duration; JSON `settings`, `extras` and per-exam violation `policy`. Only DRAFT/SCHEDULED is stored; LIVE/COMPLETED are derived from the time window |
| `Question` | MCQ text, options (JSON), correct option ids, marks, difficulty, tags, position |
| `Candidate` | One enrollment per exam (`examId + userId` unique) with password hash, email status, reference photo, face verification time, and the encrypted initial password kept until first sign-in |
| `Invite` | Emailed join links for candidates and proctors: SHA-256 of the token (lookup) and the token AES-256-GCM encrypted (so admins can copy the current link), role, owner, bound device, used, revoked and expiry times (expires when the exam ends) |
| `DeviceBinding` | The computer a candidate first signed in from |
| `ExamSession` | Attempt state: status, deadline, shuffled question order, flags, risk, warnings, consent/face/OTP timestamps, score, receipt, mentor decision |
| `Answer` | Selected option ids per question (unique per session + question) |
| `Violation` | Code, severity, message, source (client, native, agent, server), confidence, policy outcome, linked evidence, review verdict and reason |
| `Evidence` | Webcam or screen frame files under `EVIDENCE_DIR`, served only through signed URLs |
| `BrowsingLog` | Every sandbox URL, title and typed query, with the AI flag |
| `ActivityLog` | Keystroke timing and mouse summaries (no raw keys) |
| `RiskPoint` | Risk score history for charts |
| `WarningMessage` | Mentor messages and terminations |
| `OtpCode` | HMAC-hashed one-time codes with expiry and attempt count |
| `EmailLog` | Delivery attempts and status (rendered body kept only in dev outbox mode, never for OTPs) |
| `AuditLog` | Staff actions with actor and IP |
| `Notification` | Admin notification feed |

## Retention

A job every 6 hours deletes evidence files and rows, activity logs older than `RETENTION_DAYS` (default 30), OTP rows older than a day, and orphaned evidence files. Deleting an exam is a soft delete; its exam code is freed for reuse.
