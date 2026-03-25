# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Full Express server (`server.js`) with raw body capture, security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`), and separate rate limiters for API (100 req/15 min) and webhook (300 req/1 min) routes
- REST API (`src/routes/api.js`) for customer and repo management, job history, manual triggers, and admin stats/cron endpoints
- GitHub and Stripe webhook handlers (`src/routes/webhook.js`): push events trigger doc jobs; subscription events update customer plan and status
- Claude Code runner (`src/runner.js`): clones repo at depth 50, injects `.mcp.json` and `CLAUDE.md`, spawns `claude -p --bare --output-format stream-json`, parses stream output for PR URL and token counts, estimates cost at claude-sonnet-4 rates ($3.00/1M input, $15.00/1M output), and cleans up the ephemeral work directory
- In-memory job queue (`src/queue.js`) with configurable concurrency via `MAX_CONCURRENT` (default 3); job state persisted to SQLite throughout lifecycle
- SQLite persistence layer (`src/db.js`) using `better-sqlite3` in WAL mode with foreign keys; tables for `customers`, `repos`, and `jobs`
- GitHub API helpers (`src/github.js`): webhook registration/removal via Octokit, HMAC-SHA256 signature verification with timing-safe comparison, repo metadata fetch
- Daily cron scheduler (`src/cron.js`): runs 5 minutes after startup then every 24 hours; skips Starter plan accounts (webhook-only)
- First-run setup script (`scripts/setup.js`): checks Node 18+, Claude Code CLI, `.env`, creates work/data directories, creates demo Pro customer
- MCP server config auto-injected per run: `filesystem` (scoped to work dir) + `github` (authenticated with customer token)
- Railway deployment config (`railway.json`): NIXPACKS build, health check at `/api/health`, restart-on-failure policy
- Plan limits: Starter 3 repos, Pro 15 repos, Team unlimited
- `GET /api/repos/:repoId/jobs/:jobId` endpoint for individual job detail
- `GET /api/admin/jobs` endpoint returning last 50 jobs across all repos
- `POST /api/admin/cron/run` endpoint to force a daily cron pass on demand
- `DB_PATH`, `CLAUDE_BIN`, `MAX_CONCURRENT`, and `NODE_ENV` environment variables documented
