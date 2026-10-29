# Architecture

```
 Desktop app (Electron)                 Website (Next.js)
 ├─ renderer: exam UI, sandbox tabs     ├─ organization + proctor consoles
 ├─ preload: window.proctor bridge      └─ candidate lobby, landing pages
 └─ main: lock, guards, webview policy          │ REST + Socket.IO /monitor
            │ REST + Socket.IO                    │
            └──────────────► API (Express) ◄──────┘
                             ├─ policy engine, session sweeper, retention job
                             ├─ evidence store (.data/evidence, HMAC URLs)
                             ├─ PostgreSQL (Prisma)
                             └─► AI agent (FastAPI, X-Agent-Key)
```

## Responsibilities

| Area | Location | Notes |
| --- | --- | --- |
| API entry, middleware | `apps/api/src/main.ts`, `lib/security.ts`, `lib/auth.ts`, `lib/core.ts` | `/api/v1`, envelope `{ ok, data }` / `{ ok:false, error }` |
| Domain shapes | `apps/api/src/lib/domain.ts` | Prisma rows → UI types, violation catalogue, AI domain list, scoring |
| Policy engine | `apps/api/src/lib/policy.ts` | cooldown → risk → warn → auto-submit; finalise; reinstate |
| Realtime | `apps/api/src/lib/realtime.ts` | `/monitor` namespace, rooms `staff`, `exam:{id}`, `session:{id}`, WebRTC relay |
| Jobs | `apps/api/src/lib/jobs.ts` | auto-submit at deadline (5 s sweep), NETWORK_LOST after 30 s without heartbeat, retention |
| Modules | `apps/api/src/modules/*` | auth, exams+questions, candidates, sessions, proctoring, mentor, admin, reports, dev |
| Agent | `backend-services/` | `vision.py` (YuNet, SFace, Face Landmarker), `agents/*` (face, screen, browsing, risk, orchestrator) |
| Native layer | `apps/desktop/electron/` | `security/kiosk.ts`, `security/guards.ts`, `browser-sandbox/*`, `secure-store.ts`, `ipc.ts` |
| Desktop client | `apps/desktop/src/lib/` | `http.ts`, `api.ts` (real or mock), `live.ts` (socket, heartbeat, frames, activity, offline queue) |
| Web client | `apps/web/src/lib/` | `http.ts`, `realtime.ts`, adapters `api.ts`, `adminApi.ts`, `examApi.ts`, `mentorApi.ts` |

Each client adapter keeps a mock branch (`NEXT_PUBLIC_USE_MOCK` / `VITE_USE_MOCK`) so the UI can still run without the backend.

## Exam session sequence

1. `POST /auth/login` with exam code, user ID, password and device fingerprint. The device is bound on first use; a second device during a live session records `MULTI_LOGIN` and is refused.
2. `POST /auth/face/verify`: the agent counts faces, checks basic liveness and compares against the registered photo (the first capture registers it).
3. `POST /auth/otp/send` and `/auth/otp/verify`.
4. `POST /sessions/start {consent:true}`: requires OTP and face verification within 45 minutes and an open exam window. Returns the paper without answers, in a per-session shuffled order, with the server deadline.
5. During the exam: `PUT /sessions/:id/answers` (debounced), `POST /sessions/:id/heartbeat` (10 s), `POST /proctoring/frames` (4 s), `/proctoring/screen` (20 s), `/proctoring/events`, `/proctoring/browsing-logs`, `/proctoring/activity` (30 s).
6. Every event runs through the policy engine. Outcomes are pushed to the candidate (`proctor:warning`, `session:submitted`) and to mentors (`violation:new`, `session:status`).
7. `POST /sessions/:id/submit`, or the server ends the session (deadline, policy, mentor). Scoring applies negative marking per exam settings.

## Security model

- Staff and candidates get short-lived JWTs that carry a token version, so logout, password reset and re-login revoke older tokens.
- The renderer is sandboxed with context isolation. IPC handlers accept calls only from the exam window's own top frame, and every argument is validated.
- Sandbox tabs run in a separate in-memory session with no permissions, downloads or pop-ups. Top-level navigation is limited to allowed sites, search engines and (tracked) AI sites.
- Evidence files are served only through expiring HMAC-signed URLs.
- `/dev/*` routes exist only outside production; the API refuses to start in production with default secrets.

## Honest limits

Detection is probabilistic and a desktop app cannot see off-camera devices. Signals are combined into an explainable risk score, and a human reviews and can overrule every penalty.
