# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Express server (`server.js`) with rate limiting (100 req/15 min for API, 300 req/60s for webhooks) and security headers
- SQLite database layer (`db.js`) with `customers`, `repos`, and `jobs` tables; plan-based repo limits (starter: 3, pro: 15, team: unlimited)
- In-memory FIFO job queue (`queue.js`) with configurable concurrency (default 3 simultaneous Claude Code processes)
- Claude Code runner (`runner.js`) that clones repos, discovers changed files, writes `.mcp.json`, and spawns `claude -p --bare --output-format stream-json`; tracks token usage and estimates cost at Claude Sonnet 4 rates
- REST API (`api.js`) with full CRUD for customers and repos, job history, manual triggers, and admin endpoints
- GitHub webhook handler (`webhook.js`) with HMAC-SHA256 signature validation; ignores non-default-branch pushes
- Stripe webhook handler for subscription lifecycle events: `created`, `updated`, `deleted`, `payment_failed`, `payment_succeeded`
- Daily cron scheduler (`cron.js`) that runs doc passes for all active pro/team customers; first run 5 minutes after startup, then every 24 hours
- GitHub API helpers (`github.js`): webhook registration/removal, repo metadata fetch, commit file list, signature verification
- Setup script (`setup.js`) that checks Node.js version, Claude Code CLI, `.env` file, creates work/data directories, and seeds a demo customer
- Web dashboard (`index.html`) with dark theme, real-time job monitoring, repo management, and admin stats
- Railway deployment config (`railway.json`) with NIXPACKS builder, health check on `/api/health`, and ON_FAILURE restart policy
- Plan-scoped documentation: starter plans get README + CHANGELOG only; pro/team plans get full `docs/` coverage
