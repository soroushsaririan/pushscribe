# Deployment

## Railway (recommended)

RepoDoc ships with a `railway.json` that configures Nixpacks and a health check on `/api/health`.

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set environment variables in the Railway dashboard. At minimum:

```
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
GITHUB_WEBHOOK_SECRET=<random string>
BASE_URL=https://<your-app>.up.railway.app
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_TEAM=price_...
```

After deploy, register the GitHub webhook URL in your Stripe dashboard:
`https://<your-app>.up.railway.app/webhook/stripe`

## Manual / VPS

```bash
git clone https://github.com/soroushsaririan/repodoc
cd repodoc
npm install
cp .env.example .env   # fill in all keys
npm run setup          # checks deps, seeds demo customer
npm start
```

Use a process manager to keep the server running:

```bash
# pm2
npm install -g pm2
pm2 start server.js --name repodoc
pm2 save
pm2 startup
```

## GitHub webhook setup

When you add a repo via the API, RepoDoc automatically calls `POST /repos/:owner/:name/hooks` via Octokit using `BASE_URL` + `/webhook/github` as the payload URL. The webhook fires on `push` events.

If automatic registration fails (permissions, private org, etc.), register manually in the repo's GitHub settings:
- Payload URL: `https://<your-app>/webhook/github`
- Content type: `application/json`
- Secret: value of `GITHUB_WEBHOOK_SECRET`
- Events: **Just the push event**

## Scaling

The default queue runs up to `MAX_CONCURRENT=3` Claude Code processes simultaneously. Each process:
- Uses ~200–500MB RAM while active
- Runs for 1–5 minutes per job (depends on repo size and doc scope)
- Requires outbound internet access to GitHub and Anthropic APIs

For higher throughput, increase `MAX_CONCURRENT` (watch RAM) or replace `src/queue.js` with BullMQ + Redis for a distributed worker setup.

## Persistent storage

SQLite database is stored at `data/repodoc.db` (configurable via `DB_PATH`). On Railway, attach a volume and set `DB_PATH` to a path on that volume so the database survives deploys.

Ephemeral clone directories land in `WORK_DIR` (default `/tmp/repodoc-runs`). They are always deleted after each job run.
