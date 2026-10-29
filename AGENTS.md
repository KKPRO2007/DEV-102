# AGENTS.md

How AI agents work in this repo. Every agent reads this file first.

## Project in one paragraph

Where U Elevate Smart Proctor (hackathon DEV_102). Monorepo:

| Path | What |
| --- | --- |
| `apps/api` | Express 5 + Socket.IO + Prisma API, mounted at `/api/v1`. Response envelope `{ ok, data }` / `{ ok:false, error:{ code, message } }` |
| `apps/web` | Next.js 15 website: landing, `/login`, `/lobby` (candidate), `/organization/*`, `/proctor/*` (old `/admin` and `/mentor` paths redirect). All data goes through `src/lib/api.ts` |
| `apps/desktop` | Electron 35 secure exam app. Renderer `src/`, native layer `electron/`, API client `src/lib/api.ts`, live channels `src/lib/live.ts` |
| `backend-services` | FastAPI AI agent (OpenCV YuNet/SFace, MediaPipe). Called only by the API with `X-Agent-Key` |
| `database/prisma` | `schema.prisma`, `seed.ts`, `seed-data.ts`, `faces/` (test portraits) |
| `scripts` | `start.mjs` (runs everything), `db.mjs` (embedded Postgres), `smoke.mjs` (end-to-end API test), `python.cjs`, `fetch-faces.mjs` |

## Roles

| Agent | Does | Does NOT |
|---|---|---|
| **Antigravity** (Google) | Writes features and fixes on its own branch | Push to `main`, merge PRs |
| **GitHub Copilot** | Writes code, inline completions, small fixes, tests | Push to `main`, merge PRs |
| **Claude Code** | Reviews, verifies, and merges PRs or recommends changes | Write big features (it can make small fixes during review) |
| **Human (owner)** | Has the final say, can override any verdict | — |

## Workflow

1. **Branch**: `agent/<tool>/<short-desc>`, e.g. `agent/antigravity/login-page`, `agent/copilot/fix-null-check`.
2. **Code**: keep each PR small (aim for < 300 changed lines) with one purpose.
3. **Open a PR** with this description:
   ```
   What: <one line>
   Why: <one line>
   How tested: <commands run / manual steps>
   Risk: low | medium | high
   ```
4. **Review**: Claude Code runs the checklist below.
5. **Verdict**: Claude posts one of these:
   - `APPROVE & MERGE`: checks pass and the code is correct, so Claude squash-merges.
   - `REQUEST CHANGES`: a bug or failing check was found. Claude lists the issues and the coding agent fixes them on the same branch.
   - `RECOMMEND`: the code works but has a design or scope concern. Claude does not merge, and the owner decides.
6. Delete the branch after the merge.

## Coding rules (Antigravity + Copilot)

- Follow the existing style, naming, and folder structure.
- Keep diffs small. Don't refactor or reformat unrelated code.
- Never commit secrets, `.env` files, API keys, or tokens.
- Add or update tests for any logic you change.
- Don't add a dependency unless it's needed, and say why in the PR.
- Run the build, lint, and tests before you open the PR.

## Review checklist (Claude Code)

- [ ] Build passes
- [ ] Lint passes
- [ ] Tests pass, and new logic has tests
- [ ] The change matches its PR description, with nothing extra
- [ ] No secrets, debug logs, or commented-out code
- [ ] No obvious security issues (injection, unsafe input, exposed data)
- [ ] Edge cases handled (null/empty, errors, async failures)
- [ ] No breaking changes to public APIs unless they're stated

## Merge policy

- Squash merge only, using the PR title as the commit message.
- Merge only when every checklist item passes.
- Anything with `Risk: high` gets `RECOMMEND` and goes to the owner.

## Token-saving rules (all agents)

- Review the **diff** (`git diff main...HEAD`), not the whole repo.
- Open only the files the change touches, plus their direct callers.
- Don't paste large files or logs back into chat. Quote the relevant lines.
- Keep review comments short: `file:line: problem → fix`.
- Don't re-explain context that's already in this file or the PR.

