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
| `POST` | `/api/customers/:id/repos` | Connect a repo |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo |
| `POST` | `/api/repos/:repoId/trigger` | Manual run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history |
| `GET`  | `/api/admin/stats` | System stats |
| `POST` | `/webhook/github` | GitHub webhook receiver |
| `POST` | `/webhook/stripe` | Stripe webhook receiver |
| `GET`  | `/api/health` | Health check |

## Pricing tiers

| Plan | Price | Repos | Trigger |
|------|-------|-------|---------|
| Starter | $99/mo | 3 | Webhook only |
| Pro | $299/mo | 15 | Webhook + daily cron |
| Team | $799/mo | Unlimited | Webhook + daily + priority |

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

- `ANTHROPIC_API_KEY` — Claude API key
- `GITHUB_TOKEN` — GitHub app or PAT
- `GITHUB_WEBHOOK_SECRET` — Shared secret for webhook signature validation
- `BASE_URL` — Your deployed URL (for webhook registration)

## Architecture

```
Trigger (webhook / cron / manual)
    ↓
Express server (server.js)
    ↓
Job queue (src/queue.js) — max 3 concurrent
    ↓
Claude Code runner (src/runner.js)
    ↓
claude -p --bare --output-format stream-json
    ↓
MCP servers: filesystem + github
    ↓
PR opened on customer's repo
    ↓
Job result saved to SQLite (src/db.js)
```

## License

MIT
