# Project guide

Read this to understand the whole system before a demo or a judges' Q&A. Every member should be able to explain each section.

## The problem (DEV_102, by WUElev8 / Where U Elevate)

**Build a Smart Proctoring Browser for Assessment**: an application candidates install to take an MCQ test under proctoring, so no LLM or outside help is used.

The six objectives in the brief:

1. Proctoring: capture the webcam, track eye movement, detect unusual behaviour.
2. MCQ tests with a backend that stores and serves questions.
3. Prevent cheating: detect and block multiple logins, screen mirroring and external devices.
4. Authenticate users by facial recognition or OTP before access.
5. A simple, distraction-free, responsive UI.
6. Allow tab switching, but track and show what was searched (for example, ChatGPT opened and what was typed).

Also asked for: activity logging, a timer with auto-submit, automatic warnings and disqualification, optional offline mode, and a bonus browser extension.

## Our answer in one paragraph

An organization creates an exam on the website and selects its candidates and proctors. Each person gets an email with a **personal join link** and a password. They paste the link into the **Smart Proctor desktop app**, which recognises who they are, what exam it is and what role they have, and asks only for the password. Candidates pass a system check, face verification and an email OTP, consent to monitoring, share their screen and take the exam in a locked, full-screen secure exam window. A **Python AI agent** watches webcam frames, screen frames and browsing, and a **policy engine** on the server warns, then auto-submits on repeated or critical violations. **Proctors** verify their face and an OTP too, then watch every candidate live and review evidence. Every penalty can be confirmed or overruled by a human.

## The four parts

```
  Organization (website)                 Candidate / Proctor (desktop app)
  apps/web  · Next.js 15                 apps/desktop · Electron 35
  admin console, mentor console,         paste link → password → checks
  /join/<token>, landing pages           secure exam, sandbox tabs, monitor
           │  REST + Socket.IO                    │  REST + Socket.IO + WebRTC
           └──────────────► apps/api ◄────────────┘
                            Express 5 · Prisma · Socket.IO
                            auth, join links, exams, sessions,
                            policy engine, jobs, reports, email
                               │                    │
                     PostgreSQL (Prisma)     backend-services (FastAPI)
                                             face, gaze, objects, screen,
                                             browsing, risk score
```

| Part | Folder | Talks to |
| --- | --- | --- |
| Website | `apps/web` | API only, through `src/lib/api.ts` |
| Desktop app | `apps/desktop` (`src/` renderer, `electron/` native layer) | API through `src/lib/api.ts` and `src/lib/live.ts` |
| Browser extension (bonus) | `apps/extension` | API, with `channel: "web"` |
| API | `apps/api` | PostgreSQL through Prisma; AI agent over HTTP with `X-Agent-Key` |
| AI agent | `backend-services` | Called only by the API |
| Database | `database/prisma` | Schema, migrations, seed data, test portraits |

## Roles

| Role | Signs in on | Does |
| --- | --- | --- |
| **Admin** (organization) | Website `/login` | Creates exams and questions, imports candidates, invites proctors, emails join links, sets the violation policy, downloads reports |
| **Proctor** (mentor) | Desktop app (join link) or website `/login` | Watches candidates live, warns, terminates, reviews and overrules violations |
| **Candidate** | Desktop app (join link) | Takes the exam |

## Flow 1: organization sets up an exam (website)

1. `/organization/exams/new`: a wizard for basics, schedule, settings (shuffle, negative marking, allowed sites, audio checks) and the violation policy, with a simulator.
2. `/organization/exams/[id]/questions`: add MCQ (single or multiple answer) and numeric questions by hand, or import CSV/Excel.
3. `/organization/exams/[id]/credentials`:
   - **Candidates:** import name + email. User IDs (`WUE26xxxx`) and passwords are generated. **Send credentials** emails each person their own join link plus password. The table shows email status and link status (not used, in use + device locked, revoked, expired), with Resend, Reset password and **Revoke**.
   - **Proctors:** invite by name + email. A mentor account is created if needed, and its temporary password goes in the same email. Resend or revoke at any time.
   - **Passwords:** every candidate and proctor row has **Reveal** and **Copy**. The stored password is encrypted and kept only until that person's first sign-in, and every reveal is audited. After the first sign-in the row offers **Reset & copy**, which issues a new password and signs a proctor out.
   - **Join links:** while a candidate's or proctor's link is active (not used yet, or in use), the row has **Copy link**, so any organization admin can copy the current link without resending it. Each copy is audited (`invite.reveal_link`). Links issued before this feature cannot be recovered; resend those.
