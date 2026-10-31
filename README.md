# Where U Elevate · Smart Proctor (DEV102)

A smart proctoring platform for MCQ assessments, built for the WUElev8 problem statement *Build a Smart Proctoring Browser for Assessment*.

## Live links

| What | Link |
| --- | --- |
| Website | https://dev-102-psi.vercel.app |
| Sign in | https://dev-102-psi.vercel.app/login |
| Windows exam app | https://dev-102-psi.vercel.app/download |
| API health | https://dev102-api.onrender.com/health |

The API and AI agent run on Render's free plan, so the first request after a quiet period can take about a minute.

## What is in this repo

| Part | Path | Stack |
| --- | --- | --- |
| Candidate exam app and desktop proctor monitor | `apps/desktop` | Electron 35, React 19, Vite |
| Website: landing, organization console, proctor console, candidate lobby | `apps/web` | Next.js 15, Tailwind 4 |
| Chrome extension for taking an exam in a browser (not yet on the Chrome Web Store) | `apps/extension` | Manifest V3, TypeScript |
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

### Demo accounts (local run)

| Role | Where | Sign in |
| --- | --- | --- |
| Organization | website `/login` → Organization | `admin@wue.in` / `Admin@123` |
| Proctor | website `/login` → Proctor | `mentor@wue.in` / `Mentor@123` |
| Candidate | desktop app | Paste a join link (dev panel Ctrl+Shift+D → **Candidate link**), password `Demo@2026` |
| Proctor | desktop app | Paste a join link (dev panel → **Proctor link**), password `Mentor@123`, then face + OTP |

All other seeded candidates use `Exam@` plus the last four digits of their User ID. The OTP email goes to the dev outbox when SMTP is not configured, and the desktop app shows the code during development.

### Dev toolbar

Press **Ctrl+Shift+D** (or click the **DEV** pill) in the website to see service health (API, Postgres, AI agent, sockets), sign in as any demo role in one click, inject violations into a live session, reset the demo candidate, reseed the database and read the email outbox. The desktop app has its own dev panel on the same shortcut. Both exist only in development builds; the `/dev` API routes are not mounted when `NODE_ENV=production`.

## Candidate flow

Email with a personal join link and password → paste the link in the desktop app, enter the password (lockout after 5 failures; the link locks to that computer and expires when the exam ends) → system check (camera, microphone, measured network speed, 60+ blacklisted apps, displays and mirroring, VM and remote desktop) → face verification (first capture registers the reference photo) and email OTP → consent screen → entire-screen share → exam window with server-synced timer and autosave → receipt.

Exams use open monitoring by default: nothing is locked or blocked, candidates see no warnings, and the exam does not end early on its own. Every event goes to the proctor with evidence instead.

During the exam:

- **Webcam frames** go to the AI agent every second: no face, multiple faces, covered camera, head pose and iris gaze with sustained look-away timers, face match against the registered photo, and objects in view: a phone in one frame raises `PHONE_DETECTED` (HIGH) when it scores at least 0.35 and covers 2% of the frame, or scores 0.5 and covers 0.4% (a phone in the hand or on the desk), a book or notes covering at least 4% of the frame in 3 frames raises `NOTES_DETECTED` (MEDIUM). Objects use MediaPipe EfficientDet-Lite0 (Apache-2.0); `OBJECT_DETECTION=0` turns them off.
- **Screen frames** every 20 s (LLM vision classification when `LLM_API_KEY` is set).
- **Audio checks** (per exam, off by default): the desktop app learns the room's background noise for 20 s, then raises `VOICE_DETECTED` when speech fills 6 of any 10 seconds, and `MIC_BLOCKED` when the microphone is muted, unplugged or silent for 10 s. Sound is analysed on the candidate's computer and never recorded or sent; only the event is. Thresholds are in `apps/desktop/src/lib/audio.ts`.
- **Leaving the exam window** is reported to the proctor with the open window titles and a picture of the screen. An AI assistant in those titles raises `AI_SITE_OPENED`.
- **Browser extension**: for an exam taken in Chrome, it reports tabs and sites visited, and captures what is typed into searches and AI chats and what the AI replies.
- **Desktop checks**: blacklisted and remote-desktop apps, clipboard use, new USB devices, extra displays, mirroring, and VM and remote sessions.
- **Activity logging**: keystroke timing and mouse movement summaries, from inside the exam window only. Raw keys are never recorded.
- **Offline mode**: answers, events and browsing logs are queued in an encrypted store (Windows DPAPI via `safeStorage`) and replayed in order when the connection returns.