## Commands

This is an npm workspaces monorepo (`apps/api`, `apps/web`, `apps/desktop`) that needs Node >= 22.12.

```bash
npm install            # install all workspaces
npm run db:generate    # generate the Prisma client (run after schema changes)
npm run typecheck      # must pass before a merge
npm run lint           # must pass before a merge (ESLint in apps/api, apps/web, apps/desktop)
npm test               # must pass before a merge (Vitest unit tests in apps/api/test and apps/desktop/test)
npm run test:agent     # must pass before a merge (pytest for backend-services)
npm run build          # must pass before a merge
npm run smoke          # smoke test
npm start              # run everything locally
```

The Prisma schema is `database/prisma/schema.prisma`. Any schema change needs a migration (`npm run db:migrate`) and gets `Risk: medium` or higher.

## Run and verify

- **Node 22 or newer is required.** On Node 20, Next.js pages hang. Python 3.11+.
- `npm install`, then `npm start` (database, API :4000, agent :8000, web :3000, desktop window).
- Demo logins: admin `admin@wue.in` / `Admin@123`, mentor `mentor@wue.in` / `Mentor@123`, candidate exam `CPA-26`, user `WUE26DEMO`, password `Demo@2026`.
- The dev toolbar (Ctrl+Shift+D) on web and desktop opens any page or screen, signs in any role, injects violations and reseeds.

The smoke test needs `npm start` running. UI tasks also need a check in a real browser (or the Electron window) with no console errors.

## Hard rules

1. **No mock data, fake timers or simulated results.** Everything uses the real API. If the backend lacks something, add the endpoint in `apps/api` (route → zod validation → Prisma) and call it from the client.
2. **Do not change the existing API response shapes or names**. Add fields, never rename or remove them.
3. Security stays intact: zod on every input, role guards (`staff`, `adminOnly`, `candidateOnly`), no raw SQL with user input, no secrets in logs or code, evidence and photos only through signed URLs.
4. TypeScript strict, no `any`. Python with type hints. Match the surrounding style. Add comments only where the logic is not obvious.
5. Keep files few and focused. Do not add new top-level folders. Delete code you make obsolete.
6. Never commit `.env`, `.data/`, `.venv/`, `backend-services/models/`, build output (`out/`, `.next/`, `release/`).
7. Work on your own branch named as in **Workflow** (`agent/<tool>/<short-desc>`; add the task ID when there is one, e.g. `agent/codex/T2-scoring-tests`). Small commits. End each commit message with your agent name. Do not push to `main`.
8. If a task needs a decision not covered here, stop and write the question in your final message. Do not guess.

## Task board

Each task lists its owner, what to change, and what "done" means. Take one task at a time.

### T1: Server Excel/PDF exports on the web reports page · Codex
- `apps/web/src/app/(admin)/admin/exams/[id]/reports/page.tsx` builds Excel and PDF in the browser with `xlsx` and `jspdf`. Switch both buttons to the server: use `download()` from `src/lib/http.ts` with `/reports/exams/:id/results.xlsx`. For PDF, add a per-row "PDF" action calling `/reports/sessions/:sessionId/report.pdf` (rows already carry `sessionId`).
- Remove `xlsx`, `jspdf` and `jspdf-autotable` from `apps/web/package.json` if nothing else imports them.
- Done: both downloads open a real file in the browser, and typecheck passes.

### T2: Unit tests for the policy engine and scoring · Codex
- Add Vitest to `apps/api` and test `scoreAnswers` in `src/lib/domain.ts` (exact match, wrong answer with negative marking, unanswered). Test the escalation in `src/lib/policy.ts` (cooldown suppression, warn up to max, auto-submit on CRITICAL, reinstate after overrule) against a test database. Add an `npm test` script.
- Add `pytest` tests for `backend-services/agents/browsing_agent.best_match` and `risk_agent.RiskState`.
- Done: `npm test -w apps/api` and `pytest backend-services` pass.

