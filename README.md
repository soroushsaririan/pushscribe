# RepoDoc

**Living codebase documentation engine powered by Claude Code CLI.**

RepoDoc connects to your GitHub repositories and automatically rewrites your docs every time code changes. No human writing required.

## How it works

1. A GitHub webhook fires when code is pushed to the default branch
2. RepoDoc enqueues a job and responds to GitHub in <100ms
3. A headless `claude -p --bare` process clones the repo, reads what changed, rewrites the docs, and opens a PR
4. You merge the PR — done

The core invocation:

```bash
claude -p "<focused prompt>" \
  --bare \
  --allowedTools "Read,Write,Bash(git log *),Bash(git diff *),Bash(git add *),Bash(git commit *),Bash(git push *)" \
  --output-format stream-json
```

Claude Code runs inside the cloned repo with two MCP servers attached: `filesystem` (scoped to the work dir) and `github` (for PR creation).

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

# 3. Setup (checks dependencies, creates DB, creates demo customer)
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
| `GET`  | `/api/health` | Health check — uptime, queue depth, job stats |
| `POST` | `/api/customers` | Create a customer |
| `GET`  | `/api/customers` | List all customers |
| `GET`  | `/api/customers/:id` | Get a customer |
| `POST` | `/api/customers/:id/repos` | Connect a repo |
| `GET`  | `/api/customers/:id/repos` | List customer's repos |
| `DELETE` | `/api/customers/:id/repos/:repoId` | Disconnect a repo (removes webhook) |
| `POST` | `/api/repos/:repoId/trigger` | Manual doc run |
| `GET`  | `/api/repos/:repoId/jobs` | Job history (max 100, default 20) |
| `GET`  | `/api/repos/:repoId/jobs/:jobId` | Job detail |
| `GET`  | `/api/admin/stats` | System-wide stats |
| `GET`  | `/api/admin/jobs` | Last 50 jobs across all repos |
| `POST` | `/api/admin/cron/run` | Force a daily cron pass |
| `POST` | `/webhook/github` | GitHub push webhook receiver |
| `POST` | `/webhook/stripe` | Stripe subscription webhook receiver |

Rate limits: 100 requests / 15 min on `/api`; 300 requests / 1 min on `/webhook`.

## Pricing tiers

| Plan | Repos | Triggers |
|------|-------|---------|
| Starter | 3 | Webhook only |
| Pro | 15 | Webhook + daily cron |
| Team | Unlimited | Webhook + daily cron |

Daily cron runs 5 minutes after startup, then every 24 hours. Starter accounts are skipped by the cron — they only get triggered on push.

## Deployment

### Railway (recommended)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

`railway.json` is pre-configured: NIXPACKS build, `npm start` entrypoint, health check at `/api/health`, restart on failure (max 3 retries).

Set all environment variables from `.env.example` in the Railway project dashboard.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `GITHUB_TOKEN` | Yes | GitHub app token or PAT (`repo` + `admin:repo_hook`) |
| `GITHUB_WEBHOOK_SECRET` | Yes | Shared secret for HMAC webhook signature verification |
| `BASE_URL` | Yes | Your deployed URL (used when registering webhooks) |
| `STRIPE_SECRET_KEY` | Billing | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` | Billing | Stripe Price ID for Starter plan |
| `STRIPE_PRICE_PRO` | Billing | Stripe Price ID for Pro plan |
| `STRIPE_PRICE_TEAM` | Billing | Stripe Price ID for Team plan |
| `PORT` | No | HTTP port (default: `3000`) |
| `DB_PATH` | No | SQLite file path (default: `./data/repodoc.db`) |
| `WORK_DIR` | No | Ephemeral clone directory (default: `/tmp/repodoc-runs`) |
| `CLAUDE_BIN` | No | Path to Claude Code binary (default: `claude`) |
| `MAX_CONCURRENT` | No | Max parallel Claude Code processes (default: `3`) |
| `NODE_ENV` | No | Set to `test` to skip cron startup |

## Architecture

```
Trigger (webhook push / daily cron / manual API call)
    ↓
Express server  (server.js)
  - Raw body capture for signature verification
  - Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
  - Rate limiting
    ↓
Job queue  (src/queue.js)
  - In-memory FIFO, max MAX_CONCURRENT concurrent jobs
  - Job state persisted to SQLite throughout lifecycle
    ↓
Claude Code runner  (src/runner.js)
  1. git clone --depth 50 into ephemeral WORK_DIR
  2. Configure git identity + credential helper
  3. Discover changed files via git diff-tree / 24h log
  4. Write .mcp.json + copy CLAUDE.md into work dir
  5. Build focused prompt (scope varies by plan)
  6. Spawn: claude -p --bare --output-format stream-json
  7. Parse stream-json output → extract PR URL + token counts
  8. Estimate cost ($3.00/1M input, $15.00/1M output, claude-sonnet-4)
  9. rm -rf work dir
    ↓
SQLite database  (src/db.js)
  - Tables: customers, repos, jobs
  - WAL mode, foreign keys enabled
    ↓
PR opened on customer's repo
```

### Webhook flows

**GitHub (`POST /webhook/github`):** validates HMAC-SHA256 signature → only processes `push` events to the default branch → looks up registered repo → responds 202 immediately → enqueues job asynchronously.

**Stripe (`POST /webhook/stripe`):** handles `customer.subscription.created/updated` (updates plan), `customer.subscription.deleted` (cancels account), `invoice.payment_failed` (suspends account), `invoice.payment_succeeded` (reactivates suspended account).

## License

MIT
