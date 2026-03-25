# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to the default branch
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core is a single Claude Code command:

```bash
claude -p "<focused prompt>" \
  --bare \
  --allowedTools "Read,Write,Bash(git log *),Bash(git diff *),Bash(git add *),Bash(git commit *),Bash(git push *)" \
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
git clone https://github.com/soroushsaririan/repodoc
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

### Customers

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/customers` | Create a customer (`email`, `plan`, `stripe_id`) |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get a customer |

### Repos

| Method | Path | Description |
|--------|------|-------------|
| `POST`   | `/api/customers/:id/repos` | Connect a repo (`owner`, `name`, `github_token`) |
| `GET`    | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo (removes webhook) |

### Jobs

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/repos/:repoId/trigger` | Manual doc run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history (default 20, max 100 via `?limit=`) |
| `GET`  | `/api/repos/:repoId/jobs/:jobId` | Single job detail |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook/github` | GitHub push event receiver |
| `POST` | `/webhook/stripe` | Stripe subscription event receiver |

### System

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Health check with queue and job stats |
| `GET`  | `/api/admin/stats` | Customer and job totals |
| `GET`  | `/api/admin/jobs` | Last 50 jobs across all repos |
| `POST` | `/api/admin/cron/run` | Force a daily cron pass immediately |

## Pricing tiers

| Plan | Repos | Triggers |
|------|-------|---------|
| Starter | 3 | Webhook only |
| Pro | 15 | Webhook + daily cron |
| Team | Unlimited | Webhook + daily cron |

Plans are updated automatically via Stripe webhook events (`customer.subscription.*`, `invoice.payment_*`).

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all environment variables from `.env.example` in the Railway project dashboard.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `GITHUB_TOKEN` | Yes | GitHub app token or PAT (`repo` + `admin:repo_hook`) |
| `GITHUB_WEBHOOK_SECRET` | Yes | Shared secret for webhook signature validation |
| `BASE_URL` | Yes | Deployed URL used when registering webhooks |
| `PORT` | No | HTTP port (default `3000`) |
| `NODE_ENV` | No | Set to `production` in deployed environments |
| `WORK_DIR` | No | Temp directory for repo clones (default `/tmp/repodoc-runs`) |
| `DB_PATH` | No | SQLite database path (default `data/repodoc.db`) |
| `MAX_CONCURRENT` | No | Max parallel Claude Code processes (default `3`) |
| `STRIPE_SECRET_KEY` | No | Required for Stripe billing integration |
| `STRIPE_WEBHOOK_SECRET` | No | Required for Stripe webhook validation |
| `STRIPE_PRICE_STARTER` | No | Stripe Price ID for Starter plan |
| `STRIPE_PRICE_PRO` | No | Stripe Price ID for Pro plan |
| `STRIPE_PRICE_TEAM` | No | Stripe Price ID for Team plan |

## Architecture

```
Trigger (webhook / cron / manual)
    ↓
Express server (server.js)
  ├─ Rate limiting: 100 req/15min (API), 300 req/min (webhooks)
  ├─ Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
  └─ Static dashboard (public/)
    ↓
Job queue (src/queue.js) — max MAX_CONCURRENT concurrent (default 3)
    ↓
Claude Code runner (src/runner.js)
  1. Clone repo (depth 50) into ephemeral WORK_DIR
  2. Discover changed files via git diff-tree or 24h log
  3. Write .mcp.json (filesystem + github MCP servers)
  4. Copy CLAUDE.md into work dir
  5. Build prompt scoped to plan (starter: README+CHANGELOG, pro/team: +docs/)
  6. Spawn: claude -p --bare --output-format stream-json
  7. Parse stream-json output, extract PR URL and token usage
  8. Clean up work dir
    ↓
PR opened on customer's repo
    ↓
Job result saved to SQLite (src/db.js)
  ├─ pr_url, run_log, tokens_used, cost_cents, duration_ms
  └─ Job status: queued → running → done | failed
```

### Cost tracking

Token costs are estimated at publish time using claude-sonnet-4 pricing:
- Input: $3.00 / 1M tokens
- Output: $15.00 / 1M tokens

Stored as integer cents in `jobs.cost_cents`.

### Daily cron

`startCron()` fires once 5 minutes after server startup, then every 24 hours. Only Pro and Team customers are included — Starter is webhook-only.

## License

MIT
