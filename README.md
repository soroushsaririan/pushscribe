# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to the default branch
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core invocation in `runner.js`:

```bash
claude -p "<focused prompt>" \
  --bare \
  --allowedTools "Read,Write,Bash(git log *),Bash(git diff *),Bash(git add *),Bash(git commit *),Bash(git push *),Bash(git clone *),Bash(git checkout *),Bash(find *),Bash(ls *)" \
  --output-format stream-json
```

MCP servers (filesystem + GitHub) are injected per-run so Claude can read files and create PRs directly.

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview) (`npm install -g @anthropic-ai/claude-code`)
- Anthropic API key
- GitHub token (with `repo` + `admin:repo_hook` scopes)
- Stripe account (optional, for billing)

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/soroushsaririan/repodoc
cd repodoc
npm install

# 2. Configure
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, BASE_URL

# 3. Setup (checks dependencies, creates DB and work dirs, seeds demo customer)
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
| `GET`  | `/api/health` | Uptime, queue stats, job counts |
| `POST` | `/api/customers` | Create a customer |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get a single customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo (registers GitHub webhook) |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo (removes webhook) |
| `GET`  | `/api/repos/:repoId/jobs` | Job history for a repo |
| `POST` | `/api/repos/:repoId/trigger` | Manual documentation run |
| `GET`  | `/api/admin/stats` | Aggregate system stats |
| `GET`  | `/api/admin/jobs` | Recent jobs across all repos |
| `POST` | `/api/admin/cron` | Manually trigger the daily cron pass |
| `POST` | `/webhook/github` | GitHub push webhook receiver |
| `POST` | `/webhook/stripe` | Stripe subscription webhook receiver |

## Pricing tiers

| Plan | Price | Repos | Triggers |
|------|-------|-------|---------|
| Starter | $99/mo | 3 | Webhook only |
| Pro | $299/mo | 15 | Webhook + daily cron |
| Team | $799/mo | Unlimited | Webhook + daily cron + priority |

Limits are enforced at repo-add time in `api.js`. The daily cron (`cron.js`) skips Starter customers.

## Environment variables

See `.env.example` for the full list. Required at minimum:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API key for running Claude Code |
| `GITHUB_TOKEN` | PAT or GitHub App token (`repo` + `admin:repo_hook`) |
| `GITHUB_WEBHOOK_SECRET` | HMAC-SHA256 secret shared with GitHub |
| `BASE_URL` | Your deployed URL (used when registering webhooks) |

Optional:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP server port |
| `WORK_DIR` | `/tmp/repodoc-work` | Scratch space for repo clones |
| `STRIPE_SECRET_KEY` | — | Stripe billing integration |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signature validation |
| `PRICE_STARTER` / `PRICE_PRO` / `PRICE_TEAM` | — | Stripe Price IDs for each tier |

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all variables from `.env.example` in the Railway project dashboard. The included `railway.json` configures:
- NIXPACKS builder
- Health check at `/api/health` (30s timeout)
- Restart on failure (max 3 retries)

## Architecture

```
Trigger (push webhook / daily cron / manual API)
    ↓
Express server  (server.js)
    ↓
Job queue       (queue.js)  — max 3 concurrent, in-memory FIFO
    ↓
Claude runner   (runner.js) — clones repo, builds prompt, spawns claude
    ↓
claude -p --bare --output-format stream-json
    ↓
MCP servers: filesystem + github
    ↓
PR opened on customer's repo
    ↓
Job result saved to SQLite  (db.js)
```

See [`docs/architecture.md`](docs/architecture.md) for a deeper walkthrough.

## License

MIT