### T3: Live webcam snapshots in mentor views · Codex
- The API already emits `frame:snapshot` `{ sessionId, image, at }` on the `/monitor` socket (rooms `exam:{id}`). On the web, show the latest snapshot in place of the avatar on `/mentor/sessions/[id]`, and join the room with `joinExam()` from `src/lib/realtime.ts`.
- In the desktop mentor monitor (`screens/MentorMonitor.tsx` and `components/StudentTile.tsx`), replace polling with a socket subscription (add a small socket client in `src/lib/live.ts`) and show the live snapshot over `photoUrl`.
- Done: start an exam in the desktop app as `WUE26DEMO`, and the mentor sees the webcam image refresh every few seconds.

### T4: Live screen view over WebRTC · Codex
- The API relays `rtc:offer`, `rtc:answer` and `rtc:ice` between a session's candidate and staff (`apps/api/src/lib/realtime.ts`). On the candidate side (`apps/desktop/src/lib/live.ts`), answer offers with the entire-screen stream from `getScreenStream()`. On the mentor side, add a "Watch screen" button in the desktop `SessionDrawer.tsx` and on the web `/mentor/sessions/[id]` page, then create the offer and render the stream. Use STUN `stun:stun.l.google.com:19302`.
- Done: a mentor watches the candidate's screen live; closing the drawer or page stops the connection.

### T5: End-to-end desktop pass with a real webcam · Antigravity
- Run `npm start`. In the Electron window, go through login → system check → face verification (webcam) → OTP (the code shows in the dev toast) → consent → exam: answer questions, open a sandbox tab, visit chatgpt.com and type a question → submitted.
- Fix every bug you hit in `apps/desktop` (and in the API if the cause is there). Record each bug and fix in your final message.
- Done: the full flow completes. A mentor at `/mentor` sees the AI-site and AI-query violations with the typed query in the browsing log.

### T6: UI polish pass on the website · Antigravity
- Go through every page in the dev toolbar's Pages tab at desktop and phone width (375 px). Fix contrast, overflow, broken layout and empty states. Keep the Where U Elevate look: blue `#0A4DA6`/`#1E6FF0` gradients, amber CTA `#FFB020`, Poppins headings.
- Add tasteful motion and illustration where pages feel flat (admin exam overview, credentials and question bank). Use only existing deps (framer-motion, lucide-react, recharts). Images go in `apps/web/public/images`.
- Done: before and after screenshots of each page, no console errors, typecheck passes.

### T7: Browser extension (bonus requirement) · Gemini Pro
- New folder `apps/extension`: a Manifest V3 Chrome extension for exams taken in a normal browser. It signs in with exam code, user ID and password via `POST /api/v1/auth/login` with `channel:"web"`. It then reports tab switches and visited URLs to `/proctoring/browsing-logs`, captures text typed into AI sites (same idea as `apps/desktop/electron/browser-sandbox/tracker.ts`), and sends `WINDOW_BLUR` events.
- The API currently starts sessions only from the desktop. Add a `channel:"extension"` path in `apps/api/src/modules/sessions.ts` only if needed, keeping the face and OTP requirements.
- Done: load the extension unpacked, sign in as the demo candidate, and see logs and violations reach the mentor views.

### T8: Production readiness · Gemini Pro
- Create the first Prisma migration (`npm run db:migrate -- --name init`) and switch `scripts/start.mjs` from `db push` to `migrate deploy`.
- Add Dockerfiles for `apps/api` and `backend-services`, plus a `render.yaml` (API, agent, Postgres) and Vercel settings for `apps/web`. Document each step in `docs/deploy.md`.
- Build the Windows installer (`npm run build -w apps/desktop`) and check that `/download` serves it.
- Done: a fresh clone deploys by following `docs/deploy.md`.

### T9: Review gate · Claude (lead)
- When a task branch is pushed, post its branch name and a short summary. The lead reviews the diff and merges, or returns precise fixes.
