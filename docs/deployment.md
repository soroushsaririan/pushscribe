# Deployment

## Railway (recommended)

Railway is the simplest deployment path. The repo includes `railway.json` with Nixpacks build config and health check settings.

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set environment variables in the Railway dashboard. The health check endpoint (`GET /api/health`) must return `200` within 30 seconds.

**Required env vars for Railway:**
```
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
GITHUB_WEBHOOK_SECRET=<random secret>
BASE_URL=https://<your-railway-domain>.up.railway.app
NODE_ENV=production
```

After deploy, update your GitHub webhook URL to `https://<domain>/webhook/github`.

## General (Docker / VPS / other)

```bash
npm install
npm start
```

The server uses SQLite so there is no external database. **Persist the `data/` directory** (or set `DB_PATH` to a path on a mounted volume) to survive redeploys.

`WORK_DIR` (default `/tmp/repodoc-runs`) is used for ephemeral repo clones — each job creates and deletes a subdirectory. It does not need to be persisted.

## Claude Code CLI

The server spawns `claude` (or the binary at `CLAUDE_BIN`). Claude Code must be installed and authenticated on the machine running RepoDoc:

```bash
npm install -g @anthropic-ai/claude-code
claude   # authenticate once
```

In containerized environments, pre-authenticate and bake the credentials into the image, or mount `~/.claude` as a volume.

## Environment variables

See `.env.example` for the full list. Summary:

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `ANTHROPIC_API_KEY` | Yes | — | Used by the `claude` CLI |
| `GITHUB_TOKEN` | Yes | — | Fallback token for repo access and webhook registration |
| `GITHUB_WEBHOOK_SECRET` | Yes | — | HMAC-SHA256 secret shared with GitHub |
| `BASE_URL` | Yes | — | Used when registering webhooks |
| `PORT` | No | `3000` | HTTP listen port |
| `DB_PATH` | No | `data/repodoc.db` | SQLite file location |
| `WORK_DIR` | No | `/tmp/repodoc-runs` | Ephemeral clone directory |
| `MAX_CONCURRENT` | No | `3` | Max simultaneous Claude Code processes |
| `CLAUDE_BIN` | No | `claude` | Path to Claude Code binary |
| `STRIPE_SECRET_KEY` | No | — | Required only if using Stripe billing |
| `STRIPE_WEBHOOK_SECRET` | No | — | Required only if using Stripe webhooks |
| `STRIPE_PRICE_STARTER` | No | — | Stripe Price ID → `starter` plan |
| `STRIPE_PRICE_PRO` | No | — | Stripe Price ID → `pro` plan |
| `STRIPE_PRICE_TEAM` | No | — | Stripe Price ID → `team` plan |

## Scaling considerations

- `MAX_CONCURRENT` controls how many `claude` processes run simultaneously. Each process uses significant CPU/memory while running. Start at 3 and tune based on your instance size.
- The in-memory queue (`queue.js`) is not shared across processes. For multi-instance deployments, replace it with BullMQ + Redis.
- SQLite works well for single-instance deployments. For high write throughput or horizontal scaling, swap `db.js` for Postgres.

## First-run setup

```bash
npm run setup
```

This script:
1. Checks Node.js ≥ 18
2. Checks `claude --version` is available
3. Checks for `.env`
4. Creates `data/` and `WORK_DIR` directories
5. Seeds a demo customer (`demo@repodoc.dev`, Pro plan) in the SQLite database

Safe to run multiple times — idempotent.
