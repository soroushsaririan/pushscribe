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
git clone https://github.com/yourname/repodoc
cd repodoc
npm install

# 2. Configure
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, etc.

# 3. Setup (creates DB, checks dependencies)
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
| `GET`  | `/api/health` | Health check with queue and job stats |
| `POST` | `/api/customers` | Create a customer |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get a single customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo |
| `POST` | `/api/repos/:repoId/trigger` | Manual run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history (default limit 20, max 100) |
| `GET`  | `/api/repos/:repoId/jobs/:jobId` | Get single job |
| `GET`  | `/api/admin/stats` | System stats |
| `GET`  | `/api/admin/jobs` | Last 50 jobs |
| `POST` | `/api/admin/cron/run` | Force a daily cron pass |
| `POST` | `/webhook/github` | GitHub push event receiver |
| `POST` | `/webhook/stripe` | Stripe billing event receiver |

## Pricing tiers

| Plan | Price | Repos | Trigger |
|------|-------|-------|---------|
| Starter | $99/mo | 3 | Webhook only |
| Pro | $299/mo | 15 | Webhook + daily cron |
| Team | $799/mo | Unlimited | Webhook + daily + priority |

Starter customers receive webhook-triggered runs only. Pro and Team plans also receive daily scheduled passes via cron.

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

See `.env.example` for a full list. Required:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GITHUB_TOKEN` | GitHub app or PAT (`repo` + `admin:repo_hook` scopes) |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook HMAC-SHA256 validation |
| `BASE_URL` | Your deployed URL (used when registering webhooks) |
| `STRIPE_SECRET_KEY` | Stripe secret key for billing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `WORK_DIR` | Temp dir for repo clones (default `/tmp/repodoc-runs`) |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | — | Set to `production` to enable all features |
| `PRICE_STARTER` | `9900` | Starter plan price in cents |
| `PRICE_PRO` | `29900` | Pro plan price in cents |
| `PRICE_TEAM` | `79900` | Team plan price in cents |

## Architecture

```
Trigger (webhook / cron / manual)
    ↓
Express server (server.js)
    ↓
Job queue (queue.js) — max 3 concurrent
    ↓
Claude Code runner (runner.js)
    ↓
claude -p --bare --output-format stream-json
    ↓
MCP servers: filesystem + github
    ↓
PR opened on customer's repo
    ↓
Job result saved to SQLite (db.js)
```

See [docs/architecture.md](docs/architecture.md) for a deeper walkthrough.

## License

MIT
