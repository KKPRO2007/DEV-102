# Presentation and demo script

Material for building the deck and rehearsing the demo. Judging details are in [`hackathon.md`](hackathon.md), and the system explanation is in [`project-guide.md`](project-guide.md).

Brand look: blue gradients `#0A4DA6` → `#1E6FF0`, amber call-outs `#FFB020`, Poppins headings, white cards. The 9 time-of-day backgrounds (student, proctor and organization × morning, day, night) work as slide backgrounds too.

## Round 1 deck: 7 slides, 5 minutes

About 40 seconds per slide. One idea per slide, few words, and the speaker says the rest.

### Slide 1: Title
- **Smart Proctor**: a secure proctoring browser for MCQ assessments
- DEV_102 · WUElev8 (Where U Elevate) · DEVIATHON 2.0, GLA University
- Team TECH KNIGHTS: Mallavarapu Krishna Koushik Reddy, Amritansh Rai, Dhruv Gupta, Rishu Kumari

### Slide 2: The problem
- Remote MCQ exams are easy to cheat on: ChatGPT in another tab, a phone, a friend, a second screen.
- Browser-only proctors can't see other apps or displays. Blanket blocking breaks legitimate use (the brief explicitly allows tab switching).
- Organizations need **proof**, not just a flag, and candidates need privacy and fairness.
- **Users:** organizations (admins), proctors, candidates.

### Slide 3: Our solution
- **Organization picks who can sit or proctor** → each person gets an emailed **personal link** + password.
- **Paste the link in the desktop app** → it knows the exam, the person and their role → password → identity checks.
- **Candidate:** system check → face + OTP → consent → kiosk exam with sandbox tabs.
- **Proctor:** face + OTP → live grid of candidates → warn, terminate, review.
- **AI agent + policy engine:** detect → explain → warn → auto-submit → a human confirms or overrules.

