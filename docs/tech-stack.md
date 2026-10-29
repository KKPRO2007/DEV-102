# Tech stack

Everything the project uses, taken from each workspace's `package.json`, `backend-services/requirements.txt` and the model files the agent downloads. Versions are the ranges in the manifests at the time of writing.

## At a glance

| Area | Technology | What it does |
| --- | --- | --- |
| Website | Next.js 15, React 19, TypeScript, Tailwind CSS 4 | Public site, admin console, mentor console, candidate lobby, `/join` page for emailed links |
| Desktop app | Electron 35, React 19, electron-vite (Vite 6), TypeScript | Secure exam window for candidates, live monitor for proctors, native guards (camera, screen, displays, USB, VM) |
| Browser extension (bonus) | Chrome Manifest V3, TypeScript | Exam companion for a normal browser: reports tab switches, visited URLs, AI-site queries and focus loss |
| API | Node.js 22, Express 5, TypeScript, Prisma | REST API under `/api/v1`: auth, join links, exams, sessions, policy engine, reports |
| Realtime | Socket.IO 4, WebRTC | Live session status, violations, webcam snapshots, and screen viewing between candidate and proctor |
| AI agent | Python 3.11+, FastAPI, OpenCV, MediaPipe | Face count, identity match, head pose, gaze, phone and notes detection, browsing classification, risk score |
| Database | PostgreSQL 16+, Prisma ORM 6 | Users, exams, candidates, join links, sessions, answers, violations, evidence, logs |
| Validation and state | Zod, React Hook Form, Zustand | Input validation on every API route and form, client app state |
| Reports and charts | ExcelJS, PDFKit, Recharts | Excel results, per-session PDF reports, dashboard charts |
| Security and operations | bcryptjs, jsonwebtoken, Helmet, express-rate-limit, Pino | Password hashing, signed tokens, security headers, rate limits, structured logs |
| Tooling | npm workspaces, Vitest, pytest, ESLint, TypeScript strict | Monorepo, unit tests, lint, type checks |

## Runtime requirements

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22.12 or newer (`engines` in root `package.json`) | Website, API, desktop app. Next.js 15 pages hang on Node 20 |
| Python | 3.11 or 3.12 | AI agent (MediaPipe has no 3.13 wheels yet) |
| PostgreSQL | 16+ | Bundled locally through `embedded-postgres`; Neon or Supabase in production |
| Windows | 10 or 11 | The desktop exam app and its installer target Windows |

No Docker is needed for local development. `npm start` runs everything.

## Root workspace (`package.json`)

| Package | Version | Purpose |
| --- | --- | --- |
| `concurrently` | ^9.2.1 | Runs the API, agent, website and desktop app together in `npm start` |
| `electron` | 35.1.2 | Pinned Electron runtime shared by the desktop workspace |
| `embedded-postgres` | ^17.5.0-beta.15 | Real PostgreSQL server started from `node_modules` (data in `.data/pg`) |

## API (`apps/api`)

**Dependencies**

| Package | Version | Purpose |
| --- | --- | --- |
| `express` | ^5.1.0 | HTTP server and routing |
| `@prisma/client` | ^6.5.0 | Type-safe database access (no raw SQL with user input) |
| `zod` | ^3.24.2 | Validates every request body, query and parameter |
| `socket.io` | ^4.8.1 | `/monitor` namespace: live status, violations, snapshots, WebRTC signalling relay |
| `jsonwebtoken` | ^9.0.2 | HS256 tokens carrying role, token version, and exam scope for proctors |
| `bcryptjs` | ^3.0.2 | Password hashing (cost 12) |
| `helmet` | ^8.1.0 | Security headers and strict content security policy |
| `cors` | ^2.8.5 | Allow-list of the website, desktop and extension origins |
| `express-rate-limit` | ^7.5.0 | Per-route limits on sign-in, OTP, frames and ingest |
| `nodemailer` | ^6.10.0 | Credential, join-link, OTP and result emails (dev outbox without SMTP) |
| `exceljs` | ^4.4.0 | `results.xlsx` per exam |
| `pdfkit` | ^0.16.0 | Per-session PDF report with evidence and browsing log |
| `csv-parse` | ^5.6.0 | Question and candidate CSV import |
| `multer` | ^1.4.5-lts.2 | Multipart uploads (import files) |
| `axios` | ^1.8.4 | HTTP calls from the API to the AI agent |
| `pino` | ^9.6.0 | Structured JSON logs with secret redaction |
| `dotenv` | ^16.5.0 | Loads `.env` (validated with zod at start-up) |

