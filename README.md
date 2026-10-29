# Where U Elevate · Smart Proctor (DEV102)

A secure proctoring browser for MCQ assessments, built for the WUElev8 problem statement *Build a Smart Proctoring Browser for Assessment*.

| Part | Path | Stack |
| --- | --- | --- |
| Candidate exam app (kiosk browser) and desktop mentor monitor | `apps/desktop` | Electron 35, React 19, Vite |
| Website: landing, admin console, mentor console, candidate lobby | `apps/web` | Next.js 15, Tailwind 4 |
| API: auth, exams, sessions, policy engine, realtime, reports | `apps/api` | Express 5, Socket.IO, Prisma, zod, pino |
| AI proctoring agent | `backend-services` | FastAPI, OpenCV (YuNet + SFace), MediaPipe Face Landmarker |
| Database | `database/prisma` | PostgreSQL 16+ (embedded locally, Neon or Supabase in production) |

## Run it

Requirements: **Node.js 22 or newer** (Next 15 streaming does not work on Node 20) and **Python 3.11+**. Docker is not needed.

```bash
npm install
```

```bash
npm start
```

On first run `npm start` creates `.env` with fresh secrets, starts an embedded PostgreSQL server from `node_modules` (data in `.data/pg`), creates the schema, seeds demo data, creates the Python venv, then launches the API, AI agent, website and desktop app together. `Ctrl+C` stops everything. Use `npm run start:web` to skip the desktop window and `node scripts/start.mjs --reseed` to reset the data.

