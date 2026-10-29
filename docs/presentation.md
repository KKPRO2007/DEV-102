# Presentation and demo script

Material for building the deck and rehearsing the demo. Judging details are in [`hackathon.md`](hackathon.md), and the system explanation is in [`project-guide.md`](project-guide.md).

Brand look: blue gradients `#0A4DA6` → `#1E6FF0`, amber call-outs `#FFB020`, Poppins headings, white cards. The 9 time-of-day backgrounds (student, proctor and organization × morning, day, night) work as slide backgrounds too.

## Round 1 deck: 7 slides, 5 minutes

The deck is `DEV-102_TECHKNIGHTS_Round1.pptx` (kept with the original template in the team's Downloads folder, not in the repo). It keeps the Deviathon 2.0 template: maroon Times New Roman headings, the TECH KNIGHTS badge, GLA and Deviathon logos, and the INNOVATE | CODE | CONQUER footer. Speaker notes with timings are on every slide. Round 1 asks for 5–7 slides, and each slide below answers part of the Round 1 checklist and rubric.

| # | Slide | What it shows | Checklist item / rubric criterion | Time |
| --- | --- | --- | --- | --- |
| 1 | Title page | PS `DEV_102: Build a Smart Proctoring Browser for Assessment`, Where U Elevate (WUElev8), track **TECH FOR IMPACT**, team TECH KNIGHTS, members, `[Team ID]` and `[Email] · [Phone]` placeholders | Team name, ID, members, contact; PS number and title | 0:20 |
| 2 | Problem Understanding | PS interpretation and "the twist" (tabs allowed but tracked); chart of self-reported online-exam cheating (Newton & Essex 2023: 29.9% before COVID, 54.7% during, 44.7% overall); who is hurt (organisations, candidates, proctors); use cases; constraints; table mapping all six PS objectives to our answer; key features and the bonus extension | Problem understanding and PS alignment (25) | 0:45 |
| 3 | Idea Title | Workflow diagram: actor roles → personal join link → identity gate (system check, face, OTP, consent) → secure exam window with four parallel signals (webcam AI every 1 s, sandbox tabs, screen AI every 20 s, native guards) → policy engine (explainable 0–100 risk) → live proctor console and evidence/reports; "How it solves the problem" and "Innovation & uniqueness" | Proposed solution, differentiator, expected outcome; innovation (20) | 1:00 |
| 4 | Technical Approach | Platform security (identity and access, one person one computer, privacy by design); architecture (desktop, website, extension → API core → AI agent and PostgreSQL); performance and scalability; tech stack with a reason for each choice | Architecture and workflow; tech stack with justification; solution approach (20) | 0:55 |
| 5 | Feasibility and Viability | Test chart (116 API + 41 desktop + 31 AI agent = 188 passing), 46-check smoke test, 23 violation codes, 5 parts; viability; six-step exam workflow; risks and mitigation; three-phase plan and milestones | Feasibility, risks, mitigation; implementation plan; technical feasibility (15) | 0:50 |
| 6 | Impact and Benefits | Five pillars (fair at scale, allowed but visible, evidence not accusations, privacy-first, one person one device) and benefits for organisations, candidates, and proctors and institutions | Target users and expected outcome; user needs and impact (10) | 0:35 |
| 7 | Research and References | Problem validation (Newton & Essex 2023, the PS itself, lockdown browsers); models we build on (YuNet, SFace, MediaPipe Face Landmarker, EfficientDet-Lite0); comparison with typical tools; disclosure of models, APIs, AI coding assistants and data | Existing solutions and the gap; research quality (10); disclosure rule | 0:35 |

Before submitting:
- Fill in `[Team ID]`, `[Email]` and `[Phone]` on slide 1.
- Re-run `npm test` and `npm run test:agent`. If the counts change, update slide 5's chart and speaker notes, and section 4 of [`hackathon.md`](hackathon.md).
- Name the file the way the organisers ask, and check it opens on another machine.

Wording rules for the deck and Q&A:
- Say **secure exam window**, not "kiosk". The exam window is locked full screen, always on top and excluded from screen capture, while tab switching inside the app's sandbox tabs stays allowed, as the PS asks.
- Only claim what runs: the test counts are from 30 Oct 2026 runs, and the impact slide makes no numeric impact claims.
- The cheating figures are self-reported survey data. Say "self-reported" if asked.

## Round 2 demo: 6 minutes + 4-minute inspection

Have these ready before you start:
- `npm start` running, with the browser on `/organization` and the Electron window open.
- The webcam working and the room lit.
- **Turn off the dev panel and the outbox in front of judges** if possible, or explain that they're development tools.

| Time | Who | Action | Say |
| --- | --- | --- | --- |
| 0:00 | A | Website `/organization/exams/<exam>/credentials` | "The organization picks who sits and who proctors." |
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
   - Frames are throttled: webcam every 1 s (a tick is skipped while the previous frame is still being analysed) and screen every 20 s.
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
