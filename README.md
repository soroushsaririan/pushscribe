# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to `main`
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core is a single Claude Code invocation:

```bash
claude -p "<focused prompt>" \
  --bare \
  --allowedTools "Read,Write,Bash(git log *),Bash(git diff *),Bash(git add *),Bash(git commit *),Bash(git push *),..." \
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
| `GET`  | `/api/health` | Health check |
| `POST` | `/api/customers` | Create a customer |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo |
| `POST` | `/api/repos/:repoId/trigger` | Manual run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history |
| `GET`  | `/api/jobs/:jobId` | Job detail |
| `GET`  | `/api/admin/stats` | System stats |
| `GET`  | `/api/admin/jobs` | Recent jobs (admin) |
| `POST` | `/api/admin/cron` | Force cron run |
| `POST` | `/webhook/github` | GitHub webhook receiver |
| `POST` | `/webhook/stripe` | Stripe webhook receiver |

## Pricing tiers

| Plan | Price | Repos | Trigger |
|------|-------|-------|---------|
| Starter | $99/mo | 3 | Webhook only (README + CHANGELOG) |
| Pro | $299/mo | 15 | Webhook + daily cron (README + docs/ + CHANGELOG) |
| Team | $799/mo | Unlimited | Webhook + daily cron + priority (full docs) |

Starter plan runs document only `README.md` and `CHANGELOG.md`. Pro and Team plans also update everything under `docs/`.

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

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `GITHUB_TOKEN` | Yes | GitHub PAT or App token (`repo` + `admin:repo_hook` scopes) |
| `GITHUB_WEBHOOK_SECRET` | Yes | Shared secret for webhook HMAC validation |
| `BASE_URL` | Yes | Your deployed URL (used when registering webhooks) |
| `STRIPE_SECRET_KEY` | For billing | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | For billing | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` | For billing | Stripe Price ID for Starter plan |
| `STRIPE_PRICE_PRO` | For billing | Stripe Price ID for Pro plan |
| `STRIPE_PRICE_TEAM` | For billing | Stripe Price ID for Team plan |
| `PORT` | No | HTTP port (default: 3000) |
| `WORK_DIR` | No | Temp directory for repo clones (default: `/tmp/repodoc-runs`) |
| `DB_PATH` | No | SQLite file path (default: `./data/repodoc.db`) |
| `NODE_ENV` | No | `production` or `development` |

## Architecture

```
Trigger (webhook / cron / manual)
    ↓
Express server (server.js)  — rate limited, security headers
    ↓
Job queue (queue.js) — max 3 concurrent, FIFO
    ↓
Claude Code runner (runner.js)
    ├── git clone --depth 50
    ├── discover changed files (git diff-tree)
    ├── build focused prompt
    └── spawn: claude -p --bare --output-format stream-json
                ↓
           MCP servers: filesystem + github
                ↓
           PR opened on customer's repo
    ↓
Job result saved to SQLite (db.js)
  — pr_url, tokens_used, cost_cents, duration_ms
```

See [docs/architecture.md](docs/architecture.md) for a deeper walkthrough.

## License

MIT
