# Changelog

All notable changes to RepoDoc are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Full application scaffold: Express server, job queue, Claude Code runner, SQLite persistence, GitHub and Stripe webhook handlers, and daily cron scheduler
- REST API for customer and repo management (`/api/customers`, `/api/customers/:id/repos`, `/api/repos/:repoId/jobs`, `/api/repos/:repoId/trigger`)
- Admin endpoints: `/api/admin/stats`, `/api/admin/jobs`, `/api/admin/cron/run`
- Health check endpoint at `/api/health` exposing queue depth and job statistics
- In-memory FIFO job queue with configurable concurrency (`MAX_CONCURRENT`, default 3)
- Claude Code runner (`runner.js`) that clones repos, builds plan-scoped prompts, spawns `claude -p --bare --output-format stream-json`, parses results, and tracks token usage and cost
- SQLite persistence (`db.js`) using `better-sqlite3` in WAL mode; stores customers, repos, jobs with full lifecycle fields (`queued → running → done | failed`)
- GitHub webhook receiver (`/webhook/github`): validates HMAC-SHA256 signatures, triggers doc jobs on pushes to the default branch only
- Stripe webhook receiver (`/webhook/stripe`): handles `customer.subscription.*` and `invoice.payment_*` events to keep plan and account status in sync
- Daily cron scheduler (`cron.js`): runs 5 minutes after startup then every 24 hours; Pro and Team plans only
- Three pricing tiers: Starter (3 repos, webhook-only), Pro (15 repos, webhook + cron), Team (unlimited repos, webhook + cron)
- MCP server configuration injected per-run: `@modelcontextprotocol/server-filesystem` and `@modelcontextprotocol/server-github`
- `CLAUDE.md` copied into each ephemeral work directory so Claude Code picks up doc-writing instructions
- Rate limiting: 100 requests / 15 min on `/api`, 300 requests / 1 min on `/webhook`
- Security headers on all responses: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- Static dashboard served from `public/` with SPA catch-all route
- First-run setup script (`scripts/setup.js`): checks Node version, Claude Code installation, `.env` presence, creates work and data directories, seeds a demo Pro customer
- `railway.json` for one-command Railway deployment
- `.env.example` documenting all required and optional environment variables
