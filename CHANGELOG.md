# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [Unreleased]

### Added
- Initial full application release: Express server, SQLite persistence, job queue, Claude Code runner, GitHub and Stripe webhook handlers, daily cron scheduler, and admin dashboard UI
- `runner.js`: Claude Code execution engine that clones repos, builds focused prompts, spawns `claude -p --bare --output-format stream-json`, parses token usage, and estimates cost in cents
- `db.js`: SQLite persistence layer (better-sqlite3, WAL mode) with `customers`, `repos`, and `jobs` tables; enforces per-plan repo limits (Starter: 3, Pro: 15, Team: unlimited)
- `queue.js`: In-memory FIFO job queue with configurable concurrency (default 3)
- `cron.js`: Daily documentation pass for Pro and Team customers; first run 5 minutes after startup, then every 24 hours
- `webhook.js`: GitHub push webhook handler (HMAC-SHA256 validation) and Stripe subscription/payment event handler
- `api.js`: REST API for customer and repo management, job history, manual trigger, admin stats, and forced cron pass
- `server.js`: Express app with rate limiting, security headers, static dashboard, and scheduler startup
- `github.js`: Helpers for registering/removing GitHub webhooks, fetching repo metadata, listing changed files, and verifying webhook signatures
- `setup.js`: First-run setup script — checks Node 18+, Claude Code CLI, creates directories, generates demo customer
- `index.html`: Dark-theme admin dashboard with pages for Dashboard, Repositories, Run History, Customers, and Settings
- `railway.json`: Railway deployment config (Nixpacks, health check at `/api/health`)
- `.env.example`: Full environment variable reference including Anthropic, GitHub, Stripe, app, paths, and plan pricing
