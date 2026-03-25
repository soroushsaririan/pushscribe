# Changelog

All notable changes to RepoDoc are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [Unreleased]

### Added
- Initial implementation of the RepoDoc documentation engine
- Express HTTP server (`server.js`) with rate limiting (100 req/15 min for API, 300 req/min for webhooks) and security headers
- In-memory job queue (`queue.js`) with configurable concurrency (`MAX_CONCURRENT`, default 3)
- Claude Code runner (`runner.js`) that clones repos, builds focused prompts, spawns `claude -p --bare --output-format stream-json`, and parses streamed results for PR URL, token counts, and cost
- Per-run `.mcp.json` injection providing `filesystem` and `github` MCP servers inside the ephemeral work directory
- SQLite persistence layer (`db.js`) with `customers`, `repos`, and `jobs` tables; plan-limit enforcement (Starter: 3 repos, Pro: 15, Team: unlimited)
- GitHub integration (`github.js`): webhook registration/removal, repo metadata fetch, commit file diff, HMAC-SHA256 signature verification
- Stripe billing integration (`webhook.js`): subscription lifecycle events update customer plan and status automatically
- Daily cron scheduler (`cron.js`): fires 5 minutes after startup then every 24 hours; enqueues jobs for all active Pro/Team repos
- REST API (`api.js`): customer CRUD, repo connection/disconnection, manual trigger, job history, admin stats, forced cron pass
- Single-page dashboard (`index.html`): live stats grid, recent runs table, repo cards, job log viewer, add-customer/add-repo modals; auto-refreshes every 15 seconds
- First-run setup script (`setup.js`): checks Node 18+, Claude Code installation, `.env` presence, creates work/data directories, seeds demo customer
- Railway deployment config (`railway.json`) and `.env.example` with all required variables documented
- Starter plan documents `README.md` and `CHANGELOG.md` only; Pro/Team additionally update `docs/`
- Cost estimation: $3.00/1M input tokens and $15.00/1M output tokens (claude-sonnet-4 approximate rates)
