# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- **Core documentation engine**: `runner.js` clones target repos into ephemeral directories, resolves files changed in the last 24 h or a specific commit, builds a focused prompt, and spawns `claude -p --bare --output-format stream-json` to generate and PR documentation updates.
- **In-memory job queue** (`queue.js`): concurrency-limited (max 3 concurrent jobs) FIFO queue that persists job records to SQLite before execution and updates status on completion or failure.
- **SQLite persistence** (`db.js`): three tables — `customers`, `repos`, `jobs` — using better-sqlite3 with WAL mode. Tracks job status, tokens used, cost estimate, and PR URL. Plan limits enforced at the DB layer (Starter: 3 repos, Pro: 15, Team: unlimited).
- **GitHub integration** (`github.js`): Octokit wrapper for webhook registration/removal, repo metadata lookup, commit file diffs, and timing-safe HMAC-SHA256 webhook signature verification.
- **Stripe billing integration** (`webhook.js`): handles `customer.subscription.*` and payment events; maps Stripe price IDs to plan names and updates customer status automatically.
- **Daily cron scheduler** (`cron.js`): runs a documentation pass for all active Pro/Team repos once per day, starting 5 minutes after server boot. Starter plan repos are skipped (webhook-only).
- **REST API** (`api.js`): endpoints for customer CRUD, repo connect/disconnect with plan-limit validation, job history, manual trigger, and admin stats.
- **Express server** (`server.js`): rate limiting (100 req/15 min for API, 300 req/min for webhooks), raw body capture for signature verification, static dashboard SPA, global error handler.
- **Dashboard UI** (`index.html`): dark-themed single-page app with stat cards, job history table, and status badges.
- **First-run setup script** (`setup.js`): verifies Node.js 18+, Claude Code CLI installation, `.env` file, `ANTHROPIC_API_KEY`, and creates work/data directories plus a demo Pro customer.
- **Railway deployment config** (`railway.json`): Nixpacks builder, `/api/health` health check, on-failure restart with max 3 retries.
- **Environment template** (`.env.example`): documents all required and optional variables including Stripe price IDs and pricing in cents.
