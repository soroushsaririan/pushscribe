# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to the default branch
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core is a single Claude Code command run inside an ephemeral clone of your repo:

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
- (Optional) Stripe account for subscription billing

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/soroushsaririan/repodoc
cd repodoc
npm install

# 2. Configure
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, BASE_URL

# 3. First-run setup (checks deps, creates DB, creates demo customer)
npm run setup

# 4. Start
npm start
# → Dashboard at http://localhost:3000
# → API at http://localhost:3000/api

# 5. Create a customer and connect a repo
curl -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"email":"you@co.com","plan":"pro"}'

curl -X POST http://localhost:3000/api/customers/<id>/repos \
  -H "Content-Type: application/json" \
  -d '{"owner":"yourorg","name":"yourrepo","github_token":"ghp_..."}'

# 6. Trigger a manual run
curl -X POST http://localhost:3000/api/repos/<repo-id>/trigger
```

## Environment variables

Copy `.env.example` to `.env`. Required variables:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GITHUB_TOKEN` | GitHub PAT or App token (`repo` + `admin:repo_hook` scopes) |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook HMAC-SHA256 signature validation |
| `BASE_URL` | Your deployed URL (used when registering webhooks, e.g. `https://your-app.up.railway.app`) |
| `PORT` | HTTP port (default: `3000`) |
| `DB_PATH` | SQLite file path (default: `data/repodoc.db`) |
| `WORK_DIR` | Directory for ephemeral repo clones (default: `/tmp/repodoc-runs`) |
| `MAX_CONCURRENT` | Max simultaneous Claude Code processes (default: `3`) |
| `STRIPE_SECRET_KEY` | Stripe secret key (optional, for billing) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (optional) |
| `STRIPE_PRICE_STARTER` | Stripe Price ID for the Starter plan |
| `STRIPE_PRICE_PRO` | Stripe Price ID for the Pro plan |
| `STRIPE_PRICE_TEAM` | Stripe Price ID for the Team plan |

## API reference

All endpoints are under `/api`. Rate limit: 100 requests per 15 minutes.

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/health` | Server health, queue stats, job counters |
| `POST`   | `/api/customers` | Create a customer (idempotent by email) |
| `GET`    | `/api/customers` | List all customers |
| `GET`    | `/api/customers/:id` | Get a customer |
| `POST`   | `/api/customers/:customerId/repos` | Connect a GitHub repo |
| `GET`    | `/api/customers/:customerId/repos` | List customer's repos |
| `DELETE` | `/api/customers/:customerId/repos/:repoId` | Disconnect a repo (removes webhook) |
| `GET`    | `/api/repos/:repoId/jobs` | Job history (default 20, max 100 via `?limit=`) |
| `GET`    | `/api/repos/:repoId/jobs/:jobId` | Get a specific job |
| `POST`   | `/api/repos/:repoId/trigger` | Manually enqueue a doc run |
| `GET`    | `/api/admin/stats` | Aggregate stats: customers, jobs, queue |
| `GET`    | `/api/admin/jobs` | 50 most recent jobs across all customers |
| `POST`   | `/api/admin/cron/run` | Force an immediate daily cron pass |

Webhook endpoints (rate limit: 300 req/min):

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook/github` | Receives GitHub `push` events |
| `POST` | `/webhook/stripe` | Receives Stripe subscription/invoice events |

## Pricing tiers

| Plan | Repos | Triggers | Monthly (env var) |
|------|-------|----------|-------------------|
| Starter | 3 | Webhook on push | `PRICE_STARTER` ($99) |
| Pro | 15 | Webhook + daily cron | `PRICE_PRO` ($299) |
| Team | Unlimited | Webhook + daily cron | `PRICE_TEAM` ($799) |

Starter customers only get webhook-triggered runs. Pro and Team get an additional daily cron pass that runs 5 minutes after startup and every 24 hours thereafter.

## Architecture

```
Trigger (webhook / cron / manual)
    ↓
Express server  server.js
    ↓
Job queue  queue.js   — max MAX_CONCURRENT concurrent (default 3)
    ↓
Claude Code runner  runner.js
  - git clone --depth 50
  - build focused prompt (changed files, plan scope)
  - spawn: claude -p --bare --output-format stream-json
  - MCP servers: filesystem + github
  - parse stream-json → extract PR URL, token usage, cost
  - cleanup ephemeral work dir
    ↓
PR opened on customer's repo
    ↓
Job result saved to SQLite  db.js
```

See [`docs/architecture.md`](docs/architecture.md) for detailed subsystem descriptions.

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Railway config is in `railway.json`. The health check endpoint is `GET /api/health`.

Set all environment variables from `.env.example` in your Railway project dashboard.

### Docker / other platforms

```bash
npm start          # production
npm run dev        # development (--watch)
```

The server uses SQLite so there is no external database to provision. Persist the `data/` directory across deploys (or set `DB_PATH` to a mounted volume).

## License

MIT
