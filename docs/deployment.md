# Deployment

## Railway (recommended)

Railway runs the app as a single Node.js process. The `railway.json` config sets the start command and health check path.

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all variables from `.env.example` in your Railway project's **Variables** tab before the first deploy.

Health check: `GET /api/health` — Railway will restart the container if this returns non-200.
Restart policy: on failure, up to 3 retries.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `GITHUB_TOKEN` | Yes | PAT or GitHub App token (`repo` + `admin:repo_hook` scopes) |
| `GITHUB_WEBHOOK_SECRET` | Yes | Random secret used to sign GitHub webhooks |
| `BASE_URL` | Yes | Public URL of this service (e.g. `https://repodoc.up.railway.app`) — used when registering webhooks on customer repos |
| `STRIPE_SECRET_KEY` | Billing | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` | Billing | Stripe Price ID for Starter plan |
| `STRIPE_PRICE_PRO` | Billing | Stripe Price ID for Pro plan |
| `STRIPE_PRICE_TEAM` | Billing | Stripe Price ID for Team plan |
| `PORT` | No | HTTP port (default: `3000`) |
| `WORK_DIR` | No | Temp directory for repo clones (default: `/tmp/repodoc-runs`) |
| `DB_PATH` | No | SQLite file path (default: `./data/repodoc.db`) |
| `CLAUDE_BIN` | No | Path to `claude` binary (default: `claude`) |
| `NODE_ENV` | No | `production` or `development` |

## GitHub token scopes

The `GITHUB_TOKEN` needs:
- `repo` — clone private repos, push branches, open PRs
- `admin:repo_hook` — register and remove webhooks on customer repos

## Stripe setup

1. Create three Products in Stripe: Starter, Pro, Team.
2. Add a monthly recurring Price to each product.
3. Set `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM` to the Price IDs (`price_...`).
4. In Stripe → Webhooks, add your `BASE_URL/webhook/stripe` endpoint and subscribe to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`
5. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## First run

```bash
npm run setup
```

This will:
1. Check Node.js ≥ 18 and `claude` CLI are installed
2. Prompt for missing `.env` values
3. Create `data/` and `WORK_DIR` directories
4. Create a demo customer (`demo@repodoc.dev`, Pro plan) in the DB
5. Print next steps

## Running locally

```bash
# Development (auto-restarts on file change)
npm run dev

# Production
npm start
```

Dashboard available at `http://localhost:3000`.

## Data persistence

SQLite database at `./data/repodoc.db` (or `DB_PATH`). Back this file up regularly in production. On Railway, attach a persistent volume and point `DB_PATH` at it.
