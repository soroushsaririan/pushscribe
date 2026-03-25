# Architecture

RepoDoc is a Node.js service that turns code pushes into documentation PRs. This document walks through each layer.

## Request lifecycle

```
GitHub push event
    → POST /webhook/github
    → signature verified (HMAC-SHA256)
    → job enqueued (queue.js)
    → HTTP 200 returned immediately

Job queue (in-memory FIFO)
    → dequeued when a worker slot is free (max 3 concurrent)
    → runner.js clones repo to WORK_DIR/<uuid>
    → builds prompt from changed files + plan tier
    → spawns: claude -p "<prompt>" --bare --output-format stream-json
    → stream parsed for PR URL + token usage
    → work directory deleted (finally block)
    → job record updated in SQLite
```

## Modules

### `server.js`
Entry point. Mounts:
- `POST /webhook/github` and `POST /webhook/stripe` — raw body preserved for signature checks
- `/api/*` — REST API router
- `GET /` — serves `index.html` dashboard

Rate limits: 100 req/15 min on `/api`, 300 req/60 s on `/webhook`.

Security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, strict CSP.

Starts the cron scheduler on boot (unless `NODE_ENV=test`).

### `queue.js`
In-memory FIFO queue. Key behaviours:
- `enqueue(repoId, trigger, commitSha)` — validates repo/customer exist and are active, creates a job record, then either runs immediately or parks in the queue
- Concurrency is controlled by a `running` counter against `MAX_CONCURRENT` (default 3, overridable via env)
- After each job finishes (success or failure), the next queued item is dequeued automatically
- `queueStats()` returns `{ running, queued, maxConcurrent }`
- `triggerAllRepos()` enqueues every active repo — used by the cron

### `runner.js`
Executes one documentation job:

1. Fetches repo and customer records from SQLite
2. Clones the repo into `WORK_DIR/<uuid>` using `simple-git`
3. Optionally checks out the triggering commit SHA
4. Calls `github.getCommitFiles()` to get the changed file list
5. Builds a prompt that names the changed files and references `CLAUDE.md` instructions
6. Writes a per-run `.mcp.json` (filesystem + GitHub MCP servers)
7. Spawns `claude -p <prompt> --bare --output-format stream-json` as a child process
8. Parses newline-delimited JSON from stdout; extracts `pr_url` and token counts from `result` events
9. Estimates cost: `(inputTokens * $3 + outputTokens * $15) / 1_000_000` (claude-sonnet-4 rates)
10. Cleans up the work directory regardless of outcome

### `db.js`
SQLite via `better-sqlite3`. Three tables:

**customers**
```
id TEXT PRIMARY KEY
email TEXT UNIQUE
plan TEXT  -- 'starter' | 'pro' | 'team'
stripe_id TEXT
status TEXT  -- 'active' | 'inactive' | 'past_due'
created_at TEXT
```

**repos**
```
id TEXT PRIMARY KEY
customer_id TEXT → customers.id
owner TEXT
name TEXT
full_name TEXT  -- owner/name
default_branch TEXT
webhook_id INTEGER
active INTEGER  -- 0 | 1
created_at TEXT
```

**jobs**
```
id TEXT PRIMARY KEY
repo_id TEXT → repos.id
trigger TEXT  -- 'webhook' | 'cron' | 'manual'
status TEXT   -- 'queued' | 'running' | 'done' | 'failed'
pr_url TEXT
run_log TEXT
tokens INTEGER
cost REAL
duration INTEGER  -- ms
created_at TEXT
started_at TEXT
completed_at TEXT
```

WAL mode is enabled for better read/write concurrency. Foreign keys are enforced.

### `github.js`
Thin wrapper around `@octokit/rest`:

- `registerWebhook(owner, name)` — creates a push webhook pointing to `BASE_URL/webhook/github`
- `removeWebhook(owner, name, webhookId)` — deletes the webhook
- `getRepoInfo(owner, name)` — returns `{ default_branch, private, description, language }`
- `getCommitFiles(owner, name, sha)` — lists filenames changed in a commit
- `verifyWebhookSignature(payload, signature)` — constant-time HMAC-SHA256 comparison

### `webhook.js`
Two handlers:

**GitHub** (`POST /webhook/github`)
- Validates `X-Hub-Signature-256` header
- Ignores non-push events and pushes to non-default branches
- Calls `queue.enqueue(repoId, 'webhook', commitSha)`

**Stripe** (`POST /webhook/stripe`)
- Validates `Stripe-Signature` header using `stripe.webhooks.constructEvent`
- Maps Stripe Price IDs to plan names via `PRICE_STARTER` / `PRICE_PRO` / `PRICE_TEAM` env vars
- Handled events:
  - `customer.subscription.created` / `updated` — updates plan and sets status `active`
  - `customer.subscription.deleted` — sets status `inactive`
  - `invoice.payment_failed` — sets status `past_due`
  - `invoice.payment_succeeded` — sets status `active`

### `cron.js`
Runs once per day:
- 5-minute warm-up delay on first start
- Calls `queue.triggerAllRepos()` which enqueues all active repos
- Only Pro and Team customers are eligible (Starter skipped)

### `api.js`
All routes are under `/api`. Notable details:

- `POST /customers` — creates customer with `plan` defaulting to `'starter'`
- `POST /customers/:id/repos` — calls `db.getRepoCountForCustomer()` against plan limits before proceeding; calls `github.registerWebhook()` and `github.getRepoInfo()` to populate `default_branch`
- `DELETE /customers/:id/repos/:repoId` — calls `github.removeWebhook()` before deleting DB record
- `GET /health` — returns `{ status, uptime, queue, jobs }` where `jobs` has counts by status

## Dashboard (`index.html`)

Vanilla JS SPA served from the root route. Polls `/api/health` every 15 seconds to refresh queue depth and stat cards. All data fetched from `/api` endpoints — no bundler, no framework.

## Concurrency model

The server is single-process Node.js. The job queue is in-memory; restarting the server loses queued (not yet started) jobs. Running jobs are tracked as SQLite records with `status='running'` — on restart these are stale and should be manually re-triggered if needed.

For high-volume deployments, replace the in-memory queue with a durable queue (e.g. BullMQ + Redis) and run multiple worker processes.