## Policy and review

Each exam has a configurable policy (weights, marks per severity, cooldown, risk flag). A proctor reviews each flag, confirms or overrules it with a reason, and can change the marks; confirmed flags reduce the candidate's score. Proctors can also warn or terminate a candidate by hand. The server is authoritative, and every flag keeps its evidence behind a 15-minute HMAC-signed URL.

Automatic warnings and auto-submit still exist in the policy engine, but stay off while the exam's `proctorOnly` setting is on, which is the default.

## Security

bcrypt (cost 12) passwords; lockout after 5 failures; OTPs HMAC-hashed with a 5-minute expiry, 30 s resend cooldown and 5 attempts; JWT HS256 with revocation (token version per account); one active session and device binding per candidate; helmet with a strict CSP; strict CORS; per-route rate limits; zod validation on every input; Prisma only (no raw SQL with user input); role guards on every route; audit log for staff actions; secrets redacted from logs; emailed passwords stored AES-GCM-encrypted only until first sign-in; magic-byte checks on uploaded images; configurable evidence retention with a cleanup job; and a sandboxed Electron renderer with context isolation and an IPC sender check.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm start` | Everything (database, API, agent, web, desktop) |
| `npm run smoke` | End-to-end API test of the admin, candidate and mentor flows (needs the API running and the demo data: `npm run db:seed:demo`) |
| `npm run start:lan` | Same as `npm start`, but join links and the website use this laptop's Wi-Fi address for a friend's laptop |
| `npm run test-kit` | Development only: 5 tester links + 1 proctor link on LIVE-01, password `Test@2026`; rerun to reset |
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

See [`.env.example`](.env.example). To send real email set `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` (for Gmail, an app password) and leave `MAIL_FROM` blank to send from `SMTP_USER`. In production, email without SMTP fails instead of going to the dev outbox. To use a hosted database, point `DATABASE_URL` at it and the embedded server is skipped. `LLM_API_KEY` is optional.

## Honest limits

A desktop proctor cannot see everything: a second phone held out of camera view, or a person whispering quietly off-camera, can go undetected. Object detection sees a 320×320 copy of the webcam frame, so a phone that is small, partly hidden or held low in the lap is often missed, and a book only partly in frame may be too. Audio checks notice sustained talking, not what is said or who is speaking, so a TV or music can also raise `VOICE_DETECTED`; it is a MEDIUM event that warns but never auto-submits on its own. That is why the system combines several signals into an explainable risk score and keeps a human in the loop for every penalty. Face matching and gaze estimates are probabilistic; thresholds are configurable in `backend-services/config.py`. Because exams are monitored rather than locked down, a candidate can use other apps during an exam, and the proctor decides what to do about it. The browser extension sends a screen picture every 20 s, not the desktop app's live screen video.

## Testing

Last run on this code: 238 unit tests with Vitest (180 API, 58 desktop) and 44 Python tests with pytest, all passing. Run them with `npm test` and `npm run test:agent`.

## Deployment

| Part | Host | Config |
| --- | --- | --- |
| Website | Vercel | `apps/web/vercel.json` |
| API and AI agent | Render, free plan | `render.yaml` |
| Database | Neon PostgreSQL | `DATABASE_URL` |

## Disclosure

**Open-source libraries:** Electron, React, Next.js, Express, Socket.IO, Prisma, zod, FastAPI, OpenCV, MediaPipe and others listed in each `package.json` and `backend-services/requirements.txt`.

**Pretrained models (not trained by us):**

| Model | Source | Use |
| --- | --- | --- |
| YuNet face detector | OpenCV Zoo | Face count |
| SFace face recognizer | OpenCV Zoo | Identity match |
| Face Landmarker | Google MediaPipe | Gaze and head pose |
| EfficientDet-Lite0 (Apache-2.0) | Google MediaPipe | Phone and notes detection |
| face-api.js models | `@vladmandic/face-api` | On-screen face guide in the desktop app |

**External services:** SMTP or Brevo for email, an optional LLM provider for screen and query checks (off unless `LLM_API_KEY` is set), Google STUN and an optional TURN relay for WebRTC.

**Data:** seeded demo exams and accounts only, plus test portraits from randomuser.me in `database/prisma/faces`. No real candidate data.

**AI-assisted development:** code was written with AI coding assistants as the team's tools: Claude Code, OpenAI Codex, Google Antigravity / Gemini and GitHub Copilot.