**Dev dependencies:** `prisma` ^6.5.0 (schema, migrations, client generation), `tsx` ^4.19.3 (runs and watches TypeScript), `typescript` ^5.8.2, `vitest` ^3.2.7, `eslint` ^9.39.5, `@eslint/js`, `typescript-eslint` ^8.72.1, `globals`, and type packages `@types/express`, `@types/node`, `@types/bcryptjs`, `@types/cors`, `@types/jsonwebtoken`, `@types/multer`, `@types/nodemailer`, `@types/pdfkit`.

## Desktop app (`apps/desktop`)

**Dependencies**

| Package | Version | Purpose |
| --- | --- | --- |
| `react`, `react-dom` | ^19.0.0 | Renderer UI |
| `zustand` | ^5.0.3 | App shell state (current screen, signed-in user, toasts, lock overlay) |
| `react-hook-form` | ^7.55.0 | Forms |
| `@hookform/resolvers` | ^4.1.0 | Connects zod schemas to forms |
| `zod` | ^3.24.2 | Client-side validation |
| `framer-motion` | ^12.6.3 | Screen transitions and motion |
| `lucide-react` | ^0.511.0 | Icons |
| `socket.io-client` | ^4.8.1 | Live channel to the API (warnings, kicks, mentor monitor) |
| `@vladmandic/face-api` | ^1.7.15 | On-device face landmarks for the face-guide overlay |
| `systeminformation` | ^5.27.11 | Hardware, display, process and VM checks in the system check |

**Dev dependencies:** `electron` 35.1.2, `electron-vite` ^3.1.0, `vite` ^6.2.2, `@vitejs/plugin-react` ^4.3.4, `electron-builder` ^26.0.12 (Windows NSIS installer), `tailwindcss` ^4.0.12, `@tailwindcss/vite` ^4.3.3, `postcss` ^8.5.3, `typescript` ^5.8.2, `vitest` ^3.2.7, `eslint` ^9.39.5, `eslint-plugin-react-hooks` ^5.2.0, `typescript-eslint`, `@eslint/js`, `globals`, `@types/react`, `@types/react-dom`, `@types/node`.

**Electron and browser APIs used:** `BrowserWindow` locked full screen, always on top, with content protection, `webview` sandbox tabs in an isolated in-memory session, `safeStorage` (Windows DPAPI) for the encrypted offline queue, `desktopCapturer` / `getDisplayMedia` for the entire-screen share, `getUserMedia` for webcam and microphone, Web Audio for on-device voice detection, `RTCPeerConnection` for live screen viewing (STUN `stun.l.google.com:19302`).

## Website (`apps/web`)

**Dependencies**

| Package | Version | Purpose |
| --- | --- | --- |
| `next` | ^15.2.3 | App Router site: marketing, admin, mentor and lobby route groups |
| `react`, `react-dom` | ^19.0.0 | UI |
| `zustand` | ^5.0.3 | Session and UI state |
| `react-hook-form`, `@hookform/resolvers` | ^7.55.0, ^4.1.0 | Exam wizard and other forms |
| `zod` | ^3.24.2 | Form and response validation |
| `recharts` | ^2.15.1 | Dashboard and report charts |
| `three` | ^0.186.1 | 3D engine for the home page hero |
| `@react-three/fiber` | ^9.8.2 | React renderer for three.js |
| `@react-three/drei` | ^10.7.9 | Helpers for the hero: rounded boxes, instanced keys, light panels, sparkles, contact shadows |
| `framer-motion` | ^12.6.3 | Motion |
| `lucide-react` | ^0.511.0 | Icons |
| `socket.io-client` | ^4.8.1 | Live mentor views |
| `papaparse` | ^5.5.3 | CSV parsing in the question and candidate importers |
| `xlsx` | ^0.18.5 | Reads Excel files in the importers |

