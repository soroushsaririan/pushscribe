# Architecture

RepoDoc is a Node.js service that wraps Claude Code CLI to automate documentation updates. Every run follows the same pipeline.

## Request lifecycle

```
1. Trigger arrives
   ├─ GitHub push webhook  →  webhook.js validates HMAC, checks default branch
   ├─ Daily cron           →  cron.js enqueues all active Pro/Team repos
   └─ Manual API call      →  POST /api/repos/:id/trigger

2. Job enqueued  (queue.js)
   - In-memory FIFO queue
   - Blocks if >= MAX_CONCURRENT jobs running (default 3)
   - Job record created in SQLite with status "pending"

3. Runner executes  (runner.js)
   a. Clone repo into ephemeral WORK_DIR/<owner>-<name>-<timestamp>/
      git clone --depth 50 --single-branch --branch <defaultBranch>
   b. Configure git identity (repodoc[bot]@repodoc.dev) and credential helper
   c. Discover changed files
      - If commitSha provided: git diff-tree --no-commit-id -r --name-only <sha>
      - Otherwise: git log --since='24 hours ago' --name-only
      - Docs files (README, CHANGELOG, docs/) are excluded from the changed-files list
   d. Write .mcp.json into work dir with filesystem + github MCP servers
   e. Copy CLAUDE.md from the RepoDoc server into work dir
   f. Build prompt (scope depends on plan — see below)
   g. Spawn: claude -p "<prompt>" --bare --allowedTools "..." --output-format stream-json
   h. Stream and parse JSON output for PR URL, token counts, run log
   i. Clean up work dir (always, even on error)

4. Result saved  (db.js)
   - Job updated with status, pr_url, tokens_used, cost_cents, duration_ms, run_log
```

## Prompt scoping by plan

| Plan | Docs updated |
|------|-------------|
| Starter | `README.md` and `CHANGELOG.md` |
| Pro | `README.md`, `CHANGELOG.md`, and all files under `docs/` |
| Team | Same as Pro |

## Allowed Claude Code tools

The runner pre-approves a fixed set of Bash sub-commands to limit blast radius:

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

## MCP servers

Two MCP servers are injected into each Claude Code run via `.mcp.json`:

| Server | Package | Purpose |
|--------|---------|---------|
| `filesystem` | `@modelcontextprotocol/server-filesystem` | Read/write files in the cloned repo directory |
| `github` | `@modelcontextprotocol/server-github` | Open pull requests, query GitHub APIs |

The `filesystem` server is scoped to the ephemeral work directory only.

## Database schema

Three SQLite tables managed by `db.js` (better-sqlite3):

**customers**
```
id, email, plan, stripe_id, status, created_at
```

**repos**
```
id, customer_id, owner, name, default_branch, webhook_id, active, created_at
```

**jobs**
```
id, repo_id, trigger, status, pr_url, run_log,
input_tokens, output_tokens, tokens_used, cost_cents,
duration_ms, started_at, completed_at, created_at
```

Indexes exist on `repo_id`, `status`, and `customer_id` for dashboard query performance.

## Concurrency and rate limits

- **Job queue**: in-memory FIFO, `MAX_CONCURRENT` slots (default 3). Each job blocks a slot until the Claude Code subprocess exits.
- **API rate limit**: 100 requests per 15 minutes per IP (express-rate-limit).
- **Webhook rate limit**: 300 requests per minute per IP.
- **Claude Code timeout**: 10 minutes hard limit per job. Repos that time out are marked failed.

## Cost tracking

Costs are estimated from the `usage` events in the `stream-json` output:

```
cost_cents = ceil((input_tokens / 1_000_000 × $3.00 + output_tokens / 1_000_000 × $15.00) × 100)
```

Rates are approximate for claude-sonnet-4. Actual billed amounts may differ.

## Cron scheduler

`cron.js` uses `setInterval` (not an OS cron). On startup, `startCron()` waits 5 minutes, runs `runDailyPass()`, then repeats every 24 hours. `runDailyPass()` queries all active repos belonging to Pro or Team customers and enqueues one job each.

Starter plan repos are **not** included in the daily pass; they only run on GitHub push.
