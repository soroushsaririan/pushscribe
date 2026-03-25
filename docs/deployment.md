# Deployment

## Railway (recommended)

RepoDoc ships with a `railway.json` pre-configured for [Railway](https://railway.app).

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all variables from `.env.example` in the Railway dashboard. The health check endpoint is `GET /api/health`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | yes | Claude API key |
| `GITHUB_TOKEN` | yes | PAT or GitHub App token with `repo` + `admin:repo_hook` |
| `GITHUB_WEBHOOK_SECRET` | yes | Shared secret for GitHub webhook HMAC validation |
| `BASE_URL` | yes | Public URL of this app (used when registering webhooks) |
| `STRIPE_SECRET_KEY` | no | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | no | Stripe webhook signing secret |
| `PORT` | no | HTTP port (default: `3000`) |
| `NODE_ENV` | no | `production` enables stricter error handling |
| `WORK_DIR` | no | Temp dir for repo clones (default: `/tmp/repodoc-runs`) |
| `DB_PATH` | no | SQLite file path (default: `./data/repodoc.db`) |
| `CLAUDE_BIN` | no | Path to `claude` binary (default: `claude`) |
| `PRICE_STARTER` | no | Starter plan price in cents (default: `9900`) |
| `PRICE_PRO` | no | Pro plan price in cents (default: `29900`) |
| `PRICE_TEAM` | no | Team plan price in cents (default: `79900`) |
| `STRIPE_PRICE_STARTER` | no | Stripe Price ID for Starter |
| `STRIPE_PRICE_PRO` | no | Stripe Price ID for Pro |
| `STRIPE_PRICE_TEAM` | no | Stripe Price ID for Team |

## First-run setup

```bash
npm run setup
```

This checks:
- Node.js ≥ 18
- `claude` CLI is installed and authenticated
- Creates `WORK_DIR` and `data/` directories
- Creates a demo customer in the database

## Process model

The app is a single Node.js process (`server.js`). The job queue runs in-process using `queue.js`. There is no separate worker process required.

For dev with file watching:

```bash
npm run dev
```

## Stripe webhook setup

1. In the Stripe dashboard, add a webhook endpoint pointing to `https://<your-domain>/webhook/stripe`
2. Subscribe to events: `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`

## GitHub webhook setup

Webhooks are registered automatically when a repo is connected via `POST /api/customers/:id/repos`. The webhook URL is `${BASE_URL}/webhook/github`. Ensure `BASE_URL` is set and publicly reachable before connecting repos.
