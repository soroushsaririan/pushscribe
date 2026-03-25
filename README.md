# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to the default branch
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core is a single Claude Code invocation:

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
| `POST` | `/api/customers` | Create a customer (idempotent by email) |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get a single customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo |
| `POST` | `/api/repos/:repoId/trigger` | Manual run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history (max 100, default 20) |
| `GET`  | `/api/repos/:repoId/jobs/:jobId` | Single job detail |
| `GET`  | `/api/admin/stats` | System stats |
| `GET`  | `/api/admin/jobs` | Recent 50 jobs (all customers) |
| `POST` | `/api/admin/cron/run` | Force a daily cron pass |
| `POST` | `/webhook/github` | GitHub webhook receiver |
| `POST` | `/webhook/stripe` | Stripe webhook receiver |
| `GET`  | `/api/health` | Health check (queue + job stats) |

## Pricing tiers

| Plan | Price | Repos | Trigger |
|------|-------|-------|---------|
| Starter | $99/mo | 3 | Webhook only |
| Pro | $299/mo | 15 | Webhook + daily cron |
| Team | $799/mo | Unlimited | Webhook + daily cron |

## Environment variables

See `.env.example` for the full list. Required:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GITHUB_TOKEN` | GitHub app or PAT (`repo` + `admin:repo_hook` scopes) |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook HMAC-SHA256 validation |
| `BASE_URL` | Your deployed URL (used to register GitHub webhooks) |
| `STRIPE_SECRET_KEY` | Stripe secret key (optional, for billing) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `WORK_DIR` | Temp directory for repo clones (default: `/tmp/repodoc-runs`) |

Plan pricing (in cents): `PRICE_STARTER`, `PRICE_PRO`, `PRICE_TEAM`
Stripe Price IDs: `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all variables from `.env.example` in your Railway project dashboard. The app includes a `railway.json` with Nixpacks builder and health check at `/api/health`.

## Architecture

```
Trigger (webhook / cron / manual API)
    ↓
Express server  (server.js)
    ↓
Job queue       (queue.js)  — max 3 concurrent jobs
    ↓
Claude runner   (runner.js)
    ├── git clone --depth 50
    ├── writes .mcp.json + CLAUDE.md into work dir
    └── claude -p --bare --output-format stream-json
            ↓
        MCP servers: filesystem + github
            ↓
        PR opened on customer's repo
    ↓
Result saved    (db.js)  — SQLite with WAL mode
```

See [docs/architecture.md](docs/architecture.md) for a deeper dive.

## License

MIT
