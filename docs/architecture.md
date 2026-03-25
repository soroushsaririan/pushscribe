# Architecture

RepoDoc is a Node.js service with four main layers: HTTP server, job queue, Claude Code runner, and SQLite persistence.

## Request flow

```
GitHub push event
       │
       ▼
POST /webhook/github (webhook.js)
  1. Validate HMAC-SHA256 signature
  2. Filter: push to default branch only
  3. Look up repo in DB → get customer plan
  4. enqueue(repoId, { trigger: 'webhook', commitSha })
       │
       ▼
queue.js — in-memory FIFO
  • MAX_CONCURRENT slots (default 3)
  • Returns immediately; caller gets job ID
       │
       ▼
runner.js — runDocJob()
  1. git clone --depth 50 into WORK_DIR/<runId>/
  2. git config user.email/name (repodoc[bot])
  3. git diff-tree to discover changed source files
  4. Build prompt (scope depends on plan)
  5. Write .mcp.json + copy CLAUDE.md into work dir
  6. spawn: claude -p "<prompt>" --bare \
               --allowedTools "Read,Write,Bash(...)" \
               --output-format stream-json
  7. Parse stream-json → extract PR_URL, token counts
  8. rm -rf work dir
       │
       ▼
db.js — SQLite
  UPDATE jobs SET status='done', pr_url=..., tokens_used=..., cost_cents=...
```

## Components

### server.js

Express app. Mounts:
- `webhook.js` router at `/webhook`
- `api.js` router at `/api`
- Static `index.html` at `/`

Security: `express-rate-limit` on both `/api` (100/15 min) and `/webhook` (300/min). Raw body captured before JSON parsing so webhook HMAC can be verified against the original bytes.

### queue.js

Pure in-memory queue. No Redis required.

```js
// Enqueue a job
const jobId = await enqueue(repoId, { trigger: 'webhook', commitSha: 'abc123' })

// Get queue stats
const { waiting, running, maxConcurrent } = queueStats()
```

Jobs are also persisted to SQLite at enqueue time (status `queued`) so they survive a process restart in history, even if the in-flight run is lost.

### runner.js

The core engine. Key decisions:

**Shallow clone** — `git clone --depth 50` keeps clone times low for large repos. Enough history for `git diff-tree` on recent commits.

**Prompt scoping by plan**
- `starter` → `README.md` and `CHANGELOG.md` only
- `pro` / `team` → `README.md`, all `docs/` files, and `CHANGELOG.md`

**Allowed tools** passed to `claude --allowedTools`:
```
Read, Write,
Bash(git log *), Bash(git diff *), Bash(git diff-tree *),
Bash(git add *), Bash(git commit *), Bash(git checkout *),
Bash(git push *), Bash(git branch *),
Bash(date *), Bash(sort *),
Bash(find * -name "*.md"), Bash(find * -name "*.ts"),
Bash(find * -name "*.js"), Bash(find * -name "*.py"),
Bash(find * -name "*.go"),
Bash(cat *), Bash(ls *)
```

**MCP servers** injected per-run via `.mcp.json` written into the cloned repo directory:
- `@modelcontextprotocol/server-filesystem` — scoped to the work dir
- `@modelcontextprotocol/server-github` — for PR creation

**Cost estimation** — approximate, based on claude-sonnet-4 pricing:
- Input: $3.00 / 1M tokens
- Output: $15.00 / 1M tokens
- Stored as integer cents per job

**Hard timeout** — 10 minutes. Claude Code process is killed if it exceeds this.

### db.js

SQLite via `better-sqlite3` (synchronous API). WAL mode enabled for concurrent reads.

**Schema:**

```sql
customers (id, email, plan, stripe_id, status, created_at, updated_at)
repos     (id, customer_id, owner, name, full_name, default_branch, webhook_id, active, created_at)
jobs      (id, repo_id, trigger, commit_sha, status, pr_url, run_log,
           tokens_used, cost_cents, duration_ms, error,
           created_at, started_at, finished_at)
```

**Plan limits** enforced at repo-add time:

| Plan | Max repos |
|------|-----------|
| starter | 3 |
| pro | 15 |
| team | unlimited |

### cron.js

Runs once per day (triggered at server startup via `setInterval`). Iterates all active customers on Pro or Team plans and enqueues one job per active repo with `trigger: 'cron'`. Starter customers are webhook-only and skipped.

Can be forced via `POST /api/admin/cron`.

### webhook.js

Two handlers:

**GitHub** — validates `X-Hub-Signature-256` (HMAC-SHA256 over raw body), accepts only `push` events targeting the repo's default branch, looks up the repo by `owner/name`, enqueues a job.

**Stripe** — uses `stripe.webhooks.constructEvent()` for signature validation. Handles:
- `customer.subscription.created` / `updated` → update customer plan
- `invoice.payment_failed` → suspend customer
- `invoice.payment_succeeded` → reactivate customer

## Data directory

```
data/
  repodoc.db    ← SQLite database (auto-created)
```

Default path: `./data/repodoc.db`. Override with `DB_PATH` env var.

## Work directory

Each run gets an isolated temp directory: `WORK_DIR/<owner>-<name>-<timestamp>/`. It is always deleted after the run (success or failure). Default: `/tmp/repodoc-runs`.
