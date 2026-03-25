# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Full SaaS multi-tenant architecture: customers, repos, and jobs stored in SQLite via `better-sqlite3` (WAL mode)
- In-memory FIFO job queue (`queue.js`) with configurable concurrency (`MAX_CONCURRENT`, default 3)
- Claude Code runner (`runner.js`): clones repo, discovers changed files via `git diff-tree`, writes `.mcp.json` + `CLAUDE.md` into the work dir, spawns `claude -p --bare --output-format stream-json`, parses PR URL and token usage from stream output
- Daily cron scheduler (`cron.js`): runs 5 minutes after startup then every 24h; skips Starter plan customers (webhook-only)
- GitHub integration (`github.js`): webhook registration/removal via Octokit, HMAC-SHA256 signature verification, repo metadata fetch, changed-file discovery
- REST API (`api.js`): customer CRUD, repo connect/disconnect, job history, manual trigger, admin stats, forced cron run
- Webhook handlers (`webhook.js`): GitHub push events trigger doc jobs; Stripe subscription events update plan and account status
- Web dashboard (`index.html`): single-page app with stats cards, job/repo/customer tables, log viewer, and add-repo/add-customer modals
- Setup script (`setup.js`): checks Node.js 18+, Claude Code CLI, `.env` presence, creates work and data directories, seeds a demo Pro customer
- Railway deployment config (`railway.json`): Nixpacks builder, health check on `/api/health`, restart on failure
- Cost tracking: input/output tokens recorded per job; estimated cost in cents stored in DB
- Plan repo limits: Starter=3, Pro=15, Team=unlimited
