# Deploying Where U Elevate Smart Proctor

Production runs as four pieces:

| Piece | Where | Built from |
| --- | --- | --- |
| PostgreSQL | Neon (managed) | direct connection string in `DATABASE_URL` |
| API (Express + Socket.IO) | Render free web service | `apps/api/Dockerfile` |
| AI agent (FastAPI) | Render free web service | `backend-services/Dockerfile` |
| Website (Next.js) | Vercel | `apps/web/vercel.json` |
| Desktop exam app | Windows installer | `npm run build -w apps/desktop` |

The database schema is managed by Prisma migrations in `database/prisma/migrations`. The API container runs `prisma migrate deploy` on every start, so new migrations apply automatically.

## 1. Before you start

- A GitHub copy of this repository that Render and Vercel can read.
- Accounts on [Render](https://render.com) and [Vercel](https://vercel.com).
- Node 22+ and Windows for the installer build.
- Optional: SMTP credentials so credentials and OTP codes are emailed. Without them, emails go to the dev outbox, which production does not expose.

## 2. Deploy the API, agent and database on Render

`render.yaml` uses Render's **free** plan for both services. The agent peaks at about 300 MB with its models loaded, inside the free 512 MB. Know the limits before a demo:

- A free service sleeps after 15 minutes without requests, and the first request after that takes about a minute. Open `https://<api>/health` and `https://<agent>/health` a minute before an exam. During an exam, frames arrive every second, so both stay awake.
- Free services have no persistent disk. Evidence images go to `/tmp/evidence` and are lost when the API restarts or redeploys. Download reports you need to keep before redeploying.
- Free services cannot use Render's private network, so the agent has a public URL. Every agent endpoint except `/health` requires the shared `X-Agent-Key`.
- A workspace gets 750 free instance hours a month. Two services awake around the clock would need about 1,490, so let them sleep between sessions.

To remove these limits, change `plan: free` to `plan: starter` for both services, add back a disk on the API (`disk: { name: evidence, mountPath: /data, sizeGB: 1 }`), and set `EVIDENCE_DIR` to `/data/evidence`.

1. In Render, choose **New → Blueprint** and pick this repository. Render reads `render.yaml` and proposes `dev102-api` and `dev102-agent`.
2. Set `DATABASE_URL` to the Neon **direct** connection string (host without `-pooler`, ending in `?sslmode=require`), leave the other "sync: false" values empty for now, and click **Apply**. Render generates `JWT_SECRET` and `AGENT_API_KEY` (shared between the API and agent), and builds both Docker images. The agent image downloads its detection models at build time.
3. When both services are live, open **dev102-api → Environment** and set:

   | Key | Value |
   | --- | --- |
   | `AGENT_URL` | The agent's public URL from the **dev102-agent** page, for example `https://dev102-agent.onrender.com` (no trailing slash) |
   | `PUBLIC_API_URL` | The API's public URL, for example `https://dev102-api.onrender.com` |
   | `CLIENT_URL` | The website URL from step 3, for example `https://dev102.vercel.app` (comma-separate several) |
   | `APP_DOWNLOAD_URL` | `<website URL>/download` |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | For Gmail, use `smtp.gmail.com:587`, your Gmail address, and a Google App Password (not your account password). |
   | `MAIL_FROM` | Optional with SMTP: leave blank to send from `SMTP_USER`; Gmail only permits a different sender address when it is a verified alias. Required with Brevo: the verified sender, e.g. `Smart Proctor <you@gmail.com>`. |
   | `BREVO_API_KEY` | **Needed on Render's free plan**, which blocks outbound SMTP ports (25, 465, 587), so Gmail SMTP times out there. Create a free account at brevo.com, verify your sender email under **Senders, domains & IPs → Senders**, create a key under **SMTP & API → API keys**, and under **Security → Authorised IPs** turn off IP blocking (Render's outbound addresses change, and Brevo otherwise answers 401 "unrecognised IP address"). When set, mail goes through Brevo's HTTPS API instead of SMTP. |
   | `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | A TURN relay so the proctor's live screen view works when the candidate is on another network (mobile data, campus Wi-Fi). Create a free one, for example on metered.ca, and paste its `turn:`/`turns:` URLs (comma-separated) and credentials. Without it, the screen view only connects on simple networks. |
   | `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_KEY` | Optional. The n8n "Proctor violation alerts" webhook production URL and its header-auth value. The API posts CRITICAL violations and auto-submits there. |

   Save; Render redeploys the API.

   Optional, on **dev102-agent → Environment**: the AI checks on screenshots and typed queries use an LLM. Without a key the agent still runs every webcam, phone and site check. Two free providers, Gemini first and Hugging Face when Gemini's free quota runs out:

   | Key | Gemini (primary) | Key | Hugging Face (fallback) |
   | --- | --- | --- | --- |
   | `LLM_API_KEY` | key from aistudio.google.com/apikey | `LLM_FALLBACK_API_KEY` | token from huggingface.co/settings/tokens ("Make calls to Inference Providers") |
   | `LLM_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | `LLM_FALLBACK_BASE_URL` | `https://router.huggingface.co/v1` |
   | `LLM_MODEL` | a current free Flash model from AI Studio, e.g. `gemini-2.5-flash` | `LLM_FALLBACK_MODEL` | a vision model, e.g. `Qwen/Qwen2.5-VL-7B-Instruct` |

   Hugging Face's free monthly credit is small, so keep it as the fallback. `https://<agent>/health` shows `"llm": true` once a key is set.
