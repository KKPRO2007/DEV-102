# Deploying Where U Elevate Smart Proctor

Production runs as four pieces:

| Piece | Where | Built from |
| --- | --- | --- |
| PostgreSQL | Render (managed) | `render.yaml` → `dev102-db` |
| API (Express + Socket.IO) | Render web service | `apps/api/Dockerfile` |
| AI agent (FastAPI) | Render private service | `backend-services/Dockerfile` |
| Website (Next.js) | Vercel | `apps/web/vercel.json` |
| Desktop exam app | Windows installer | `npm run build -w apps/desktop` |

The database schema is managed by Prisma migrations in `database/prisma/migrations`. The API container runs `prisma migrate deploy` on every start, so new migrations apply automatically.

## 1. Before you start

- A GitHub copy of this repository that Render and Vercel can read.
- Accounts on [Render](https://render.com) and [Vercel](https://vercel.com).
- Node 22+ and Windows for the installer build.
- Optional: SMTP credentials so credentials and OTP codes are emailed. Without them, emails go to the dev outbox, which production does not expose.

## 2. Deploy the API, agent and database on Render

1. In Render, choose **New → Blueprint** and pick this repository. Render reads `render.yaml` and proposes `dev102-db`, `dev102-api` and `dev102-agent`.
2. Leave the values marked "sync: false" empty for now and click **Apply**. Render creates the database, generates `JWT_SECRET` and `AGENT_API_KEY` (shared between the API and agent), and builds both Docker images. The agent image downloads its detection models at build time.
3. When both services are live, open **dev102-api → Environment** and set:

   | Key | Value |
   | --- | --- |
   | `AGENT_URL` | `http://` + the agent's internal address from **dev102-agent → Connect** (for example `http://dev102-agent-abcd:8000`) |
   | `PUBLIC_API_URL` | The API's public URL, for example `https://dev102-api.onrender.com` |
   | `CLIENT_URL` | The website URL from step 3, for example `https://dev102.vercel.app` (comma-separate several) |
   | `APP_DOWNLOAD_URL` | `<website URL>/download` |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | For Gmail, use `smtp.gmail.com:587`, your Gmail address, and a Google App Password (not your account password). |
   | `MAIL_FROM` | Optional. Leave blank to send from `SMTP_USER`; Gmail only permits a different sender address when it is a verified alias. |

   Save; Render redeploys the API.
4. Check `https://<api>/health` returns `{"ok":true,...}`.
5. Seed the first admin account once, from your machine, against the Render database (copy the **External Database URL** from `dev102-db`):

   ```bash
   DATABASE_URL="<external database url>" npm run db:seed
   ```

   This loads the demo data, including `admin@wue.in` / `Admin@123`. Sign in and change that password before sharing the site.

The API refuses to start in production with the default `JWT_SECRET` or `AGENT_API_KEY`, so a missing secret shows up as a failed deploy rather than an insecure one.

Evidence images are written to the persistent disk mounted at `/data` (`EVIDENCE_DIR=/data/evidence`) and deleted after `RETENTION_DAYS` (default 30).

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

## 4. Build and publish the Windows installer

The installer talks to the API URL baked in at build time:

```bash
VITE_API_URL=https://<api> npm run build -w apps/desktop
```

The installer lands in `apps/desktop/release/` (`Where U Elevate Setup <version>.exe`). The API serves the newest `.exe` in that folder at `/api/v1/downloads/windows`, and the website's `/download` page links to it.

On Render the folder is not part of the image. Either:

- upload the `.exe` somewhere public (for example a GitHub release) and set `APP_DOWNLOAD_URL` and `NEXT_PUBLIC_APP_DOWNLOAD_URL` to that link; or
- copy it to the API's disk (`/data`) using the Render shell, and symlink `/app/apps/desktop/release` to that folder.

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