4. `/organization/exams/[id]/reports`: results, score distribution, violation heatmap, Excel and PDF downloads.

## Flow 2: join link (both roles)

- The link looks like `https://<site>/join/<48-hex token>`. The server looks links up by the SHA-256 of the token (`Invite.tokenHash`). The token itself is also kept AES-256-GCM encrypted with the server secret (`tokenCipher`), so any organization admin can copy the current link; a database leak alone does not reveal working links.
- Clicking it in Gmail opens the `/join` page. That page shows who it's for and the exam, and has **Copy exam link** and **Get the desktop app** buttons.
- In the desktop app the person pastes the link. The app calls `GET /auth/invites/:token`, which shows the exam, name, User ID or masked email, and role. Then `POST /auth/invites/login` with the password and a device fingerprint.
- Rules enforced by the server:
  - A link works on **the first computer** that signs in with it.
  - It **expires when the exam ends**.
  - Sending a new one **withdraws the old one**.
  - **Revoke** kills it immediately (and signs a proctor out).
  - No link means no way in.
- The login background changes with role and time of day (morning 5–12, day 12–18, night 18–5): the organization image until a link is pasted, then the student or proctor image. The header shows no steps until the link says the role, then shows that role's steps (candidate: six steps; proctor: Sign in → Verify identity → Live monitor).

Code: `apps/api/src/modules/invites.ts`, `modules/auth.ts` (`openInvite`, `/invites/*`), `apps/desktop/src/screens/Login.tsx`, `apps/web/src/app/(marketing)/join/[token]/page.tsx`.

## Flow 3: candidate takes the exam (desktop)

1. **Paste link → password.** Lockout after 5 wrong passwords for 15 minutes.
2. **System check** (`SystemCheck.tsx`): camera, microphone level, measured network speed, 60+ blacklisted apps (close on consent, rescan), displays and mirroring, VM and remote desktop.
3. **Face verification + OTP** (`FaceVerify.tsx`):
   - The first capture registers the reference photo, and later frames are matched against it.
   - A 6-digit code is emailed. It is HMAC-hashed, expires in 5 minutes, allows 5 attempts and has a 30 s resend cooldown.
4. **Consent** (`ScreenShareConsent.tsx`): a plain list of what is monitored, then an entire-screen share.
5. **Exam** (`Exam.tsx`):
   - Secure exam window (full screen, always on top, excluded from screen capture) with a server-synced timer (warnings at 10, 5 and 1 min), autosave, a question palette and mark-for-review.
   - Sandbox browser tabs and a webcam thumbnail.
   - Warning modal and lock overlay on focus loss.
6. **Submitted** (`Submitted.tsx`): submitted, auto-submitted or disqualified, with a receipt number. No answers are shown.

What runs during the exam:

| Signal | How often | Where | Raises |
| --- | --- | --- | --- |
| Webcam frame | every 1 s | agent `face_agent.py`, `vision.py` | `NO_FACE`, `MULTIPLE_FACES`, `CAMERA_BLOCKED`, `GAZE_AWAY`, `FACE_MISMATCH`, `PHONE_DETECTED`, `NOTES_DETECTED` |
| Screen frame | every 20 s | agent `screen_agent.py` (LLM optional) | AI chat or messaging on screen |
| Sandbox tabs | every navigation and typed query | `electron/browser-sandbox/tracker.ts`, agent `browsing_agent.py` | `AI_SITE_OPENED`, `AI_QUERY_DETECTED` (typed question), match against exam questions |
| Native guards | continuous | `electron/security/guards.ts`, `kiosk.ts` | `WINDOW_BLUR`, `SHORTCUT_BLOCKED`, `CLIPBOARD_USE`, `EXTERNAL_DEVICE`, `MULTI_MONITOR`, `SCREEN_MIRRORING`, `VM_DETECTED`, `REMOTE_DESKTOP`, `SCREEN_SHARE_STOPPED`, `BLACKLISTED_APP` |
| Microphone (per exam, opt-in) | continuous, on device | `src/lib/audio.ts` | `VOICE_DETECTED`, `MIC_BLOCKED`. Sound is never recorded or sent |
| Heartbeat | every 10 s | API `jobs.ts` | `NETWORK_LOST` after 30 s silent |
| Sign-in | on every login | API `auth.ts` | `MULTI_LOGIN` when a second device tries during a live session |
| Activity | every 30 s | `live.ts` | Keystroke timing and mouse summaries inside the exam window only. Raw keys are never stored |

Offline: answers, events and browsing logs are queued in an encrypted store (Windows DPAPI through `safeStorage`) and replayed in order when the connection returns.

