# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to `main`
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core is a single Claude Code command:

```bash
claude -p "<focused prompt>" \
  --bare \
  --allowedTools "Read,Write,Bash(git log *),Bash(git diff *),Bash(git diff-tree *),Bash(git add *),Bash(git commit *),Bash(git push *),Bash(git branch *),Bash(git checkout *),Bash(cat *),Bash(ls *),Bash(find * -name '*.md')" \
  --output-format stream-json
```

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview) (`npm install -g @anthropic-ai/claude-code`)
- Anthropic API key
- GitHub token (with `repo` + `admin:repo_hook` scopes)

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/yourname/repodoc
cd repodoc
npm install

# 2. Configure
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, etc.

# 3. Setup (creates DB, checks dependencies, seeds demo customer)
npm run setup

# 4. Start
npm start
# → Dashboard at http://localhost:3000

# 5. Add a customer and repo
curl -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"email":"you@co.com","plan":"pro"}'

curl -X POST http://localhost:3000/api/customers/<id>/repos \
  -H "Content-Type: application/json" \
  -d '{"owner":"yourorg","name":"yourrepo"}'

# 6. Trigger a run manually
curl -X POST http://localhost:3000/api/repos/<repo-id>/trigger
```

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/customers` | Create a customer (idempotent by email) |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get a single customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo (registers GitHub webhook) |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo (removes webhook) |
| `POST` | `/api/repos/:repoId/trigger` | Manual doc run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history (default 20, max 100) |
| `GET`  | `/api/repos/:repoId/jobs/:jobId` | Get a single job |
| `GET`  | `/api/admin/stats` | System-wide stats |
| `GET`  | `/api/admin/jobs` | Recent 50 jobs across all repos |
| `POST` | `/api/admin/cron/run` | Force a daily cron pass |
| `POST` | `/webhook/github` | GitHub push webhook receiver |
| `POST` | `/webhook/stripe` | Stripe subscription webhook receiver |
| `GET`  | `/api/health` | Health check (uptime, queue depth, job counts) |

## Pricing tiers

| Plan | Price | Repos | Trigger |
|------|-------|-------|---------|
| Starter | $99/mo | 3 | Webhook only |
| Pro | $299/mo | 15 | Webhook + daily cron |
| Team | $799/mo | Unlimited | Webhook + daily cron |

> Daily cron runs 5 minutes after startup, then every 24 hours. Starter plan repos are skipped by the cron — they only run on webhook push.

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all environment variables from `.env.example` in your Railway project dashboard.

### Environment variables

See `.env.example` for the full list. Required:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GITHUB_TOKEN` | GitHub app or PAT (fallback when no customer token) |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook signature validation |
| `BASE_URL` | Your deployed URL (used when registering webhooks) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` | Stripe Price ID for the Starter plan |
| `STRIPE_PRICE_PRO` | Stripe Price ID for the Pro plan |
| `STRIPE_PRICE_TEAM` | Stripe Price ID for the Team plan |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `WORK_DIR` | `/tmp/repodoc-runs` | Where repos are cloned during runs |
| `MAX_CONCURRENT` | `3` | Max parallel Claude Code processes |
| `DB_PATH` | `data/repodoc.db` | SQLite database path |

## Architecture

```
Trigger (webhook push / daily cron / manual API call)
    ↓
Express server  (server.js)
    ├── /webhook/github  →  verify HMAC-SHA256, enqueue job
    ├── /webhook/stripe  →  update plan / status in DB
    └── /api             →  customer + repo + job management
    ↓
Job queue  (queue.js) — FIFO, max MAX_CONCURRENT concurrent
    ↓
Claude Code runner  (runner.js)
    ├── git clone --depth 50
    ├── git diff-tree  →  discover changed files
    ├── write .mcp.json + CLAUDE.md into work dir
    └── claude -p --bare --output-format stream-json
           ↓
       MCP servers: filesystem + github
           ↓
       PR opened on customer's repo
    ↓
Job result saved to SQLite  (db.js)
    └── tokens_used, cost_cents, duration_ms, pr_url
```

### Data model

- **customers** — `id`, `email`, `plan` (starter/pro/team), `stripe_id`, `status` (active/suspended/cancelled)
- **repos** — `id`, `customer_id`, `owner`, `name`, `full_name`, `default_branch`, `webhook_id`, `active`
- **jobs** — `id`, `repo_id`, `trigger` (webhook/cron/manual), `commit_sha`, `status` (queued/running/done/failed), `pr_url`, `tokens_used`, `cost_cents`, `duration_ms`

SQLite runs in WAL mode for concurrent reads.

## License

MIT
