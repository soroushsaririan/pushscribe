# API Reference

Base path: `/api`

Rate limit: 100 requests per 15 minutes per IP.

All request bodies and responses are JSON. No authentication middleware is included by default — add JWT auth before deploying to production.

---

## Health

### GET /api/health

Returns server uptime, queue state, and aggregate job statistics.

```bash
curl http://localhost:3000/api/health
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "queue": { "running": 1, "queued": 2, "max": 3 },
  "jobs": {
    "total": 142,
    "successful": 138,
    "failed": 4,
    "running": 1,
    "queued": 2,
    "total_tokens": 8412000,
    "avg_duration_ms": 45200
  }
}
```

---

## Customers

### POST /api/customers

Create a customer. Idempotent — returns the existing record if `email` is already registered.

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Unique customer email |
| `plan` | string | No | `starter` (default), `pro`, or `team` |
| `stripe_id` | string | No | Stripe customer ID |

```bash
curl -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"email":"eng@acme.com","plan":"pro"}'
```

**Response** `201 Created`

```json
{
  "id": "a1b2c3d4-...",
  "email": "eng@acme.com",
  "plan": "pro",
  "stripe_id": null,
  "status": "active",
  "created_at": "2026-03-25T12:00:00",
  "updated_at": "2026-03-25T12:00:00"
}
```

### GET /api/customers

Returns all customers ordered by `created_at DESC`.

### GET /api/customers/:id

Returns a single customer or `404`.

---

## Repos

### POST /api/customers/:customerId/repos

Connect a GitHub repo to a customer. Fetches repo metadata from GitHub and registers a push webhook. Webhook registration failure is non-fatal — the repo is still connected.

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | Yes | GitHub org or user |
| `name` | string | Yes | Repo name |
| `github_token` | string | No | Customer's token; falls back to `GITHUB_TOKEN` env var |

**Errors**

| Status | Condition |
|--------|-----------|
| 403 | Customer account is not `active` |
| 403 | Plan repo limit reached |
| 409 | Repo already connected |

```bash
curl -X POST http://localhost:3000/api/customers/a1b2c3d4-.../repos \
  -H "Content-Type: application/json" \
  -d '{"owner":"acme","name":"platform"}'
```

**Response** `201 Created`

```json
{
  "id": "e5f6g7h8-...",
  "customer_id": "a1b2c3d4-...",
  "owner": "acme",
  "name": "platform",
  "full_name": "acme/platform",
  "default_branch": "main",
  "webhook_id": 12345678,
  "active": 1,
  "created_at": "2026-03-25T12:01:00"
}
```

### GET /api/customers/:customerId/repos

Returns all repos for a customer ordered by `created_at DESC`.

### DELETE /api/customers/:customerId/repos/:repoId

Deactivate a repo (`active=0`) and remove its GitHub webhook. Webhook removal failure is non-fatal.

**Response** `200 OK`

```json
{ "success": true }
```

---

## Jobs

### POST /api/repos/:repoId/trigger

Enqueue a manual documentation run. Returns the job ID immediately; the job runs asynchronously.

**Errors**

| Status | Condition |
|--------|-----------|
| 404 | Repo not found |
| 403 | Repo is deactivated |

```bash
curl -X POST http://localhost:3000/api/repos/e5f6g7h8-.../trigger
```

**Response** `200 OK`

```json
{ "jobId": "j9k0l1m2-...", "message": "Job enqueued" }
```

### GET /api/repos/:repoId/jobs

List jobs for a repo.

**Query params**

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `limit` | `20` | `100` | Number of jobs to return |

**Response**

```json
[
  {
    "id": "j9k0l1m2-...",
    "repo_id": "e5f6g7h8-...",
    "trigger": "webhook",
    "commit_sha": "abc1234",
    "status": "done",
    "pr_url": "https://github.com/acme/platform/pull/42",
    "tokens_used": 58200,
    "cost_cents": 13,
    "duration_ms": 48300,
    "error": null,
    "created_at": "2026-03-25T14:00:00",
    "started_at": "2026-03-25T14:00:01",
    "finished_at": "2026-03-25T14:00:49"
  }
]
```

### GET /api/repos/:repoId/jobs/:jobId

Returns a single job or `404`.

---

## Admin

These endpoints are unauthenticated in the current implementation. Protect them behind your auth layer before exposing externally.

### GET /api/admin/stats

```json
{
  "customers": 18,
  "active_customers": 16,
  "jobs": { "total": 142, "successful": 138, ... },
  "queue": { "running": 1, "queued": 0, "max": 3 }
}
```

### GET /api/admin/jobs

Returns the 50 most recent jobs across all repos, joined with `full_name` and customer `email`.

### POST /api/admin/cron/run

Triggers an immediate daily pass (same as the scheduled cron). Responds immediately; the pass runs in the background.

```json
{ "message": "Cron pass started" }
```

---

## Webhooks

### POST /webhook/github

Receives GitHub push events. Rate limit: 300 requests per minute.

- Validates `X-Hub-Signature-256` using `GITHUB_WEBHOOK_SECRET`
- Ignores events other than `push`
- Ignores pushes to non-default branches
- Returns `202 Accepted` immediately; job is enqueued asynchronously

### POST /webhook/stripe

Receives Stripe subscription lifecycle events. Handled events:

| Event | Action |
|-------|--------|
| `customer.subscription.created` | Update customer plan |
| `customer.subscription.updated` | Update customer plan |
| `customer.subscription.deleted` | Set status to `cancelled` |
| `invoice.payment_failed` | Set status to `suspended` |
| `invoice.payment_succeeded` | Restore status to `active` (if suspended) |
