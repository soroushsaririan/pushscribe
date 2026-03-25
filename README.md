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
  --allowedTools "Read,Write,Bash(git log *),Bash(git diff *),Bash(git add *),Bash(git commit *),Bash(git push *)" \
  --output-format stream-json
```

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview) (`npm install -g @anthropic-ai/claude-code`)
- Anthropic API key
- GitHub token with `repo` + `admin:repo_hook` scopes

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/soroushsaririan/repodoc
cd repodoc
npm install

# 2. Configure
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, BASE_URL

# 3. Setup (checks dependencies, creates DB and demo customer)
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
| `GET`  | `/api/health` | Health check — queue depth, job stats |
| `POST` | `/api/customers` | Create or retrieve a customer |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get a customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo (registers GitHub webhook) |
| `GET`  | `/api/customers/:id/repos` | List customer repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo (removes webhook) |
| `POST` | `/api/repos/:repoId/trigger` | Manually trigger a doc run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history (default 20, max 100) |
| `GET`  | `/api/repos/:repoId/jobs/:jobId` | Get a single job |
| `GET`  | `/api/admin/stats` | System-wide stats |
| `GET`  | `/api/admin/jobs` | Last 50 jobs across all repos |
| `POST` | `/api/admin/cron/run` | Force a daily cron pass |
| `POST` | `/webhook/github` | GitHub push event receiver |
| `POST` | `/webhook/stripe` | Stripe subscription lifecycle receiver |

## Pricing tiers

| Plan | Price | Repos | Doc triggers |
|------|-------|-------|--------------|
| Starter | $99/mo | 3 | Webhook only |
| Pro | $299/mo | 15 | Webhook + daily cron |
| Team | $799/mo | Unlimited | Webhook + daily cron |

## Environment variables

See `.env.example` for a full list. Required:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GITHUB_TOKEN` | GitHub PAT or App token |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook HMAC validation |
| `BASE_URL` | Public URL for webhook registration (e.g. `https://your-app.up.railway.app`) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` | Stripe Price ID for Starter plan |
| `STRIPE_PRICE_PRO` | Stripe Price ID for Pro plan |
| `STRIPE_PRICE_TEAM` | Stripe Price ID for Team plan |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `WORK_DIR` | `/tmp/repodoc-runs` | Ephemeral clone directory |
| `DB_PATH` | `data/repodoc.db` | SQLite database path |
| `MAX_CONCURRENT` | `3` | Max parallel Claude Code processes |
| `CLAUDE_BIN` | `claude` | Path to Claude Code binary |

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all variables from `.env.example` in the Railway dashboard. The `railway.json` in this repo configures the Nixpacks build and health check automatically.

See [docs/deployment.md](docs/deployment.md) for full deployment instructions.

## Architecture

```
Trigger (webhook / cron / manual)
    ↓
Express server  (server.js)
    ↓
In-memory FIFO queue  (src/queue.js)  — max MAX_CONCURRENT jobs
    ↓
Claude Code runner  (src/runner.js)
  ├─ git clone --depth 50
  ├─ git diff-tree  →  changed file list
  ├─ writes .mcp.json + CLAUDE.md into work dir
  └─ claude -p --bare --output-format stream-json
        ↓
     MCP: filesystem + github
        ↓
     PR opened on customer repo
    ↓
Job result saved to SQLite  (src/db.js)
```

See [docs/architecture.md](docs/architecture.md) for a deeper walkthrough.

## License

MIT
