# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to the default branch
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core is a single Claude Code invocation per run:

```bash
claude -p "<focused prompt>" \
  --bare \
  --allowedTools "Read,Write,Bash(git log *),Bash(git diff *),Bash(git add *),Bash(git commit *),Bash(git push *)" \
  --output-format stream-json
```

MCP servers (`@modelcontextprotocol/server-filesystem` and `@modelcontextprotocol/server-github`) are injected via a per-run `.mcp.json` written into the cloned workspace.

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview) (`npm install -g @anthropic-ai/claude-code`)
- Anthropic API key
- GitHub token with `repo` and `admin:repo_hook` scopes

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/soroushsaririan/repodoc
cd repodoc
npm install

# 2. Configure
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, etc.

# 3. Setup (creates DB and data dirs, checks dependencies)
npm run setup

# 4. Start
npm start
# → Dashboard at http://localhost:3000

# 5. Add a customer and connect a repo
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
| `GET`  | `/api/health` | Health check — uptime, queue stats, job counts |
| `POST` | `/api/customers` | Create a customer (idempotent by email) |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get one customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo and register a webhook |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo and remove its webhook |
| `POST` | `/api/repos/:repoId/trigger` | Enqueue a manual run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history (default 20, max 100) |
| `GET`  | `/api/repos/:repoId/jobs/:jobId` | Single job detail with run log |
| `GET`  | `/api/admin/stats` | System-wide stats |
| `GET`  | `/api/admin/jobs` | Last 50 jobs across all repos |
| `POST` | `/api/admin/cron/run` | Force an immediate daily cron pass |
| `POST` | `/webhook/github` | GitHub push webhook receiver |
| `POST` | `/webhook/stripe` | Stripe billing webhook receiver |

See [docs/api.md](docs/api.md) for full request/response shapes.

## Pricing tiers

| Plan | Price | Repos | Triggers |
|------|-------|-------|---------|
| Starter | $99/mo | 3 | Webhook only |
| Pro | $299/mo | 15 | Webhook + daily cron |
| Team | $799/mo | Unlimited | Webhook + daily cron + priority queue |

Starter plan documents `README.md` and `CHANGELOG.md` only. Pro and Team additionally update everything under `docs/`.

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all environment variables from `.env.example` in your Railway project dashboard. The `railway.json` at the repo root configures the build and start commands automatically.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `GITHUB_TOKEN` | Yes | GitHub PAT or App token (`repo` + `admin:repo_hook`) |
| `GITHUB_WEBHOOK_SECRET` | Yes | Shared secret for webhook HMAC validation |
| `BASE_URL` | Yes | Deployed URL used when registering webhooks |
| `STRIPE_SECRET_KEY` | Billing | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook signing secret |
| `PORT` | No | HTTP port (default `3000`) |
| `WORK_DIR` | No | Temp dir for cloned repos (default `/tmp/repodoc-runs`) |
| `MAX_CONCURRENT` | No | Max parallel Claude Code jobs (default `3`) |
| `STRIPE_PRICE_STARTER` | Billing | Stripe Price ID for Starter plan |
| `STRIPE_PRICE_PRO` | Billing | Stripe Price ID for Pro plan |
| `STRIPE_PRICE_TEAM` | Billing | Stripe Price ID for Team plan |

## Architecture

```
Trigger (GitHub webhook / daily cron / manual API call)
    ↓
Express server  (server.js)   — rate-limited, raw-body capture for HMAC
    ↓
Webhook handler (webhook.js)  — validates signature, checks default branch
    ↓
Job queue       (queue.js)    — in-memory FIFO, max 3 concurrent by default
    ↓
Runner          (runner.js)   — clones repo, builds prompt, spawns Claude Code
    ↓
claude -p --bare --output-format stream-json
    ↓
MCP servers: filesystem (read/write cloned repo) + github (open PR)
    ↓
PR opened on customer's repository
    ↓
Result persisted to SQLite  (db.js)   — customers / repos / jobs tables
```

Daily cron (`cron.js`) starts 5 minutes after server boot, then fires every 24 hours and enqueues one job per active Pro/Team repo.

See [docs/architecture.md](docs/architecture.md) for a deeper walkthrough.

## License

MIT