4. Check `https://<api>/health` returns `{"ok":true,...}`.
5. Seed the first admin account once, from your machine, against the Neon database:

   ```bash
   DATABASE_URL="<external database url>" ORG_ADMIN_EMAIL="you@example.com" ORG_ADMIN_PASSWORD="<10+ characters>" npm run db:seed:admin
   ```

   This wipes the database and creates only your organization account. Sign in and create exams on the website. (`npm run db:seed` adds a ready-made test exam `LIVE-01` instead, and `npm run db:seed:demo` loads the full demo dataset with the public `admin@wue.in` / `Admin@123`.)

The API refuses to start in production with the default `JWT_SECRET` or `AGENT_API_KEY`, so a missing secret shows up as a failed deploy rather than an insecure one.

Evidence images are written to `EVIDENCE_DIR` (`/tmp/evidence` on the free plan, so they last until the next restart) and deleted after `RETENTION_DAYS` (default 30).

## 3. Deploy the website on Vercel

1. In Vercel, choose **Add New → Project** and import the repository.
2. Set **Root Directory** to `apps/web`. Vercel picks up `apps/web/vercel.json`, which installs from the monorepo root and runs `next build`.
3. Add environment variables:

   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | The API's public URL from step 2 |
   | `NEXT_PUBLIC_SITE_URL` | The Vercel URL of this project |
   | `NEXT_PUBLIC_APP_DOWNLOAD_URL` | `<this site>/download` |

4. Deploy, then put the Vercel URL into the API's `CLIENT_URL` (step 2.3) if you haven't yet. Without it, the API's CORS rules block the website.

## 4. Publish the Windows installer and updates

Installers are published to this repository's GitHub Releases. The API reads them (`DESKTOP_RELEASE_REPO`, already set in `render.yaml`), the website's `/download` page shows the newest one, and installed apps update themselves from it.

1. Set the version in `apps/desktop/package.json`: `0.2.0` for a normal release, or `0.2.0-beta.1` for a test version.
2. Publish, signed in with `gh auth login` (or with `GH_TOKEN` set):

   ```bash
   VITE_API_URL=https://<api> npm run release:desktop
   ```

   A version with `-beta` goes out as a GitHub pre-release. `/download` offers it as "Download test version", and it only replaces a stable release once a newer stable one exists.

How updates reach people:

- An installed app checks GitHub on start and every 4 hours, downloads a newer version in the background, and installs it when the app closes, so an exam is never interrupted.
- A stable install only takes stable releases. A test install also takes newer test versions.
- `PROCTOR_NO_UPDATES=1` turns update checks off on a machine.

The installer is not code-signed, so Windows SmartScreen shows "unknown publisher" (More info → Run anyway). A code-signing certificate removes that warning.

For a local test build without publishing, `VITE_API_URL=https://<api> npm run build -w apps/desktop` writes the installer to `apps/desktop/release/`, and a locally running API serves it at `/api/v1/downloads/windows`.

### Browser extension

The website does not offer the extension. `docs/extension-store.md` covers publishing it to the store.

## 5. Check the deployment

1. `https://<api>/health` returns ok, and `https://<api>/api/v1/public/stats` returns numbers.
2. The website loads and the admin can sign in.
3. Create or publish an exam, import a candidate, and sign in with that candidate in the desktop app (built in step 4).
4. A proctor at `/proctor` sees the candidate live.

## Running the same containers locally

```bash
docker build -f apps/api/Dockerfile -t dev102-api .
docker build -t dev102-agent backend-services
docker run --rm -p 8000:8000 -e AGENT_API_KEY=<key> dev102-agent
docker run --rm -p 4000:4000 -e DATABASE_URL=<postgres url> -e JWT_SECRET=<secret> \
  -e AGENT_URL=http://host.docker.internal:8000 -e AGENT_API_KEY=<key> dev102-api
```

## Schema changes

Change `database/prisma/schema.prisma`, then create a migration and commit it:

```bash
npm run db:migrate -- --name <what-changed>
```

`npm start` applies migrations locally, and the API container applies them on deploy. A database created before migrations existed (with `prisma db push`) is detected and marked as already on the first migration.

## Alternative: AWS + Neon + Vercel

The same containers run on one EC2 host with Docker Compose. Caddy provides HTTPS and passes WebSockets through. Files are in `docs/deploy/aws/`.

1. **Neon:** create a project in `aws-ap-southeast-1` and copy the **direct** connection string (the host without `-pooler`, ending in `?sslmode=require`). The API runs `prisma migrate deploy` on start, which needs the direct URL. Seed it once with `DATABASE_URL="<url>" ORG_ADMIN_EMAIL=... ORG_ADMIN_PASSWORD=... npm run db:seed:admin`.
2. **EC2:** launch Ubuntu 24.04 on a `t3.medium` (4 GB; the agent's vision models need the memory) with a 30 GB disk. Open ports 80 and 443, and 22 for your IP only. Attach an Elastic IP. Without a domain, use `api.<ip-with-dashes>.sslip.io` as the hostname.
3. On the host, install `docker.io docker-compose-v2 git`, clone the repo, and copy `docs/deploy/aws/.env.example` to `docs/deploy/aws/.env`. Fill it in, generating the secrets with `openssl rand -hex 32`. Then run:

   ```bash
   sudo docker compose -f docs/deploy/aws/docker-compose.yml up -d --build
   ```

   `https://<API_HOST>/health` should return ok once Caddy has its certificate.
4. **Vercel:** follow section 3 above, with `NEXT_PUBLIC_API_URL=https://<API_HOST>`. Put the Vercel URL in `CLIENT_URL` in the `.env`, then rerun `docker compose ... up -d`.
5. **Desktop:** follow section 4 above, with `VITE_API_URL=https://<API_HOST>`.

To update, run `git pull` on the host and then the same `docker compose ... up -d --build` command.
