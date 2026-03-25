# Changelog

All notable changes to RepoDoc are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Initial release of RepoDoc — living documentation engine powered by Claude Code CLI
- Express HTTP server (`server.js`) with rate limiting (100 req/15 min for API, 300 req/min for webhooks) and security headers
- In-memory FIFO job queue (`queue.js`) with configurable concurrency (default: 3 simultaneous runs)
- Claude Code execution engine (`runner.js`) that clones repos, builds focused prompts, and spawns `claude -p --bare --output-format stream-json`
- SQLite persistence via `better-sqlite3` (`db.js`) — customers, repos, jobs tables with WAL mode
- GitHub webhook handler (`webhook.js`) — HMAC-SHA256 signature validation, push-event filtering, job enqueue
- Stripe webhook handler (`webhook.js`) — subscription lifecycle management (create, update, payment failure, reactivation)
- REST API (`api.js`) — customer CRUD, repo management, job history, manual trigger, admin stats/cron endpoints
- Daily cron runner (`cron.js`) — enqueues docs pass for all active Pro/Team repos once per day
- First-run setup script (`setup.js`) — validates environment, creates directories, seeds demo customer
- Web dashboard (`index.html`) — dark-theme SPA with overview stats, repo management, job history, customer admin
- Plan-based feature gating: Starter (3 repos, README+CHANGELOG only), Pro (15 repos, full docs/), Team (unlimited, full docs/)
- Railway deployment config (`railway.json`) with health check and restart policy
- MCP server config (`mcp.json`) — filesystem + GitHub servers injected per-run into the cloned repo
- Token cost tracking — input ($3.00/MTok) and output ($15.00/MTok) estimated and stored per job
