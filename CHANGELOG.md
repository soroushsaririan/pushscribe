# Changelog

All notable changes to RepoDoc are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Initial release of RepoDoc — automated documentation engine powered by Claude Code CLI
- Express server (`server.js`) with rate limiting (100 req/15 min on API, 300 req/min on webhooks) and security headers
- REST API (`src/routes/api.js`) for managing customers, repos, and jobs, with admin endpoints for stats and forced cron runs
- GitHub webhook handler (`src/routes/webhook.js`) — triggers doc runs on pushes to the default branch, validates `X-Hub-Signature-256` HMAC signatures
- Stripe webhook handler — handles `subscription.created/updated/deleted` and `invoice.payment_failed/succeeded` to sync plan and account status
- In-memory FIFO job queue (`src/queue.js`) with configurable concurrency (`MAX_CONCURRENT`, default 3)
- Claude Code runner (`src/runner.js`) — clones repo at depth 50, discovers changed files via `git diff-tree`, builds a focused prompt, spawns `claude -p --bare --output-format stream-json`, parses streaming JSON output, extracts PR URL and token usage, estimates cost at Claude Sonnet 4 rates ($3.00/1M input, $15.00/1M output)
- MCP configuration written per-run: `@modelcontextprotocol/server-filesystem` scoped to the ephemeral work directory, `@modelcontextprotocol/server-github` for PR creation
- SQLite persistence (`src/db.js`) via `better-sqlite3` with WAL mode; schema for `customers`, `repos`, and `jobs` tables
- Daily cron scheduler (`src/cron.js`) — runs 5 minutes after startup then every 24 hours; only schedules Pro and Team plan customers
- GitHub API helpers (`src/github.js`) — webhook registration/removal via Octokit, repo metadata fetch, commit file listing, timing-safe HMAC verification
- Plan limits: Starter = 3 repos, Pro = 15 repos, Team = unlimited
- First-run setup script (`setup.js`) — checks Node.js 18+, Claude Code CLI, `.env`, creates work/data directories, seeds a demo Pro customer
- Single-page dashboard (`public/index.html`) for managing customers, repos, and viewing job history
- Railway deployment configuration (`railway.json`) with Nixpacks builder and `/api/health` health check
