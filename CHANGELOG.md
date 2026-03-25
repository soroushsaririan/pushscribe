# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Initial implementation of RepoDoc — automated documentation engine powered by Claude Code CLI
- `server.js`: Express server with rate limiting (100 req/15min for API, 300 req/min for webhooks), security headers, and raw-body capture for webhook signature verification
- `webhook.js`: GitHub push webhook handler (triggers doc jobs on default-branch pushes); Stripe subscription webhook handler (manages plan upgrades, cancellations, suspensions, and reactivations)
- `api.js`: REST API for customer and repo management, job history, manual triggers, admin stats, and forced cron runs
- `runner.js`: Claude Code execution engine — clones repo with `git clone --depth 50`, discovers changed files via `git diff-tree`, injects MCP config (filesystem + github servers), spawns `claude -p --bare --output-format stream-json`, parses stream-JSON output for PR URL and token usage, estimates cost at $3.00/1M input and $15.00/1M output tokens
- `queue.js`: In-memory FIFO job queue with configurable concurrency (`MAX_CONCURRENT`, default 3); persists job state to SQLite throughout lifecycle
- `cron.js`: Daily documentation pass for Pro and Team plan customers; starts 5 minutes after server boot, then repeats every 24 hours; Starter plan repos are webhook-only
- `db.js`: SQLite persistence via `better-sqlite3` with WAL mode; schema covers `customers`, `repos`, and `jobs` tables with foreign-key constraints and indexes
- `github.js`: Octokit helpers for webhook registration/removal, repo metadata fetching, and HMAC-SHA256 webhook signature verification
- `setup.js`: First-run helper that validates dependencies and seeds a demo customer
- `index.html`: Dark-theme dashboard UI with stats cards, customer/repo tables, and job history
- Plan limits enforced at repo connection time: Starter=3 repos, Pro=15, Team=unlimited