| Service | URL |
| --- | --- |
| Website | http://localhost:3000 |
| API | http://localhost:4000/api/v1 |
| AI agent | http://127.0.0.1:8000/health |
| Desktop app | opens as a window (renderer at http://localhost:5173) |

### Demo accounts

| Role | Where | Sign in |
| --- | --- | --- |
| Admin | website `/login` → Administrator | `admin@wue.in` / `Admin@123` |
| Mentor | website `/login` → Mentor | `mentor@wue.in` / `Mentor@123` |
| Candidate | desktop app | Paste a join link (dev panel Ctrl+Shift+D → **Candidate link**), password `Demo@2026` |
| Proctor | desktop app | Paste a join link (dev panel → **Proctor link**), password `Mentor@123`, then face + OTP |

All other seeded candidates use `Exam@` plus the last four digits of their User ID. The OTP email goes to the dev outbox when SMTP is not configured, and the desktop app shows the code during development.

### Dev toolbar

Press **Ctrl+Shift+D** (or click the **DEV** pill) in the website to see service health (API, Postgres, AI agent, sockets), sign in as any demo role in one click, inject violations into a live session, reset the demo candidate, reseed the database and read the email outbox. The desktop app has its own dev panel on the same shortcut. Both exist only in development builds; the `/dev` API routes are not mounted when `NODE_ENV=production`.

## Candidate flow

Email with a personal join link and password → paste the link in the desktop app, enter the password (lockout after 5 failures; the link locks to that computer and expires when the exam ends) → system check (camera, microphone, measured network speed, 60+ blacklisted apps, displays and mirroring, VM and remote desktop) → face verification (first capture registers the reference photo) and email OTP → consent screen → entire-screen share → kiosk exam with server-synced timer, autosave and sandbox tabs → warnings → auto-submit on repeated or critical violations → receipt.

During the exam:

- **Webcam frames** go to the AI agent every 4 s: no face, multiple faces, covered camera, head pose and iris gaze with sustained look-away timers, face match against the registered photo, and objects in view: a phone in 2 frames in a row raises `PHONE_DETECTED` (HIGH), a book or notes covering at least 4% of the frame in 3 frames raises `NOTES_DETECTED` (MEDIUM). Objects use MediaPipe EfficientDet-Lite0 (Apache-2.0); `OBJECT_DETECTION=0` turns them off.
- **Screen frames** every 20 s (LLM vision classification when `LLM_API_KEY` is set).
- **Audio checks** (per exam, off by default): the desktop app learns the room's background noise for 20 s, then raises `VOICE_DETECTED` when speech fills 6 of any 10 seconds, and `MIC_BLOCKED` when the microphone is muted, unplugged or silent for 10 s. Sound is analysed on the candidate's computer and never recorded or sent; only the event is. Thresholds are in `apps/desktop/src/lib/audio.ts`.
- **Sandbox browser tabs** are real isolated webviews. AI assistants stay reachable, as the brief asks, but opening one raises `AI_SITE_OPENED` and everything typed into a chat box or search is logged and shown to mentors. A typed question is `AI_QUERY_DETECTED` (critical), and searches that match the exam's own questions are flagged too.
- **Native guards**: kiosk lock, blocked shortcuts, focus loss, clipboard clearing, new USB devices, extra displays, mirroring, VM and remote sessions, and a single-instance lock.
- **Activity logging**: keystroke timing and mouse movement summaries, from inside the exam window only. Raw keys are never recorded.
- **Offline mode**: answers, events and browsing logs are queued in an encrypted store (Windows DPAPI via `safeStorage`) and replayed in order when the connection returns.

## Policy and review

Each exam has a configurable policy (weights, warning threshold, auto-submit level, cooldown, risk flag). By default the first two MEDIUM or HIGH events warn, the next HIGH or any CRITICAL auto-submits and disqualifies. The server is authoritative: clients only fall back to the local rule while offline. Every penalty keeps its evidence behind a 15-minute HMAC-signed URL. A mentor can confirm or overrule it with a reason, and overruling the event that ended a session reinstates the candidate while time remains.

## Security

bcrypt (cost 12) passwords; lockout after 5 failures; OTPs HMAC-hashed with a 5-minute expiry, 30 s resend cooldown and 5 attempts; JWT HS256 with revocation (token version per account); one active session and device binding per candidate; helmet with a strict CSP; strict CORS; per-route rate limits; zod validation on every input; Prisma only (no raw SQL with user input); role guards on every route; audit log for staff actions; secrets redacted from logs; emailed passwords stored AES-GCM-encrypted only until first sign-in; magic-byte checks on uploaded images; configurable evidence retention with a cleanup job; and a sandboxed Electron renderer with context isolation and an IPC sender check.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm start` | Everything (database, API, agent, web, desktop) |
| `npm run smoke` | End-to-end API test of the admin, candidate and mentor flows (needs the API running and the demo data: `npm run db:seed:demo`) |
| `npm run share` | Prints this laptop's Wi-Fi address for a candidate's app on another laptop |
| `npm run share:tunnel` | Same over the internet through a free Cloudflare quick tunnel (needs `cloudflared`) |
| `npm run db:seed:demo` | Full demo dataset instead of the default live-test data |
| `npm test` | Unit tests (Vitest) for the violation policy, OTP expiry and account lockout. No database needed |
| `npm run test:agent` | Python tests (pytest) for the AI agent's phone and notes rules; installs pytest on first run |
| `npm run lint` | ESLint for the API, website and desktop app |
| `npm run typecheck` | Type-checks every workspace |
| `npm run db` | Only the embedded PostgreSQL server |
| `npm run db:seed` | Reset to live-test data (organization login + LIVE-01) |
| `npm run db:studio` | Browse the database |
| `npm run build -w apps/desktop` | Windows installer in `apps/desktop/release` |

## Configuration

See [`.env.example`](.env.example). To send real email set `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` (for Gmail, an app password). To use a hosted database, point `DATABASE_URL` at it and the embedded server is skipped. `LLM_API_KEY` is optional.

## Honest limits

A desktop proctor cannot see everything: a second phone held out of camera view, or a person whispering quietly off-camera, can go undetected. Object detection sees a 320×320 copy of the webcam frame, so a phone that is small, partly hidden or held low in the lap is often missed, and a book only partly in frame may be too. Audio checks notice sustained talking, not what is said or who is speaking, so a TV or music can also raise `VOICE_DETECTED`; it is a MEDIUM event that warns but never auto-submits on its own. That is why the system combines several signals into an explainable risk score and keeps a human in the loop for every penalty. Face matching and gaze estimates are probabilistic; thresholds are configurable in `backend-services/config.py`. Kiosk lock is soft in development (`PROCTOR_STRICT=1` enforces it) and always enforced in packaged builds.




## Documentation

| Doc | For |
| --- | --- |
| [`docs/project-guide.md`](docs/project-guide.md) | How the whole system works, every flow, and the honest limits |
| [`docs/hackathon.md`](docs/hackathon.md) | Rules, rubric mapping, PS coverage, test evidence, disclosure, checklists |
| [`docs/presentation.md`](docs/presentation.md) | Slide outline, timed demo scripts, judge Q&A |
| [`docs/tech-stack.md`](docs/tech-stack.md) | Every library, model and tool, with versions |
| [`docs/architecture.md`](docs/architecture.md) | Components and the exam session sequence |
| [`docs/database.md`](docs/database.md) | Tables and local database setup |
| [`docs/deploy.md`](docs/deploy.md) | Deploying to Render and Vercel |
