# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Initial implementation of RepoDoc documentation engine
- Express server (`server.js`) with rate limiting, security headers, and raw-body capture for webhook signature verification
- In-memory job queue (`queue.js`) with configurable concurrency (default: 3 concurrent jobs)
- Claude Code runner (`runner.js`) that clones repos, builds focused prompts, and spawns `claude -p --bare --output-format stream-json`
- MCP server injection (filesystem + GitHub) per documentation run
- SQLite persistence (`db.js`) with customers, repos, and jobs tables; WAL mode enabled
- REST API (`api.js`) covering customer/repo/job CRUD and admin endpoints
- GitHub webhook handler (`webhook.js`) with HMAC-SHA256 validation; filters push events to default branch only
- Stripe webhook handler for subscription lifecycle (created, updated, deleted, payment events)
- Daily cron pass (`cron.js`) that triggers all active Pro/Team repos every 24 hours
- GitHub helpers (`github.js`): webhook registration/removal, repo metadata, commit file listing
- Web dashboard (`index.html`) — dark-theme SPA with real-time queue stats, job history, customer management
- Setup script (`setup.js`) that checks Node.js 18+, Claude Code CLI, creates directories, and seeds a demo customer
- Railway deployment config (`railway.json`) with health check and restart-on-failure policy
- Plan-based repo limits: Starter=3, Pro=15, Team=unlimited
- Cost estimation from Claude token usage (claude-sonnet-4 pricing)
