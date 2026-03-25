# Architecture

## Request flow

```
GitHub push event
    │
    ▼
POST /webhook/github  (webhook.js)
    │  HMAC-SHA256 signature verified
    │  Payload parsed → owner, repo, commitSha, defaultBranch
    │
    ▼
enqueue()  (queue.js)
    │  Job record created in SQLite with status = 'queued'
    │  Returns jobId in <100ms; GitHub webhook gets 200 immediately
    │
    ▼
Job queue (queue.js)
    │  Max 3 concurrent workers (QUEUE_CONCURRENCY env var)
    │  FIFO; drain loop picks next job when a slot opens
    │
    ▼
runDocJob()  (runner.js)
    │
    ├─ 1. git clone --depth 50 (ephemeral work dir under WORK_DIR)
    ├─ 2. git diff-tree to discover changed files
    ├─ 3. Write .mcp.json (filesystem + github MCP servers)
    ├─ 4. Copy CLAUDE.md from RepoDoc's own repo into work dir
    ├─ 5. Build focused prompt (scope depends on plan)
    └─ 6. spawn: claude -p "<prompt>" --bare --allowedTools "..." --output-format stream-json
                │
                ▼
           Claude Code process (10-min timeout)
                │  Reads changed source files
                │  Updates README.md, docs/, CHANGELOG.md
                │  git add / commit / push → new branch repodoc/auto-YYYYMMDD-HHmm
                │  Opens PR via GitHub MCP
                │  Outputs PR_URL on final line
                │
    ▼
parseStreamOutput()  (runner.js)
    │  Accumulates text chunks, extracts PR URL
    │  Sums input/output tokens from 'usage' events
    │  Estimates cost: $3/MTok input, $15/MTok output
    │
    ▼
jobs.complete()  (db.js)
    │  status = 'done', pr_url, tokens_used, cost_cents, duration_ms
    │
    ▼
Work dir deleted (always, even on failure)
```

## Trigger types

| Trigger | Source | Plan |
|---------|--------|------|
| `webhook` | GitHub push to default branch | All plans |
| `cron` | Daily pass (cron.js) | Pro, Team |
| `manual` | `POST /api/repos/:id/trigger` | All plans |

## Prompt scoping by plan

- **Starter**: Claude updates `README.md` and `CHANGELOG.md` only
- **Pro / Team**: Claude updates `README.md`, all files under `docs/`, and `CHANGELOG.md`

## Database schema

```sql
customers (id, email, plan, stripe_id, status, created_at, updated_at)
repos     (id, customer_id, owner, name, full_name, default_branch, webhook_id, active, created_at)
jobs      (id, repo_id, trigger, commit_sha, status, pr_url, run_log,
           tokens_used, cost_cents, duration_ms, error, created_at, started_at, finished_at)
```

SQLite is opened in WAL mode (`journal_mode = WAL`) for concurrent reads during job processing.

## MCP servers

Each run gets its own `.mcp.json` written into the cloned work dir:

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
      "env": { "GITHUB_TOKEN": "<token>" }
    }
  }
}
```

The filesystem server is scoped to the work dir so Claude cannot access the host filesystem. The GitHub MCP server enables PR creation without requiring Claude to shell out to `gh`.

## Allowed tools

The Claude Code subprocess is granted only:

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

Network access is via the MCP servers only; arbitrary `curl` or `npm` commands are blocked.
