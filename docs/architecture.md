# Architecture

## Overview

RepoDoc is a Node.js service that automates documentation updates by running Claude Code against changed repos. It is designed to be stateless at the process level — all state lives in a SQLite file (`data/repodoc.db`) and ephemeral work directories under `WORK_DIR`.

## Request flow

```
GitHub push event
    │
    ▼
POST /webhook/github (webhook.js)
  • Verify HMAC-SHA256 signature
  • Ignore non-default-branch pushes
  • Look up repo in DB
  • Check customer is active
  • Respond 202 immediately
    │
    ▼ (async)
queue.enqueue({ repoId, trigger:'webhook', commitSha })  (queue.js)
  • Create job row (status: queued)
  • Drain queue if capacity available
    │
    ▼
runner.runJob(jobId, repo, customer)  (runner.js)
  • Clone repo into WORK_DIR/<runId>
  • Discover changed files (git diff-tree for webhook, 24h window for cron)
  • Write .mcp.json (filesystem + github MCP servers)
  • Copy CLAUDE.md into work dir
  • Build focused prompt (scope depends on plan)
  • Spawn: claude -p "<prompt>" --bare --output-format stream-json
  • Parse stream-json: extract PR URL, count tokens, estimate cost
  • Clean up work dir (finally block)
    │
    ▼
db.jobs.complete / db.jobs.fail  (db.js)
  • Persist prUrl, runLog, tokensUsed, costCents, durationMs
```

## Concurrency

`queue.js` maintains:
- `running` — Set of actively executing job IDs
- `waitQueue` — Array of pending `{ jobId, repo, customer }` objects
- `MAX_CONCURRENT` — Default 3; controls how many `claude` processes run in parallel

`drain()` is called after every job finishes, so the queue self-replenishes.

## Database schema

```sql
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'starter',       -- starter | pro | team
  stripe_id TEXT,
  status TEXT DEFAULT 'active',      -- active | suspended | cancelled
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,           -- owner/name
  default_branch TEXT DEFAULT 'main',
  webhook_id INTEGER,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  repo_id TEXT REFERENCES repos(id),
  trigger TEXT,                      -- webhook | cron | manual
  commit_sha TEXT,
  status TEXT DEFAULT 'queued',      -- queued | running | completed | failed
  pr_url TEXT,
  run_log TEXT,
  tokens_used INTEGER,
  cost_cents INTEGER,
  duration_ms INTEGER,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);
```

Indexes: `jobs(repo_id)`, `jobs(status)`, `repos(customer_id)`.

## Runner prompt scoping

The prompt sent to Claude varies by plan:

| Plan | Docs scope |
|------|-----------|
| starter | README.md + CHANGELOG.md only |
| pro / team | README.md + docs/ directory + CHANGELOG.md |

This controls both what Claude is asked to update and what MCP filesystem paths are exposed.

## Cost tracking

Token usage is extracted from the `stream-json` output of `claude -p`. Costs are calculated using Claude Sonnet 4 pricing:

- Input: $3.00 / 1M tokens
- Output: $15.00 / 1M tokens

Cost in cents is stored per job in `jobs.cost_cents`.

## Cron scheduling

`cron.js` runs a daily pass that enqueues jobs for all active repos belonging to pro and team customers. Timing:

- First run: 5 minutes after process startup
- Subsequent runs: every 24 hours

Starter customers are skipped (webhook-only plan).

## MCP server configuration

Each runner invocation writes a `.mcp.json` into the work directory:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "<workDir>"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<token>" }
    }
  }
}
```

This gives Claude read/write access to the cloned repo and the ability to push branches and open PRs via the GitHub API.

## Webhook security

GitHub webhooks are validated using HMAC-SHA256:

```
X-Hub-Signature-256: sha256=<hmac(GITHUB_WEBHOOK_SECRET, rawBody)>
```

The raw request body is captured before JSON parsing (Express `verify` callback) so the signature can be verified against the original bytes.

Stripe webhooks use `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`.
