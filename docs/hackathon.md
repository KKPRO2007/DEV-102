# Hackathon brief: DEV_102 Smart Proctor

Team **TECH KNIGHTS** · DEVIATHON 2.0, GLA University, Mathura · Problem statement **DEV_102** by WUElev8 (Where U Elevate): *Build a Smart Proctoring Browser for Assessment*.

| Member |
| --- |
| Mallavarapu Krishna Koushik Reddy |
| Amritansh Rai |
| Dhruv Gupta |
| Rishu Kumari |

This file covers how we are judged, how our build answers each criterion, the evidence we can show, and what the rules require us to disclose. The slide and demo script is in [`presentation.md`](presentation.md), and the system explanation is in [`project-guide.md`](project-guide.md).

## 1. How we are judged

| Round | Name | Format | Elimination |
| --- | --- | --- | --- |
| 1 | PS Fit & Innovation Screening | 5 min presentation + 3 min Q&A | Yes |
| 2 | Prototype & Technical Validation | 6 min demo + 4 min technical inspection + 3 min Q&A | Yes, recommended cut-off **65/100** |
| 3 | Grand Finale: Live Demo & Jury Defense | 7 min presentation/demo + 5 min jury Q&A | Winners ranked on **Round 3 only** |

Tie-break order: (1) PS fulfilment, (2) technical implementation, (3) prototype functionality. Judges can question **any** member, so everyone must be able to explain the whole system and their own part.

### Rules we must follow

- Solve the assigned PS and say clearly which requirements we cover (section 3).
- Open-source libraries, pretrained models, APIs and AI coding assistants are allowed, but **significant third-party components and AI-assisted work must be disclosed** (section 6).
- Never claim third-party work as ours, fabricate test results or misrepresent what the prototype does. Only claim what the demo shows.
- The demo must be the real implementation. A recording is allowed **only as a labelled backup** if there is an outage.
- Respect time limits, data privacy and licences. No real personal data in the demo: we use seeded demo accounts and randomuser.me test portraits.

## 2. Rubric mapped to our evidence

### Round 1: PS Fit & Innovation (100)

| Criterion | Marks | What we show |
| --- | --- | --- |
| Problem understanding and PS alignment | 25 | All six objectives, plus every "key feature" and the bonus, mapped to working code (section 3) |
| Innovation and originality | 20 | Typed-query tracking on AI sites, explainable risk score, human-overrulable penalties, emailed one-device join links, proctor identity checks, on-device audio analysis |
| Solution approach and architecture | 20 | Four-part architecture: website, desktop kiosk, API with policy engine, Python AI agent ([`project-guide.md`](project-guide.md)) |
| Technical feasibility | 15 | It already runs end to end on one laptop with `npm start`; deploy files for Render and Vercel exist |
| User needs and potential impact | 10 | Organizations get fair remote exams without a human per candidate; candidates get a consent-first, privacy-aware app |
| Research and preparation quality | 10 | Comparison with browser-only proctors (section 5), honest limits, model choices (YuNet, SFace, MediaPipe) |

### Round 2: Prototype & Technical Validation (100)

| Criterion | Marks | What we show |
| --- | --- | --- |
| Working prototype and functionality | 25 | Live: org invites → paste link → checks → exam with violations → proctor sees it live → overrule |
| Technical implementation and engineering | 20 | TypeScript strict in 4 workspaces, zod on every input, Prisma migrations, policy engine, WebRTC, native Electron guards |
| PS compliance and solution effectiveness | 20 | Section 3 table, with each row pointing to a file |
| Testing, validation and reliability | 15 | 120 Vitest + 32 pytest + 46-check end-to-end smoke test, all passing (section 4) |
| Innovation demonstrated in implementation | 10 | Search log with typed AI queries, risk explanations, reinstatement on overrule, join-link device lock |
| Team ownership and technical understanding | 10 | Each member owns and explains one area (section 7) |

### Round 3: Grand Finale (100)

| Criterion | Marks | What we show |
| --- | --- | --- |
| Solution effectiveness and PS fulfilment | 25 | Full flow on the real app with every PS objective visible |
| Technical excellence and reliability | 20 | Test results, offline queue, server-authoritative policy, signed evidence URLs |
| Innovation and differentiation | 15 | Section 5 comparison |
| Real-world impact and user value | 15 | Scales from one classroom to many exams; human review keeps it fair |
| Scalability, feasibility and sustainability | 10 | Stateless API, hosted Postgres, throttled frames (4 s webcam, 20 s screen), Docker + Render + Vercel |
| Live demonstration and usability | 10 | Clean, timed demo (see [`presentation.md`](presentation.md)) |
| Presentation and jury defense | 5 | Q&A prep in [`presentation.md`](presentation.md) |

## 3. PS requirements and where they live