## Flow 4: proctor monitors (desktop or web)

1. Paste the proctor link → password → **face verification + email OTP**.
   - There's no system check, consent or exam-window lock; proctors keep their normal desktop.
   - Until both checks pass, the API refuses every staff route for that sign-in (`proctorVerified` in `apps/api/src/lib/auth.ts`).
2. **Live monitor** (`MentorMonitor.tsx`): a grid of candidates with live webcam snapshots, risk badges and status, plus a live violation feed. A proctor signed in by link sees only the exam the link was for.
3. **Session drawer** (`SessionDrawer.tsx`): violation timeline, browsing and search log with AI sites and the typed query highlighted, **Watch screen** over WebRTC, warn and terminate.
4. **Review** (website `/proctor/sessions/[id]`): evidence gallery and **Confirm** or **Overrule** with a reason. Overruling the violation that ended a session reinstates the candidate if time remains.

## Violations and the policy engine

23 violation codes, each with a severity (LOW, MEDIUM, HIGH, CRITICAL), defined in `database/prisma/schema.prisma` and `apps/api/src/lib/domain.ts`.

`apps/api/src/lib/policy.ts` runs every event through four steps:

1. **Cooldown:** the same code within the cooldown window is logged but not counted again.
2. **Risk:** a weighted, decaying 0–100 risk score with a one-line explanation for every flag.
3. **Warn:** the first MEDIUM or HIGH events warn the candidate, up to the exam's maximum.
4. **Auto-submit:** the next HIGH or any CRITICAL ends the session and disqualifies.

All weights and thresholds are per exam. The server decides, and clients only apply the local rule while offline. Evidence (webcam or screen frame) is stored on the server and served only through 15-minute HMAC-signed URLs.

## Data model (main tables)

| Table | Holds |
| --- | --- |
| `User` | Admins and proctors: lockout counters, token version, proctor face photo |
| `Exam`, `Question` | The exam, its settings and policy, and its questions |
| `Candidate` | One enrollment per exam: User ID, password hash, email and face status |
| `Invite` | Join links: token hash, role, owner, bound device, used/revoked/expiry times |
| `DeviceBinding` | The computer a candidate first used |
| `ExamSession`, `Answer` | One attempt, its state, risk, warnings, score, and selected options |
| `Violation`, `Evidence`, `RiskPoint` | What happened, proof, and risk history |
| `BrowsingLog`, `ActivityLog` | Sandbox URLs and typed queries, and activity summaries |
| `OtpCode`, `AuditLog`, `EmailLog`, `Notification` | OTPs (hashed), staff actions, email delivery, admin notifications |

Full field list: [`database.md`](database.md).

## Security in one list

- **Passwords and lockout:** bcrypt cost 12, with a lockout after 5 failures.
- **Tokens:** JWTs carry a token version, so logout, a password reset, a new sign-in or revoking a link all revoke older tokens. Proctor tokens from a join link are limited to one exam.
- **Devices and sessions:** device binding per candidate and per link, and one active session per candidate.
- **Join links:** looked up by SHA-256 hash; the token is kept AES-256-GCM encrypted only so admins can copy it, and each copy is audited. They expire at exam end and can be revoked.
- **OTPs:** HMAC-hashed, with a 5-minute expiry.
- **Request handling:** zod on every input, Prisma only (no raw SQL with user input), and role guards (`staff`, `adminOnly`, `candidateOnly`) on every route.
- **HTTP hardening:** Helmet with a strict CSP, strict CORS, and per-route rate limits.
- **Logs:** an audit log for staff actions, and secrets redacted from logs.
- **Files:** evidence only through signed URLs, and retention cleanup of old evidence.
- **Electron:** a sandboxed renderer with context isolation and an IPC sender check. Sandbox tabs run in a separate in-memory session with no downloads or pop-ups.

## Honest limits (say these before judges ask)

- A desktop proctor cannot see a second phone held out of camera view, or a person whispering off-camera.
- Object detection works on a 320×320 copy of the frame, so a small or half-hidden phone is often missed.
- Face match and gaze are probabilistic. Thresholds are configurable in `backend-services/config.py`.
- Audio checks notice sustained talking, not who is talking, so a TV can trigger `VOICE_DETECTED`. It is MEDIUM and never auto-submits on its own.
- The old Exam ID + User ID sign-in still exists for the web lobby, the extension and tests. The desktop app no longer offers it.
- That's why signals are combined into an explainable risk score and a human reviews every penalty.

## Run it locally

