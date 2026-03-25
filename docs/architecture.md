# Architecture

RepoDoc is a Node.js service that keeps documentation in sync with code by running Claude Code against your repository on every push.

## Request lifecycle

```
GitHub push
  → POST /webhook/github          (webhook.js)
  → signature verified (HMAC-SHA256)
  → ref checked against default branch
  → repo looked up in SQLite
  → customer status checked (must be 'active')
  → 202 accepted immediately (GitHub requires <10s response)
  → setImmediate: enqueue({ repoId, trigger: 'webhook', commitSha })

enqueue()                          (queue.js)
  → job record created in SQLite (status: queued)
  → wait for free concurrency slot (max MAX_CONCURRENT, default 3)
  → executeJob()

executeJob()                       (queue.js → runner.js)
  → job status → running
  → runDocJob()
  → job status → done or failed

runDocJob()                        (runner.js)
  → git clone --depth 50 into /tmp/repodoc-runs/<run-id>
  → git diff-tree to find changed files
  → write .mcp.json (filesystem + github MCP servers)
  → copy CLAUDE.md from server working dir
  → build prompt (scoped to plan)
  → spawn: claude -p --bare --output-format stream-json
  → parse stream-json output → PR URL, token counts
  → rmSync work dir
  → return { prUrl, tokensUsed, costCents, durationMs }
```

## Key modules

### `server.js`

Express entry point. Responsibilities:
- Raw body capture (required for webhook signature verification — must run before `express.json()`)
- Security headers on every response
- Rate limiting: API 100 req/15 min, webhooks 300 req/min
- Mounts `/webhook`, `/api`, and static SPA fallback
- Starts the daily cron scheduler on boot (skipped in `NODE_ENV=test`)

### `db.js`

SQLite via `better-sqlite3` (synchronous API). WAL mode enabled for concurrent reads. Three tables:

**customers**
```
id, email, plan (starter|pro|team), stripe_id, status (active|suspended|cancelled), created_at, updated_at
```

**repos**
```
id, customer_id → customers.id, owner, name, full_name, default_branch, webhook_id, active, created_at
```
Plan limits enforced at insert time: starter=3 repos, pro=15, team=unlimited.

**jobs**
```
id, repo_id → repos.id, trigger (webhook|cron|manual), commit_sha,
status (queued|running|done|failed), pr_url, run_log (capped at 50KB),
tokens_used, cost_cents, duration_ms, error, created_at, started_at, finished_at
```

Indexes on `jobs(repo_id)`, `jobs(status)`, `repos(customer_id)`.

### `queue.js`

In-memory FIFO queue. `enqueue()` returns a Promise that resolves after the job *starts* (not finishes). The caller gets back the job ID immediately and the job runs in the background.

`drain()` fires whenever a slot opens — it shifts items off `waitQueue` and calls `executeJob()`. The `running` counter is decremented in a `.finally()` so it's always consistent.

For production scale, swap the in-memory queue for BullMQ + Redis while keeping the same `enqueue()` signature.

### `runner.js`

The documentation engine. Key decisions:

- **`--depth 50`**: Shallow clone to keep clone times fast. Deep enough for `git diff-tree` on recent commits.
- **`--bare` flag**: Claude Code runs non-interactively; no TTY, no prompts.
- **`--output-format stream-json`**: Each output event is a JSON line. The runner accumulates stdout and parses it after the process exits, extracting PR URL from any line matching `PR_URL: https://github.com/...`.
- **Allowed tools**: Tightly scoped — only Read, Write, specific `Bash(git ...)` patterns, and find/cat/ls. No arbitrary shell execution.
- **MCP servers**: filesystem (scoped to the work dir) and github (for PR creation). Written into `.mcp.json` in the work dir so Claude Code picks them up automatically.
- **Cost tracking**: Input tokens billed at $3.00/M, output at $15.00/M (claude-sonnet-4 rates). Result stored in `jobs.cost_cents`.
- **10-minute timeout**: Hard ceiling on the Claude Code process. Jobs that exceed it fail with a non-zero exit code.
- **Cleanup**: Work dir is always deleted in the `finally` block, even if the job fails.

### `github.js`

Thin Octokit wrapper. Uses customer-provided token if supplied, falls back to the server-level `GITHUB_TOKEN`. Functions:

- `registerWebhook` — creates a `push` webhook pointing to `${BASE_URL}/webhook/github`
- `removeWebhook` — deletes a previously registered webhook by ID
- `getRepoInfo` — returns `defaultBranch`, `private`, `description`, `language`
- `getCommitFiles` — lists filenames changed in a specific commit SHA
- `verifyWebhookSignature` — HMAC-SHA256 constant-time comparison against `GITHUB_WEBHOOK_SECRET`

### `cron.js`

Uses `setInterval` (not node-cron). On `startCron()`:
1. Waits 5 minutes (lets the server fully boot and process any pending webhooks)
2. Calls `runDailyPass()` immediately
3. Schedules `runDailyPass()` every 24 hours

`runDailyPass()` skips Starter customers — they only get webhook-triggered runs.

### `webhook.js`

Two routes:

**`POST /webhook/github`**
1. Verify HMAC-SHA256 signature (rejects 401 if invalid)
2. Ignore all events except `push`
3. Ignore pushes to non-default branches
4. Respond 202 before enqueuing (GitHub's 10-second timeout)
5. Enqueue via `setImmediate` to avoid blocking the response

**`POST /webhook/stripe`**
Handles four event types:
- `customer.subscription.created/updated` → update plan via Price ID → plan name mapping
- `customer.subscription.deleted` → set status to `cancelled`
- `invoice.payment_failed` → set status to `suspended`
- `invoice.payment_succeeded` → reactivate if previously `suspended`

## Data flow diagram

```
                    ┌─────────────┐
                    │  GitHub     │
                    │  (push)     │
                    └──────┬──────┘
                           │ POST /webhook/github
                    ┌──────▼──────┐     ┌────────────┐
                    │  webhook.js │────▶│  queue.js  │
                    └─────────────┘     └─────┬──────┘
                                              │
                    ┌──────────────────────────▼──────┐
                    │           runner.js              │
                    │  git clone → claude -p --bare   │
                    │  → stream-json → parse PR URL   │
                    └──────────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
      ┌───────▼──────┐   ┌─────────▼──────┐   ┌────────▼───────┐
      │  SQLite db   │   │ GitHub MCP     │   │ filesystem MCP │
      │  (jobs table)│   │ (create PR)    │   │ (read/write)   │
      └──────────────┘   └────────────────┘   └────────────────┘
```