| # | Requirement | Status | Where |
| --- | --- | --- | --- |
| 1 | Webcam capture, eye tracking, unusual behaviour | Done | Agent `backend-services/agents/face_agent.py`, `vision.py` (YuNet, SFace, Face Landmarker gaze/head pose, EfficientDet phones/notes); desktop `src/lib/live.ts` sends a frame every 4 s |
| 2 | MCQ tests with a backend that stores questions | Done (PostgreSQL instead of Airtable) | API `modules/exams.ts`, `sessions.ts`; single, multiple and numeric questions; CSV/Excel import |
| 3 | Block multiple logins, screen mirroring, external devices | Done | API device binding + one live session + join link locked to one computer; `electron/security/guards.ts` (displays, mirroring, USB, VM, remote desktop, 60+ blacklisted apps) |
| 4 | Face recognition or OTP before access | Done: **both** | `POST /auth/face/verify` + email OTP for candidates **and** proctors; the session cannot start without both |
| 5 | Simple, distraction-free, responsive UI | Done | Desktop kiosk exam UI; responsive website layouts (check every page at 375 px before the demo) |
| 6 | Allow tab switching but track searches (ChatGPT/Claude + what was typed) | Done | `electron/browser-sandbox/tracker.ts`, agent `browsing_agent.py`; mentors see each URL and the typed query |
| — | Activity logging (actions, keystrokes, mouse) | Done (inside the exam window, no raw keys) | `src/lib/live.ts`, `POST /proctoring/activity` |
| — | Timer with auto-submit | Done | Server deadline + 5 s sweeper in `apps/api/src/lib/jobs.ts`; warnings at 10/5/1 min |
| — | Automatic warnings and disqualification | Done | `apps/api/src/lib/policy.ts`, configurable per exam with a simulator |
| — | Offline mode with auto-sync (optional) | Done | Encrypted queue (`electron/secure-store.ts`, DPAPI) replayed in order |
| Bonus | Browser extension | Done | `apps/extension` (Manifest V3) |
| Extra | Organization selects who may sit or proctor; emailed one-device links | Done | `Invite` model, `modules/invites.ts`, desktop `Login.tsx`, web `/join/[token]` |

The PDF suggested Airtable or Firebase. We chose PostgreSQL + Prisma for relational integrity, migrations, and transactions on scoring and policy. Say this if asked.

## 4. Test evidence (Round 2 "testing, validation and reliability")

All numbers come from real runs on this repo. Re-run them before each round and update this table if the counts change.

| Suite | Command | Result | Covers |
| --- | --- | --- | --- |
| API unit tests | `npm test -w apps/api` | **91 passed** | Scoring, numeric answers, violation policy (cooldown, warn, auto-submit, reinstate), OTP expiry and attempts, lockout, join links (preview, device lock, revoked, expired, proctor scope), CORS origins, result release |
| Desktop unit tests | `npm test -w apps/desktop` | **29 passed** | Answer parsing, on-device voice detector, submitted screen, join-link parsing |
| AI agent tests | `npm run test:agent` | **32 passed** | Browsing classification, phone and notes rules, risk score |
| End-to-end smoke | `npm run smoke` (with `npm start` running) | **46 checks, all passed** | Admin creates exam → import → credentials → candidate login → OTP → face → session → autosave → AI site → second device blocked → overrule reinstates → signed evidence → submit → reports |
| Type and lint | `npm run typecheck`, `npm run lint` | Clean | All workspaces |

**Sample inputs and outputs worth showing:**
- A wrong OTP → `401` with `attemptsLeft: 4`.
- A second computer with the same link → `403 "already in use on another computer"`.
- A blank frame → rejected by the agent.
- A tampered evidence URL → rejected.
- A typed ChatGPT question → `AI_QUERY_DETECTED` (CRITICAL) → auto-submit.

## 5. Why this is different

| | Browser-only proctoring (typical extension or web tool) | Smart Proctor |
| --- | --- | --- |
| Control of the computer | Can't close apps or see other displays | Kiosk window, blacklisted-app scanner, display, mirroring, USB, VM checks |
| AI tools | Usually blocked outright or not seen | Allowed as the brief asks, but every AI site and **typed query** is logged and shown |
| Decisions | Black-box flag | Explainable 0–100 risk with a reason per flag; a human confirms or overrules, and overruling reinstates |
| Who may sit the exam | Shared codes or links | Personal emailed link, locked to one computer, expires at exam end, revocable |
| Proctor identity | Rarely checked | Proctors verify face and OTP too, and see only their exam |
| Privacy | Often always-on | Consent screen first; monitoring only during the exam; audio analysed on device and never recorded |
| Connectivity | Fails offline | Encrypted offline queue with ordered replay |

## 6. Disclosure (required by the rules)

