# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to the default branch
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core runner invocation:

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
- Stripe account (optional, for billing)

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/soroushsaririan/RepoDoc
cd RepoDoc
npm install

# 2. Configure
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, BASE_URL

# 3. Setup (creates DB, verifies dependencies, creates demo customer)
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

## Environment variables

See `.env.example` for the full list. Required:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GITHUB_TOKEN` | GitHub PAT or app token (`repo` + `admin:repo_hook`) |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook signature validation |
| `BASE_URL` | Your deployed URL (used when registering webhooks) |
| `PORT` | Server port (default: `3000`) |

Stripe billing (optional):

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `PRICE_STARTER` / `PRICE_PRO` / `PRICE_TEAM` | Stripe price IDs |

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Health check |
| `POST` | `/api/customers` | Create a customer |
| `GET`  | `/api/customers` | List all customers |
| `POST` | `/api/customers/:id/repos` | Connect a repo (validates plan limits) |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo (removes webhook) |
| `POST` | `/api/repos/:repoId/trigger` | Manual documentation run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history |
| `GET`  | `/api/admin/stats` | System-wide stats |
| `POST` | `/webhook/github` | GitHub push event receiver |
| `POST` | `/webhook/stripe` | Stripe billing event receiver |

## Pricing tiers

| Plan | Repos | Cron | Monthly price |
|------|-------|------|---------------|
| Starter | 3 | Webhook only | $99/mo |
| Pro | 15 | Webhook + daily cron | $299/mo |
| Team | Unlimited | Webhook + daily cron | $799/mo |

Starter plan repos are skipped by the daily cron; they only run on push webhooks.

## Architecture

```
Trigger (GitHub push webhook / daily cron / manual API)
    ↓
Express server  (server.js)
    ├── Rate limiting: 100 req/15 min (API), 300 req/min (webhooks)
    └── Raw body capture for signature verification
    ↓
Webhook validation (webhook.js)
    ├── GitHub: HMAC-SHA256 signature check
    └── Stripe: stripe.webhooks.constructEvent
    ↓
In-memory job queue  (queue.js) — max 3 concurrent
    ↓
Claude Code runner  (runner.js)
    ├── Clones repo to ephemeral work directory
    ├── Resolves changed files (last 24 h or specific commit)
    ├── Builds focused CLAUDE.md prompt
    └── Spawns  claude -p --bare --output-format stream-json
    ↓
PR opened on customer's repo
    ↓
Job result persisted to SQLite  (db.js)
    └── Tracks status, tokens used, cost estimate, PR URL
```

### Key modules

| File | Role |
|------|------|
| `server.js` | Express entry point; mounts routes, starts cron |
| `api.js` | Internal REST router |
| `webhook.js` | GitHub + Stripe inbound handlers |
| `runner.js` | Claude Code subprocess orchestration |
| `queue.js` | Concurrency-limited job queue (in-memory) |
| `db.js` | SQLite persistence via better-sqlite3 |
| `github.js` | Octokit wrapper (webhooks, file diffs, repo metadata) |
| `cron.js` | Daily documentation pass for Pro/Team repos |
| `setup.js` | First-run dependency and environment check |

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all variables from `.env.example` in your Railway project dashboard. The `railway.json` in this repo configures the builder (Nixpacks), start command, health check path, and restart policy automatically.

### Self-hosted

Any Node.js 18+ host works. The app is a single process with no external dependencies beyond SQLite — no Redis, no separate worker process required (though `npm run worker` is available if you want to separate concerns).

## License

MIT