```bash
npm install
npm start
```

| What | Where | Sign in |
| --- | --- | --- |
| Website | http://localhost:3000 | admin `admin@wue.in` / `Admin@123`, mentor `mentor@wue.in` / `Mentor@123` |
| API | http://localhost:4000/api/v1 | |
| AI agent | http://127.0.0.1:8000/health | |
| Desktop app | opens as a window | Dev panel (Ctrl+Shift+D) → **Candidate link** or **Proctor link** copies a fresh join link and shows its password (`Demo@2026` / `Mentor@123`) |

Outside production the one-time code also shows on the identity-check screen (and in the extension), even when it is emailed. **Developer mode** (`npm start`, without `PROCTOR_STRICT=1`) has no native restrictions, so the full flow runs on a dev machine:
- no exam-window lock, blocked shortcuts, focus-loss lock or content protection
- no process, display, USB or clipboard guards
- system-check failures are shown but never block Continue
- coding assistants (`claude`, `codex`, `cursor`, `copilot`, `windsurf`) are left out of the app list

The AI webcam checks, browsing logs and dev-panel violation injection still work for demos. The installed app and `PROCTOR_STRICT=1` keep every restriction.

The desktop app opens full screen. In developer mode the password step has **Copy** and **Fill** buttons for the pasted link's test password, and the dev panel keeps the last generated link and password with copy buttons. The website's dev toolbar has no on-screen button; open it with Ctrl+Shift+D. Without SMTP, every email (with its join link) is in the website dev toolbar's outbox.

## Two-laptop live test (no deployment)

Your laptop is the server; a friend takes the exam on their own laptop. The default seed is real data only: the organization login (`admin@wue.in` / `Admin@123`, or `ORG_ADMIN_EMAIL` / `ORG_ADMIN_PASSWORD` in `.env`) and one exam, **LIVE-01**, with 20 real questions, open for 30 days.

LIVE-01 has these exam settings on, and organizations can turn them on for any exam under Settings:

- **Proctor-only alerts:** the candidate sees no warnings and the exam is never ended automatically. Every violation goes to the proctor with its reason and evidence.
- **One-way questions:** no going back after Next.
- **Same order for everyone:** shuffle is off.
- **Live microphone:** proctors watching the screen can also listen, and the consent screen says so.

1. On your laptop: `node scripts/start.mjs --reseed` (the first time; afterwards `npm start`). For a friend on the same Wi-Fi use `npm run start:lan` instead: join links in emails then use your Wi-Fi address (for example `http://172.16.x.x:3000/join/…`), so they open on the friend's laptop.
2. Give your friend the installer from `apps/desktop/release` (build it with `npm run build -w apps/desktop`).
3. Connect:
   - **Same Wi-Fi:** with `npm run start:lan`, pasting the emailed link into the app connects to your laptop by itself. Otherwise `npm run share` prints your laptop's address; on the friend's laptop press **Change** next to *Exam server* on the sign-in screen and type it. Windows asks once to allow Node.js through the firewall: allow it for private networks.
   - **Over the internet:** install cloudflared once (`winget install --id Cloudflare.cloudflared`), then `npm run share:tunnel`, and give your friend the printed `https://….trycloudflare.com` address.
4. Website, Organization panel > LIVE-01 > Credentials:
   - add your friend as a candidate and send the email; the join link and password are also under **Reveal & copy**
   - invite yourself under **Proctors**
   - every time a candidate's link is sent, the organization (the exam's creator) and every proctor invited to the exam get a copy with the same link and password
   - real emails: set `SMTP_USER` (your Gmail address) and `SMTP_PASS` (a Gmail app password from Google Account > Security > App passwords) in `.env`, keep `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=587`, and restart. Leave `MAIL_FROM` blank to send from `SMTP_USER` (Gmail rejects an unverified From address). Without SMTP, emails go to the dev outbox (Ctrl+Shift+D on the website); in production (`NODE_ENV=production`) they fail instead and show as FAILED in the email log.
5. Your friend pastes the link, enters the password, and passes the system check, face and OTP, then consent.
6. You open the Proctor console on the website or desktop and pick the session. You see:
   - his webcam about once a second
   - **Watch screen** to see his screen live, then **Listen** to hear him
   - every site and AI tool he opens and the text he types or pastes, the moment it happens
   - each violation with its evidence

The webcam is checked every second. A phone or a second person is flagged on the first frame it appears in, and looking away or leaving the camera after 2 seconds. Thresholds are in `backend-services/config.py`.

`npm run smoke` needs the demo dataset: `npm run db:seed:demo` first.
