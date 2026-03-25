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
| `POST` | `/api/customers` | Create a customer |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get a customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo |
| `POST` | `/api/repos/:repoId/trigger` | Manual run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history (default 20, max 100) |
| `GET`  | `/api/repos/:repoId/jobs/:jobId` | Get a specific job |
| `GET`  | `/api/admin/stats` | System stats |
| `GET`  | `/api/admin/jobs` | Recent jobs (last 50, with customer email) |
| `POST` | `/api/admin/cron/run` | Force a daily cron pass |
| `POST` | `/webhook/github` | GitHub webhook receiver |
| `POST` | `/webhook/stripe` | Stripe webhook receiver |
| `GET`  | `/api/health` | Health check with queue and job stats |

## Pricing tiers

| Plan | Price | Repos | Trigger |
|------|-------|-------|---------|
| Starter | $99/mo | 3 | Webhook only |
| Pro | $299/mo | 15 | Webhook + daily cron |
| Team | $799/mo | Unlimited | Webhook + daily cron |

Cron runs start 5 minutes after server startup, then repeat every 24 hours. Starter plan repos are webhook-triggered only.

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
| `GITHUB_TOKEN` | GitHub app token or PAT with `repo` + `admin:repo_hook` scopes |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook signature validation |
| `BASE_URL` | Your deployed URL (used when registering webhooks) |
| `STRIPE_SECRET_KEY` | Stripe secret key (for subscription management) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` | Stripe Price ID for the Starter plan |
| `STRIPE_PRICE_PRO` | Stripe Price ID for the Pro plan |
| `STRIPE_PRICE_TEAM` | Stripe Price ID for the Team plan |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `WORK_DIR` | `/tmp/repodoc-runs` | Where repos are cloned during runs |
| `DB_PATH` | `data/repodoc.db` | SQLite database path |
| `MAX_CONCURRENT` | `3` | Max simultaneous Claude Code processes |
| `NODE_ENV` | — | Set to `test` to suppress cron on startup |

## Architecture

```
Trigger (webhook / cron / manual)
    ↓
Express server (server.js)
    ↓
Job queue (queue.js) — max 3 concurrent (FIFO, in-memory)
    ↓
Claude Code runner (runner.js)
    ├─ git clone --depth 50
    ├─ Discovers changed files via git diff-tree
    ├─ Writes .mcp.json (filesystem + github MCP servers)
    └─ claude -p --bare --output-format stream-json
           ↓
       MCP servers: filesystem + github
           ↓
       PR opened on customer's repo
    ↓
Job result saved to SQLite (db.js)
```

### Data model

- **customers** — email, plan (`starter`|`pro`|`team`), stripe_id, status (`active`|`suspended`|`cancelled`)
- **repos** — owner, name, default_branch, webhook_id, active flag; scoped to a customer
- **jobs** — trigger type, commit SHA, status, PR URL, run log, token counts, cost in cents, duration

### Rate limiting

- `/api/*` — 100 requests per 15 minutes
- `/webhook/*` — 300 requests per minute

### Stripe integration

The `/webhook/stripe` endpoint handles:
- `customer.subscription.created/updated` — updates plan
- `customer.subscription.deleted` — marks customer `cancelled`
- `invoice.payment_failed` — marks customer `suspended`
- `invoice.payment_succeeded` — reactivates a suspended customer

## License

MIT