**Dev dependencies:** `@types/three` ^0.186.0, `tailwindcss` ^4.0.12, `@tailwindcss/postcss` ^4.0.12, `postcss` ^8.5.3, `typescript` ^5.8.2, `eslint` ^9.22.0, `eslint-config-next` ^15.2.3, `@eslint/eslintrc`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/papaparse`.

Fonts: Poppins (headings) and the brand colours `#0A4DA6`, `#1E6FF0` and amber `#FFB020`.

The home page hero is a 3D scene built entirely in code: an aluminium laptop whose screen is the live exam UI, drawn on a canvas texture, plus an orbiting glass shield with an eye, scan rings and particles. three.js loads only in the browser, only on the home page, and only when WebGL is available; otherwise the flat animated card is shown. Reflections come from in-code light panels, so no environment map is downloaded.

## Browser extension (`apps/extension`)

Chrome Manifest V3 written in TypeScript and bundled by `build.mjs`. Only dev dependency: `@types/chrome` ^0.0.287. Permissions: `tabs` and `storage`, plus host access to the API. A background service worker tracks tab switches and URLs, and a content script on AI sites (ChatGPT and others) captures the text typed into them.

## AI agent (`backend-services`)

**Python packages** (`requirements.txt`)

| Package | Version | Purpose |
| --- | --- | --- |
| `fastapi` | >=0.115,<1 | HTTP service called only by the API, guarded by `X-Agent-Key` |
| `uvicorn[standard]` | >=0.30,<1 | ASGI server |
| `pydantic` | >=2.10,<3 | Request and response schemas |
| `python-dotenv` | >=1.0,<2 | Settings from `.env` |
| `httpx` | >=0.28,<1 | Optional LLM calls (screen classification) |
| `numpy` | >=1.26,<3 | Image arrays and maths |
| `opencv-python` | >=4.10,<5 | Image decoding, YuNet face detection, SFace face recognition |
| `mediapipe` | >=0.10.14,<0.11 | Face Landmarker (head pose and iris gaze), object detector (phones, books) |
| `pytest` | >=8.3,<9 | Tests (`requirements-dev.txt`) |

**Pretrained models** (downloaded on first run into `backend-services/models/`, not committed)

| Model | Source | Used for |
| --- | --- | --- |
| YuNet `face_detection_yunet_2023mar.onnx` | OpenCV Zoo | Counting faces, covered camera |
| SFace `face_recognition_sface_2021dec.onnx` | OpenCV Zoo | Matching the live face to the registered photo |
| MediaPipe Face Landmarker (float16) | Google MediaPipe | Head pose and iris gaze, sustained look-away |
| MediaPipe EfficientDet-Lite0 (float16, Apache-2.0) | Google MediaPipe | `PHONE_DETECTED` and `NOTES_DETECTED` |

**Optional LLM:** `llm.py` talks to Anthropic's Messages API or any OpenAI-compatible endpoint (`LLM_BASE_URL`) to classify screen frames. It is turned off unless `LLM_API_KEY` is set, and every other check works without it.

## Database (`database/prisma`)

PostgreSQL through Prisma 6. Models: `User`, `Exam`, `Question`, `Candidate`, `Invite`, `DeviceBinding`, `ExamSession`, `Answer`, `Violation`, `Evidence`, `BrowsingLog`, `ActivityLog`, `RiskPoint`, `WarningMessage`, `OtpCode`, `AuditLog`, `EmailLog`, `Notification`. Migrations live in `database/prisma/migrations`. Test portraits for the seed come from randomuser.me (free portraits published for testing).

## Declared but not imported

These packages are in a `package.json` but no source file imports them. They add install size without doing anything, so they can be removed (or put to use) in a follow-up PR:

| Workspace | Packages |
| --- | --- |
| `apps/desktop` | `axios`, `electron-store`, `electron-updater` |
| `apps/web` | `axios`, `clsx`, `tailwind-merge` |

All HTTP calls use the built-in `fetch` through each app's `src/lib/http.ts`.

## Deployment

| Piece | Where | File |
| --- | --- | --- |
| API and AI agent | Render (Docker) | `apps/api/Dockerfile`, `backend-services/Dockerfile`, `render.yaml` |
| PostgreSQL | Render, Neon or Supabase | `render.yaml`, `DATABASE_URL` |
| Website | Vercel | `apps/web/vercel.json` |
| Desktop installer | electron-builder NSIS, served from `/download` | `npm run build -w apps/desktop` |

Step-by-step instructions: [`deploy.md`](deploy.md).
