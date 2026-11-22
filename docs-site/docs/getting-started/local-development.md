---
id: local-development
title: Run Locally Without Docker
description: Install, run, and troubleshoot JobOps natively with Node.js and SQLite instead of Docker Compose.
sidebar_position: 3
---

## What it is

This is the native local setup: Node.js runs the API and Vite UI directly on your machine, and JobOps stores data in a local SQLite database. Docker, Docker Compose, Postgres, and Redis are not required.

Default local URLs:

- **UI:** `http://localhost:5173` (Vite dev server)
- **API:** `http://localhost:3001`
- **Docs site:** `http://localhost:3006` (only when you run `npm run docs:dev`)

## Why it exists

[Docker Compose](/docs/next/getting-started/self-hosting) is the simplest path for most installs, but it is not required. Native mode is useful when you want faster reloads while changing source, when your machine has trouble with Docker image mounts, or when you want to run the UI and API from a checkout. It uses the same database format and the same `data/` directory as the container.

## How to use it

### 1) Prerequisites

- **Node.js 22** (the CI baseline) and npm. Node 24 works for the current local setup, but rebuild native modules if you hit an ABI error.
- **Python 3**, only if you use Indeed, LinkedIn, or Glassdoor through the JobSpy extractor.
- **Ollama**, only if you want local AI models instead of a hosted provider.
- **Tectonic or Typst**, only if you generate PDFs with a local renderer instead of Reactive Resume.

### 2) Install dependencies

From the repository root:

```bash
npm ci
```

### 3) Migrate the database

```bash
npm --workspace orchestrator run db:migrate
```

JobOps resolves its data directory automatically. With the standard layout it uses the repository's `data/` folder, which contains `jobs.db`, generated PDFs, and the local `jwt-secret` file. Set `DATA_DIR` explicitly if you want a different location.

No environment variables are required to boot. If `JWT_SECRET` is not set, JobOps generates one and persists it in `data/jwt-secret`. Sessions last 24 hours by default (`JWT_EXPIRY_SECONDS` can change that) and stay in browser `localStorage` until they expire or you sign out.

### 4) Start the API and UI

```bash
npm --workspace orchestrator run dev
```

This starts two processes:

- `dev:server`: the API with watch mode on `http://localhost:3001`
- `dev:client`: Vite on `http://localhost:5173`

Vite proxies `/api`, `/pdfs`, and `/stats` to port `3001`, so keep both processes running. Open `http://localhost:5173` and complete first-run onboarding: create the first account, set search preferences, connect an LLM provider, and confirm your resume.

### 5) Add only the optional pieces you use

**JobSpy extractors (Indeed, LinkedIn, Glassdoor):**

```bash
# macOS/Linux
python3 -m venv extractors/jobspy/.venv
extractors/jobspy/.venv/bin/pip install -r extractors/jobspy/requirements.txt
```

```powershell
# Windows PowerShell
py -3 -m venv extractors\jobspy\.venv
extractors\jobspy\.venv\Scripts\pip.exe install -r extractors\jobspy\requirements.txt
```

The runner detects the venv automatically; you do not need to set `PYTHON_PATH` unless you use a custom interpreter.

**Camoufox-based browser extractors:**

```bash
node ./scripts/camoufox-fetch.mjs
```

If GitHub rate limits the download, set `GITHUB_TOKEN` in your shell before running the script.

**Local AI with Ollama:**

```bash
ollama pull qwen3:4b
```

Start Ollama, then open **Settings → Model**, choose the `ollama` provider, and select the model. The default base URL is `http://localhost:11434`; no container or `LLM_BASE_URL` override is needed.

**Local PDF generation:**

Install `tectonic` or `typst` and leave it on your `PATH`, or point `TECTONIC_BIN` / `TYPST_BIN` at the executable. Reactive Resume users do not need either binary.

**Gmail or Microsoft Graph OAuth:**

Register the callback URL for your dev origin, then set the matching environment variables before starting the server:

```bash
GMAIL_OAUTH_CLIENT_ID=...
GMAIL_OAUTH_CLIENT_SECRET=...
GMAIL_OAUTH_REDIRECT_URI=http://localhost:5173/oauth/gmail/callback

GRAPH_OAUTH_CLIENT_ID=...
GRAPH_OAUTH_REDIRECT_URI=http://localhost:5173/oauth/graph/callback
```

Use the exact same URLs in the provider's redirect URI list. See the [Gmail OAuth setup](/docs/next/getting-started/gmail-oauth-setup) and [Microsoft Graph setup](/docs/next/getting-started/microsoft-graph-oauth-setup) guides for the full flow.

### 6) If the Docker container is also running

The container maps `3005:3001`, so its port does not clash with native `3001` or `5173`. However, if both use the same `./data` folder, stop the container before running natively, or give the native process a separate `DATA_DIR`. Two processes writing the same SQLite file will corrupt or lock data.

### 7) Optional: production-style native run

To serve the built client from the API instead of using Vite:

```bash
npm --workspace orchestrator run build:client
npm --workspace orchestrator run start
```

Then open `http://localhost:3001`. The API also serves the built docs at `/docs` when a docs build is present.

## Common problems

- **The UI loads but API calls fail.** Make sure `dev:server` is running on port `3001`; Vite only proxies while that process is alive. Do not point the browser at the container's port `3005` while running the native dev server.
- **`EADDRINUSE` on `3001` or `5173`.** Stop the other process, or stop the JobOps container. Check for a stale native server before restarting `npm run dev`.
- **`better-sqlite3` ABI error after changing Node versions.** Rebuild it with `npm --workspace orchestrator rebuild better-sqlite3`, ideally on Node 22.
- **No jobs from LinkedIn/Indeed/Glassdoor.** Create the JobSpy venv and install its requirements, then check the saved run details for source errors. See the [JobSpy extractor](/docs/next/extractors/jobspy) guide.
- **No Ollama models appear in Settings.** Confirm Ollama is running and a model is pulled (`ollama list`); then refresh **Settings → Model**.
- **PDF generation fails.** Install `tectonic` or `typst`, or set `TECTONIC_BIN` / `TYPST_BIN` to the installed executable.
- **You are asked to sign in again after a day.** Expected: sessions expire after 24 hours unless you change `JWT_EXPIRY_SECONDS`.
- **OAuth callback fails in native mode.** Set `GMAIL_OAUTH_REDIRECT_URI` / `GRAPH_OAUTH_REDIRECT_URI` to the exact `http://localhost:5173/oauth/...` URL registered with the provider.

## Related pages

- [Self-hosting with Docker Compose](/docs/next/getting-started/self-hosting)
- [Model settings and providers](/docs/next/features/settings)
- [JobSpy extractor](/docs/next/extractors/jobspy)
- [Reactive Resume](/docs/next/features/reactive-resume)
- [Common problems](/docs/next/troubleshooting/common-problems)
