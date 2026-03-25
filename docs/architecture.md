# Architecture

RepoDoc is a Node.js service that automates documentation updates by running Claude Code against customer repositories. This document covers the major subsystems and how they connect.

## Request lifecycle

```
GitHub push
    → POST /webhook/github
        → signature validated (HMAC-SHA256)
        → repo looked up by owner/name
        → 202 returned immediately (GitHub timeout: 10s)
        → setImmediate: enqueue({ trigger: 'webhook', commitSha })
            → queue.js: job persisted to SQLite (status=queued)
            → waits for a free slot (MAX_CONCURRENT)
            → runner.js: clones repo, spawns claude, parses output
            → job updated to done/failed with PR URL and token cost
```

Cron and manual triggers follow the same path from `enqueue()` onward.

## Modules

### server.js

Entry point. Sets up Express with:
- Raw body capture (required for webhook signature verification)
- JSON + URL-encoded body parsing
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`)
- Rate limiting: 100 req/15 min on `/api`, 300 req/1 min on `/webhook`
- Routes: `/webhook` → `webhook.js`, `/api` → `api.js`
- Static file serving from `public/` with SPA catch-all
- Calls `startCron()` unless `NODE_ENV=test`

### src/queue.js

In-memory FIFO queue with concurrency cap.

```js
await enqueue({ repoId, trigger, commitSha })
// → returns jobId once the job has been accepted and started
```

- `MAX_CONCURRENT` env var controls parallelism (default 3)
- `queueStats()` returns `{ running, queued, max }`
- For production scale, replace with BullMQ + Redis

### src/runner.js

Runs a single documentation job end-to-end.

```js
const result = await runDocJob({ owner, name, defaultBranch, plan, commitSha, githubToken })
// result: { prUrl, runLog, tokensUsed, costCents, durationMs }
```

Steps:
1. `git clone --depth 50` into `WORK_DIR/<owner>-<name>-<timestamp>`
2. Configure git identity (`repodoc[bot]@repodoc.dev`) and credential helper
3. `git diff-tree` (or 24h log) to find changed source files
4. Write `.mcp.json` with filesystem and GitHub MCP servers
5. Copy `CLAUDE.md` from the RepoDoc working directory
6. Build prompt — scope depends on plan:
   - **Starter**: README.md + CHANGELOG.md
   - **Pro/Team**: README.md + docs/ + CHANGELOG.md
7. Spawn `claude -p <prompt> --bare --allowedTools ... --output-format stream-json`
8. Parse `stream-json` output: accumulate token counts, extract `PR_URL:` line
9. Estimate cost: $3.00/1M input + $15.00/1M output tokens
10. Delete work directory (always, even on failure)

Allowed tools passed to Claude Code:
- `Read`, `Write`
- `Bash(git log *)`, `Bash(git diff *)`, `Bash(git diff-tree *)`, `Bash(git add *)`, `Bash(git commit *)`, `Bash(git checkout *)`, `Bash(git push *)`, `Bash(git branch *)`
- `Bash(date *)`, `Bash(sort *)`, `Bash(find * -name "*.md")`, `Bash(find * -name "*.{ts,js,py,go}")`
- `Bash(cat *)`, `Bash(ls *)`

### src/db.js

SQLite persistence via `better-sqlite3`. WAL mode enabled for concurrent reads.

Database path: `DB_PATH` env var or `data/repodoc.db`.

**Tables:**

`customers` — `id`, `email`, `plan` (starter|pro|team), `stripe_id`, `status` (active|suspended|cancelled)

`repos` — `id`, `customer_id`, `owner`, `name`, `full_name`, `default_branch`, `webhook_id`, `active`

`jobs` — `id`, `repo_id`, `trigger` (webhook|cron|manual), `commit_sha`, `status` (queued|running|done|failed), `pr_url`, `run_log`, `tokens_used`, `cost_cents`, `duration_ms`, `error`, timestamps

Plan limits enforced in `repos.canAddRepo()`:
- Starter: 3 repos
- Pro: 15 repos
- Team: unlimited

### src/github.js

Thin Octokit wrapper.

| Function | Description |
|----------|-------------|
| `createGitHubClient(token)` | Returns Octokit instance; falls back to `GITHUB_TOKEN` env var |
| `registerWebhook({ owner, name, token })` | Creates push webhook pointing at `BASE_URL/webhook/github`; returns webhook ID |
| `removeWebhook({ owner, name, webhookId, token })` | Deletes the webhook |
| `getRepoInfo({ owner, name, token })` | Returns `{ defaultBranch, private, description, language }` |
| `getCommitFiles({ owner, name, commitSha, token })` | Returns list of filenames changed in a commit |
| `verifyWebhookSignature(rawBody, signatureHeader)` | HMAC-SHA256 constant-time comparison; returns `true` if valid |

### src/webhook.js

**GitHub** (`POST /webhook/github`):
- Validates `X-Hub-Signature-256` header
- Ignores non-`push` events and pushes to non-default branches
- Returns 202 immediately, enqueues job via `setImmediate`

**Stripe** (`POST /webhook/stripe`):
- Maps Stripe Price IDs (`STRIPE_PRICE_STARTER/PRO/TEAM`) to plan names
- `subscription.created/updated` → `customers.updatePlan()`
- `subscription.deleted` → `customers.updateStatus('cancelled')`
- `invoice.payment_failed` → `customers.updateStatus('suspended')`
- `invoice.payment_succeeded` → `customers.updateStatus('active')` (if previously suspended)

### src/cron.js

Daily documentation pass for Pro and Team customers.

```js
startCron()  // called once at startup; fires after 5-min delay, then every 24h
stopCron()   // clears the interval
runDailyPass() // exported for admin/cron/run endpoint
```

Starter plan customers are skipped — they receive webhook-only doc updates.

## Data flow diagram

```
┌──────────────┐     push     ┌─────────────────────┐
│   GitHub     │ ──────────► │  POST /webhook/github │
└──────────────┘             └──────────┬────────────┘
                                        │ enqueue()
                             ┌──────────▼────────────┐
┌──────────────┐   sub event │                       │
│   Stripe     │ ──────────► │  SQLite (jobs table)  │
└──────────────┘             │  status: queued        │
                             └──────────┬────────────┘
                                        │ drain()
                             ┌──────────▼────────────┐
                             │   runner.js            │
                             │   claude -p --bare     │
                             │   status: running      │
                             └──────────┬────────────┘
                                        │
                             ┌──────────▼────────────┐
                             │  GitHub PR opened      │
                             │  SQLite: status=done   │
                             │  pr_url, cost_cents    │
                             └───────────────────────┘
```