### Slide 4: Architecture
Use the diagram from [`project-guide.md`](project-guide.md#the-four-parts): Website (Next.js) and Desktop (Electron) → API (Express, Socket.IO, Prisma, PostgreSQL) → AI agent (FastAPI, OpenCV, MediaPipe). Note: REST + Socket.IO for live events, WebRTC for live screen viewing.

### Slide 5: What makes it different
- **Tab switching allowed, every AI query visible:** proctors see "chatgpt.com: *what is the time complexity of…*".
- **Explainable risk score** with a reason per flag, not a black box.
- **Human-in-the-loop:** every penalty keeps evidence; overruling reinstates the candidate.
- **One person, one computer:** link locked to the first device, expires at exam end, revocable; second-device login blocked.
- **Proctors are verified too** (face + OTP) and see only their exam.
- **Privacy-first:** consent screen, monitoring only during the exam, audio analysed on device and never recorded.

### Slide 6: Feasibility, risks, mitigation

| Risk | Mitigation |
| --- | --- |
| False positives (gaze, voice) | Cooldowns, sustained-time thresholds, MEDIUM events only warn, human review and overrule |
| Phone out of camera view | Combined signals + honest limit; object detection catches visible phones and notes |
| Network drops | Encrypted offline queue, ordered replay, server-synced timer |
| Link sharing | Device-bound, revocable, expiring links + one live session per candidate |
| Privacy | Consent, signed evidence URLs, retention cleanup, no raw keystrokes or audio stored |

### Slide 7: Status and roadmap
- **Built and tested:** website, desktop app, API, AI agent, browser extension; 120 + 32 unit tests, 46-check end-to-end smoke test.
- **Next:** hosted deployment (Render + Vercel), signed Windows installer, per-exam proctor assignment in the web mentor console, LMS integration, more languages.

## Round 2 demo: 6 minutes + 4-minute inspection

Have these ready before you start:
- `npm start` running, with the browser on `/admin` and the Electron window open.
- The webcam working and the room lit.
- **Turn off the dev panel and the outbox in front of judges** if possible, or explain that they're development tools.

| Time | Who | Action | Say |
| --- | --- | --- | --- |
| 0:00 | A | Website `/admin/exams/<CPA-26>/credentials` | "The organization picks who sits and who proctors." |
| 0:30 | A | Send credentials to a candidate; invite a proctor by email; show link status | "Each person gets a personal link locked to one computer." |
| 1:00 | B | Desktop: paste candidate link → details appear → password | "The app reads the exam, user and role from the link. Only the password is typed." |
| 1:30 | B | System check → face verify → OTP → consent → screen share | "Face and OTP, both required, before any question appears." |
| 2:30 | B | Answer 2 questions; open a sandbox tab → chatgpt.com → type a question | "Tab switching is allowed, as the brief asks, but this query is captured." |
| 3:15 | C | Second machine or website mentor view: violation feed shows `AI_QUERY_DETECTED` with the typed text; risk jumps | "Mentors see what was typed, with an explanation." |
| 3:45 | C | Hold a phone to the webcam → `PHONE_DETECTED` | "Object detection from the AI agent." |
| 4:15 | C | Proctor link on desktop → face + OTP → monitor grid with live snapshot; Watch screen | "Proctors verify too, and only see their exam." |
| 5:00 | D | Website session review → Overrule a violation → candidate reinstated | "A human always has the final say." |
| 5:30 | D | Reports → download Excel and the session PDF | "Evidence-backed results." |
| 6:00 | | Stop | |

**Technical inspection, 4 minutes.** Show, in this order:
1. `npm test` and `npm run test:agent` output (or a screenshot of a fresh run).
2. `apps/api/src/lib/policy.ts`, the escalation logic.
3. `apps/api/src/modules/auth.ts`: `openInvite` and the join-link rules.
4. `backend-services/vision.py`, the models.
5. `apps/desktop/electron/security/guards.ts`, the native checks.

## Round 3 finale: 7 minutes + 5-minute jury Q&A

1. **Problem and who it hurts** (45 s): slide 2.
2. **Solution and live demo** (4 min): the Round 2 script, compressed. Start the candidate exam before speaking so the face check is quick.
3. **Validation** (45 s): the test table in [`hackathon.md`](hackathon.md#4-test-evidence-round-2-testing-validation-and-reliability); one false-positive story and how overrule fixes it.
4. **Impact and scale** (45 s):
   - The API is stateless, so it scales horizontally.
   - Frames are throttled (webcam every 4 s, screen every 20 s).
   - Database: hosted Postgres.
   - Hosting cost: free tiers for a pilot, then about one small Render instance per few hundred concurrent candidates. Measure this before quoting a number.
5. **Limits and roadmap** (30 s): honest limits from [`project-guide.md`](project-guide.md#honest-limits-say-these-before-judges-ask).
6. **Team ownership** (15 s): each member names their area.

**Backup plan.**
- If the network fails, the offline mode keeps the exam running. Show the queue replaying when the connection returns.
- If the webcam fails, the face step reports a degraded agent and identity rests on the OTP. Say so.
- A recording is allowed, but only shown as **"backup recording"**, never as live.

## Likely judge questions

| Question | Answer |
| --- | --- |
| Why a desktop app and not just a website? | A browser cannot close other apps, detect mirroring or extra displays, or lock the keyboard. The secure exam runs only in the desktop app; the website handles admin, review and the join page. We also built the browser extension for the bonus. |
| How do you stop someone sharing their link? | It locks to the first computer. A second computer is refused, and during a live exam that attempt is recorded as `MULTI_LOGIN`, which can auto-submit. Admins can revoke or resend at any time. |
| Why does a proctor need face verification? | So the person watching is the person the organization invited. A proctor's sign-in is also limited to the exam on their link. |
| Can it detect a phone outside the camera? | No, and we say so. We combine webcam, screen, browsing and device signals into an explainable score, and a human decides. |
| What if the AI is wrong? | Evidence is kept for every penalty. A mentor overrules with a reason, and the candidate is reinstated if time remains. MEDIUM events only warn. |
| Why PostgreSQL instead of Airtable? | Transactions for scoring and policy, migrations, relational integrity, and no row limits. |
| Is the webcam video stored? | No video. Single frames are kept only as evidence for flagged events, served through 15-minute signed URLs, and deleted after the retention period. Audio is never recorded. |
| Are keystrokes logged? | Only timing and mouse summaries inside the exam window. Raw keys are never stored. |
| How does it scale? | Stateless API, Socket.IO rooms per exam, throttled frames, hosted Postgres, separate agent service that can scale on its own. |
| Did you use AI to build it? | Yes, and it's disclosed: AI coding assistants under a written review workflow. Every change was type-checked, linted and tested. The team made the design decisions. |
| What did *you* build? | Each member answers for their area (see [`hackathon.md`](hackathon.md#7-ownership-fill-in-before-round-2)). |
