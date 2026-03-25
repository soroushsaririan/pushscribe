# API Reference

Base URL: `http://localhost:3000` (or your deployed `BASE_URL`)

Rate limit: **100 requests per 15 minutes** per IP. Webhook endpoints allow up to **300 requests per minute**.

All request and response bodies are JSON. Error responses use `{ "error": "..." }`.

---

## Health

### `GET /api/health`

Returns server status, queue depth, and job counters.

```bash
curl http://localhost:3000/api/health
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "queue": { "running": 1, "queued": 2, "max": 3 },
  "jobs": {
    "total": 42,
    "successful": 38,
    "failed": 2,
    "running": 1,
    "queued": 1,
    "total_tokens": 1200000,
    "avg_duration_ms": 45000
  }
}
```

---

## Customers

### `POST /api/customers`

Create a customer. Idempotent — returns existing customer if the email already exists.

**Body:**
```json
{
  "email": "you@co.com",
  "plan": "pro",
  "stripe_id": "cus_abc123"
}
```

`plan` defaults to `"starter"`. `stripe_id` is optional.

**Response** `201 Created`:
```json
{
  "id": "uuid",
  "email": "you@co.com",
  "plan": "pro",
  "stripe_id": "cus_abc123",
  "status": "active",
  "created_at": "2026-03-25T00:00:00",
  "updated_at": "2026-03-25T00:00:00"
}
```

---

### `GET /api/customers`

List all customers ordered by `created_at DESC`.

---

### `GET /api/customers/:id`

Get a single customer by UUID. Returns `404` if not found.

---

## Repos

### `POST /api/customers/:customerId/repos`

Connect a GitHub repository. Fetches repo metadata from GitHub and registers a `push` webhook.

**Body:**
```json
{
  "owner": "yourorg",
  "name": "yourrepo",
  "github_token": "ghp_..."
}
```

`github_token` is optional — falls back to the server-level `GITHUB_TOKEN`. Required if the repo is private or the server token lacks access.

Fails with `403` if:
- The customer account is not `active`
- The customer has reached their plan's repo limit (starter: 3, pro: 15, team: unlimited)

Fails with `409` if the repo is already connected.

Webhook registration failure does **not** fail the request — the repo is connected and you can re-register the webhook manually later.

**Response** `201 Created`:
```json
{
  "id": "uuid",
  "customer_id": "uuid",
  "owner": "yourorg",
  "name": "yourrepo",
  "full_name": "yourorg/yourrepo",
  "default_branch": "main",
  "webhook_id": 12345678,
  "active": 1,
  "created_at": "2026-03-25T00:00:00"
}
```

---

### `GET /api/customers/:customerId/repos`

List all repos for a customer, ordered by `created_at DESC`.

---

### `DELETE /api/customers/:customerId/repos/:repoId`

Disconnect a repo. Removes the GitHub webhook (if one was registered) and sets `active = 0`. Deactivated repos no longer receive webhook or cron triggers.

---

## Jobs

### `GET /api/repos/:repoId/jobs`

List jobs for a repo. Default limit 20, max 100.

```bash
curl "http://localhost:3000/api/repos/<repoId>/jobs?limit=50"
```

Each job object:
```json
{
  "id": "uuid",
  "repo_id": "uuid",
  "trigger": "webhook",
  "commit_sha": "abc1234...",
  "status": "done",
  "pr_url": "https://github.com/org/repo/pull/42",
  "run_log": "...",
  "tokens_used": 28000,
  "cost_cents": 18,
  "duration_ms": 52000,
  "error": null,
  "created_at": "...",
  "started_at": "...",
  "finished_at": "..."
}
```

Job statuses: `queued` → `running` → `done` or `failed`.

---

### `GET /api/repos/:repoId/jobs/:jobId`

Get a single job by ID. Returns `404` if the job doesn't belong to the specified repo.

---

### `POST /api/repos/:repoId/trigger`

Manually enqueue a documentation run. The repo must be active.

```bash
curl -X POST http://localhost:3000/api/repos/<repoId>/trigger
```

**Response:**
```json
{ "jobId": "uuid", "message": "Job enqueued" }
```

---

## Admin

### `GET /api/admin/stats`

Aggregate system stats.

```json
{
  "customers": 10,
  "active_customers": 8,
  "jobs": { "total": 200, "successful": 185, ... },
  "queue": { "running": 2, "queued": 0, "max": 3 }
}
```

---

### `GET /api/admin/jobs`

50 most recent jobs across all customers, with repo `full_name` and customer `email` joined.

---

### `POST /api/admin/cron/run`

Force an immediate daily cron pass (runs asynchronously after the 200 response).

```bash
curl -X POST http://localhost:3000/api/admin/cron/run
```

---

## Webhooks

### `POST /webhook/github`

Receives GitHub `push` events. Validates `X-Hub-Signature-256` header. Only processes pushes to the repository's default branch. Responds `202` immediately and enqueues the job asynchronously.

To register a webhook manually:
```bash
curl -X POST https://api.github.com/repos/ORG/REPO/hooks \
  -H "Authorization: token ghp_..." \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "url": "https://your-app.up.railway.app/webhook/github",
      "content_type": "json",
      "secret": "<GITHUB_WEBHOOK_SECRET>"
    },
    "events": ["push"],
    "active": true
  }'
```

---

### `POST /webhook/stripe`

Receives Stripe subscription and invoice events. Maps Stripe Price IDs (configured via `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`) to plan names.

Handled event types:
- `customer.subscription.created` / `customer.subscription.updated` → update customer plan
- `customer.subscription.deleted` → set customer status to `cancelled`
- `invoice.payment_failed` → set customer status to `suspended` (stops job processing)
- `invoice.payment_succeeded` → reactivate `suspended` customer
