# Changelog

All notable changes to RepoDoc are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- **Express server** (`server.js`): HTTP entry point with rate limiting (100 req/15 min for API, 300 req/min for webhooks), security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`), and raw body capture for webhook signature verification.
- **REST API** (`api.js`): Full customer and repo management — create/list/get customers, connect/disconnect repos with automatic webhook registration, job history, manual triggers, and admin stats endpoints.
- **GitHub integration** (`github.js`): Octokit-based helpers for webhook registration/removal, repo metadata fetching, commit file diffing, and HMAC-SHA256 webhook signature verification.
- **Webhook handlers** (`webhook.js`): GitHub `push` event receiver (validates signature, filters to default branch only, enqueues jobs asynchronously after 202 response) and Stripe subscription/invoice event handler (maps Price IDs to plans, handles created/updated/deleted/payment events).
- **SQLite persistence** (`db.js`): Schema for `customers`, `repos`, and `jobs` tables using `better-sqlite3` in WAL mode. Tracks job status lifecycle (`queued → running → done/failed`), token usage, cost, and run duration.
- **In-memory job queue** (`queue.js`): FIFO queue with configurable concurrency (`MAX_CONCURRENT`, default 3). Persists jobs to SQLite before execution; updates status on completion or failure.
- **Claude Code runner** (`runner.js`): Clones repo with `--depth 50`, discovers changed files via `git diff-tree`, writes `.mcp.json` for filesystem and GitHub MCP servers, builds a plan-scoped prompt, spawns `claude -p --bare --output-format stream-json`, parses streaming JSON for PR URL and token counts, estimates cost at claude-sonnet-4 rates, and cleans up the ephemeral work directory.
- **Daily cron** (`cron.js`): Runs 5 minutes after startup then every 24 hours. Enqueues doc jobs for all active repos belonging to Pro and Team customers (Starter gets webhook-only triggers).
- **First-run setup script** (`setup.js`): Validates Node.js version, checks for Claude Code CLI, creates work/data directories, and seeds a demo Pro customer.
- **Dashboard UI** (`index.html`): Single-page dashboard served as a static SPA from the Express server.
- **Railway deployment config** (`railway.json`): Nixpacks builder, `npm start` command, `/api/health` health check, restart on failure (max 3 retries).
- **Environment config** (`.env.example`): Documents all required and optional variables including Stripe Price IDs and plan pricing.