**Open-source libraries and frameworks:** listed with versions in [`tech-stack.md`](tech-stack.md). Main ones are Electron, React, Next.js, Express, Prisma, Socket.IO, FastAPI, OpenCV and MediaPipe.

**Pretrained models (not trained by us):**

| Model | Source | Use |
| --- | --- | --- |
| YuNet face detector | OpenCV Zoo | Face count |
| SFace face recognizer | OpenCV Zoo | Identity match |
| Face Landmarker | Google MediaPipe | Gaze and head pose |
| EfficientDet-Lite0 (Apache-2.0) | Google MediaPipe | Phone and notes detection |
| face-api.js models | `@vladmandic/face-api` | On-screen face guide in the desktop app |

**External APIs:**
- **SMTP email**, through Gmail with an app password.
- **An LLM for screen classification** (Anthropic or any OpenAI-compatible endpoint). It is optional and off unless `LLM_API_KEY` is set.
- **Google STUN** (`stun.l.google.com:19302`) for WebRTC.

**Data:** seeded demo exams and accounts only, plus portraits from randomuser.me published for testing. No real candidate data.

**AI-assisted development:** code was written with AI coding assistants as the team's tools, under a documented workflow (`AGENTS.md`): Claude Code, OpenAI Codex, Google Antigravity / Gemini and GitHub Copilot. Prompts and design decisions came from the team. Every change was reviewed, type-checked, linted and tested before merge. Background illustrations were generated with an image model. Say this plainly if asked.

## 7. Ownership (fill in before Round 2)

The rules require "a clear explanation of each member's contribution and technical ownership". Agree on this as a team. The areas below are a suggested split, not a record of who built what.

| Area | Owner | Can explain |
| --- | --- | --- |
| Desktop app: kiosk, guards, sandbox tabs, exam UI | _name_ | `apps/desktop/electron/*`, `screens/Exam.tsx` |
| API: auth, join links, policy engine, realtime, reports | _name_ | `apps/api/src/lib/policy.ts`, `modules/auth.ts`, `modules/invites.ts` |
| AI agent: face, gaze, objects, browsing, risk | _name_ | `backend-services/vision.py`, `agents/*` |
| Website: admin, mentor console, join page; deploy and docs | _name_ | `apps/web/src/app/*`, `docs/deploy.md` |

## 8. Submission checklists

### Round 1

- [ ] Team name, team ID, members, contact details
- [x] PS number/title and interpretation (section 1, [`project-guide.md`](project-guide.md))
- [x] Target users, pain points, use cases, constraints ([`presentation.md`](presentation.md) slide 2)
- [x] Existing solutions and the gap (section 5)
- [x] Solution, differentiator, expected outcome
- [x] Architecture and workflow ([`project-guide.md`](project-guide.md), [`architecture.md`](architecture.md))
- [x] Tech stack with justification ([`tech-stack.md`](tech-stack.md))
- [x] Feasibility, risks, mitigation ([`presentation.md`](presentation.md) slide 6)
- [x] Implementation plan and milestones ([`presentation.md`](presentation.md) slide 7)
- [ ] 5–7 slide deck. The current file in Downloads, `Deviathon2.0-TECHKNIGHTS (1).pptx`, is for a **different PS** (project auditing) and must be rebuilt from [`presentation.md`](presentation.md)

### Round 2

- [x] Working prototype
- [ ] Repository access for judges (make `KKPRO2007/DEV-102` public or add judges, and test the link)
- [x] Architecture of what is actually built ([`project-guide.md`](project-guide.md))
- [x] Test cases, inputs/outputs, results (section 4)
- [x] Evidence per PS requirement (section 3)
- [x] Known limits and next steps ([`project-guide.md`](project-guide.md) "Honest limits", [`presentation.md`](presentation.md) roadmap)
- [x] Disclosure of APIs, libraries, models, data, AI tools (section 6)
- [x] Demo setup and test credentials ([`project-guide.md`](project-guide.md) "Run it locally")
- [ ] Backup demo recording, **labelled as backup**

### Round 3

- [ ] Final deck: problem, solution, architecture, demo, validation, impact, limits, roadmap
- [ ] Demo tested on the actual venue laptop, network and webcam
- [x] Test evidence (section 4)
- [ ] Member contributions (section 7)
- [x] Deployment, cost, scalability, privacy ([`deploy.md`](deploy.md), [`presentation.md`](presentation.md))
- [ ] Backup plan: offline mode, seeded data, labelled recording

### Final pre-submission

- [ ] Every file opens and follows the naming convention
- [ ] Repo link and permissions tested from a logged-out browser
- [ ] Each member can explain every major component
- [ ] No personal data or real secrets in the demo (`.env` is never committed)
- [ ] Presentation and demo fit the time limits (rehearse with a timer)
