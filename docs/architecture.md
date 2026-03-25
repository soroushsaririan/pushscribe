# Architecture

## Overview

RepoDoc is a Node.js service that automates repository documentation by running Claude Code CLI as a subprocess. Each doc update is an isolated job: clone → analyze → write docs → open PR → clean up.

## Module map

```
server.js                   Express entry point; routes, middleware, cron start
src/
  db.js                     SQLite schema + CRUD (customers, repos, jobs)
  queue.js                  In-memory FIFO queue, concurrency control
  runner.js                 Core: clones repo, builds prompt, spawns claude, parses output
  cron.js                   Daily scheduled pass for Pro/Team customers
  github.js                 Octokit wrappers (webhook CRUD, signature verification)
  routes/
    api.js                  REST API — customers, repos, jobs, admin
    webhook.js              Inbound GitHub push + Stripe billing events
public/
  index.html                Single-page dashboard
```

## Request flow

### Webhook trigger

```
GitHub push → POST /webhook/github
  → verifyWebhookSignature (HMAC-SHA256)
  → repos.findByWebhookRepo(owner, name)
  → HTTP 202 (immediate response to GitHub)
  → setImmediate → enqueue({ trigger: 'webhook', commitSha })
```

GitHub requires a response within 10 seconds. The handler responds with `202` immediately and enqueues asynchronously.

### Job lifecycle

```
enqueue(repoId, trigger, commitSha)
  → jobs.create()                      status: queued
  → wait for queue slot (FIFO)
  → jobs.start()                       status: running
  → runDocJob(...)
      → git clone --depth 50
      → git diff-tree → changedFiles[]
      → write .mcp.json (filesystem + github MCP servers)
      → copy CLAUDE.md into work dir
      → buildPrompt(changedFiles, plan, ...)
      → spawn: claude -p <prompt> --bare --output-format stream-json
      → parse stream-json lines → prUrl, tokens, cost
      → git rm -rf <workDir>           always, even on failure
  → jobs.complete() or jobs.fail()     status: done | failed
```

### Cron trigger

`startCron()` fires 5 minutes after server startup, then every 24 hours. It iterates all active customers on Pro or Team plans and enqueues a `cron` job per active repo. Starter plan customers are skipped (webhook-only).

## Queue

`src/queue.js` is a simple in-memory FIFO backed by an array. Concurrency is bounded by `MAX_CONCURRENT` (default 3, set via env). Each `enqueue()` call blocks until a slot is free, then spawns `executeJob()` asynchronously.

For production at scale, replace with BullMQ + Redis.

## Claude Code invocation

The runner spawns:

```bash
claude -p "<prompt>" \
  --bare \
  --allowedTools "Read,Write,Bash(git log *),Bash(git diff *),Bash(git diff-tree *),Bash(git add *),Bash(git commit *),Bash(git checkout *),Bash(git push *),Bash(git branch *),Bash(date *),Bash(sort *),Bash(find * -name *.md),Bash(find * -name *.js),...,Bash(cat *),Bash(ls *)" \
  --output-format stream-json
```

`--bare` disables the interactive UI. `--output-format stream-json` emits one JSON event per line. The runner collects stdout, parses usage events for token counts, and scans text events for `PR_URL: https://...`.

The work directory contains:
- The cloned repo (depth 50, single branch)
- `.mcp.json` — MCP server config scoped to this work dir
- `.git-credentials` — token written for `git push`
- `CLAUDE.md` — copied from the RepoDoc server's own CLAUDE.md

The process is given a 10-minute hard timeout. The work directory is always deleted in a `finally` block.

## Prompt strategy

`buildPrompt()` in `runner.js` builds a focused prompt based on:
- **Plan**: Starter → `README.md and CHANGELOG.md only`; Pro/Team → `README.md, all files under docs/, and CHANGELOG.md`
- **Changed files**: if a commit SHA is available, `git diff-tree` lists exactly what changed; otherwise a 24-hour window is used

The prompt instructs Claude Code to:
1. Read changed source files
2. Update documentation
3. Add a CHANGELOG entry
4. `git add` doc files only
5. Commit as `docs: auto-update <date>`
6. Push to `repodoc/auto-<timestamp>` branch
7. Open a PR and output `PR_URL: <url>` on the last line

## Database

SQLite via `better-sqlite3` (synchronous API). WAL mode is enabled for concurrent reads.

**customers** — `id`, `email`, `plan` (starter|pro|team), `stripe_id`, `status` (active|suspended|cancelled)

**repos** — `id`, `customer_id`, `owner`, `name`, `full_name`, `default_branch`, `webhook_id`, `active`

**jobs** — `id`, `repo_id`, `trigger` (webhook|cron|manual), `commit_sha`, `status` (queued|running|done|failed), `pr_url`, `run_log` (capped at 50KB), `tokens_used`, `cost_cents`, `duration_ms`, `error`

## Billing integration

Stripe webhooks update plan and account status:

| Event | Action |
|-------|--------|
| `customer.subscription.created/updated` | `customers.updatePlan(id, plan)` |
| `customer.subscription.deleted` | `customers.updateStatus(id, 'cancelled')` |
| `invoice.payment_failed` | `customers.updateStatus(id, 'suspended')` |
| `invoice.payment_succeeded` | Re-activates a suspended account |

Price IDs are mapped to plan names via `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM` env vars.
