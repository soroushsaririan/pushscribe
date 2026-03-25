# API Reference

Base URL: `http://localhost:3000` (or your deployed `BASE_URL`)

All request/response bodies are JSON. No authentication is enforced by default — add middleware before deploying publicly.

---

## Health

### `GET /api/health`

Returns uptime, queue state, and aggregate job statistics.

```json
{
  "status": "ok",
  "uptime": 3600,
  "queue": { "waiting": 0, "running": 1, "concurrency": 3 },
  "jobs": {
    "total": 42, "successful": 40, "failed": 1, "running": 1, "queued": 0,
    "total_tokens": 1200000, "avg_duration_ms": 45000
  }
}
```

---

## Customers

### `POST /api/customers`

Create a customer. Idempotent by email — returns the existing record if found.

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | yes | Unique customer email |
| `plan` | string | no | `starter` (default), `pro`, or `team` |
| `stripe_id` | string | no | Stripe customer ID |

**Response** `201` — customer object

```json
{
  "id": "uuid",
  "email": "you@co.com",
  "plan": "pro",
  "stripe_id": null,
  "status": "active",
  "created_at": "2026-03-25T00:00:00"
}
```

### `GET /api/customers`

List all customers ordered by `created_at DESC`.

### `GET /api/customers/:id`

Get a single customer. `404` if not found.

---

## Repos

### `POST /api/customers/:customerId/repos`

Connect a GitHub repo to a customer. Registers a webhook on the GitHub repo.

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | yes | GitHub org or username |
| `name` | string | yes | Repo name |
| `github_token` | string | no | Per-repo OAuth token (falls back to `GITHUB_TOKEN` env var) |

**Errors**

| Status | Reason |
|--------|--------|
| `403` | Account suspended or plan repo limit reached |
| `409` | Repo already connected |
| `500` | GitHub API error |

**Response** `201` — repo object

```json
{
  "id": "uuid",
  "customer_id": "uuid",
  "owner": "myorg",
  "name": "myrepo",
  "full_name": "myorg/myrepo",
  "default_branch": "main",
  "webhook_id": 123456,
  "active": 1
}
```

### `GET /api/customers/:customerId/repos`

List repos for a customer.

### `DELETE /api/customers/:customerId/repos/:repoId`

Disconnect a repo. Removes the GitHub webhook if one was registered.

---

## Jobs

### `GET /api/repos/:repoId/jobs`

List job history for a repo.

**Query params**

| Param | Default | Max |
|-------|---------|-----|
| `limit` | 20 | 100 |

**Response** — array of job objects

```json
[{
  "id": "uuid",
  "repo_id": "uuid",
  "trigger": "webhook",
  "commit_sha": "abc1234",
  "status": "done",
  "pr_url": "https://github.com/org/repo/pull/5",
  "tokens_used": 28500,
  "cost_cents": 12,
  "duration_ms": 47000,
  "error": null,
  "created_at": "2026-03-25T10:00:00",
  "started_at": "2026-03-25T10:00:01",
  "finished_at": "2026-03-25T10:00:48"
}]
```

Job `status` values: `queued` | `running` | `done` | `failed`

### `GET /api/repos/:repoId/jobs/:jobId`

Get a single job, including the full `run_log` (capped at 50 KB).

### `POST /api/repos/:repoId/trigger`

Manually enqueue a documentation run.

**Response** `200`

```json
{ "jobId": "uuid", "message": "Job enqueued" }
```

---

## Admin

### `GET /api/admin/stats`

System-wide statistics.

```json
{
  "customers": 5,
  "active_customers": 4,
  "jobs": { "total": 42, "successful": 40, ... },
  "queue": { "waiting": 0, "running": 1, "concurrency": 3 }
}
```

### `GET /api/admin/jobs`

Most recent 50 jobs across all customers, joined with `full_name` and `email`.

### `POST /api/admin/cron/run`

Force an immediate daily cron pass (runs async, returns immediately).

---

## Webhooks

### `POST /webhook/github`

Receives GitHub `push` events. Validates `X-Hub-Signature-256` (HMAC-SHA256 with `GITHUB_WEBHOOK_SECRET`). Enqueues a job if the push is to the repo's default branch.

### `POST /webhook/stripe`

Receives Stripe events. Handles:

- `customer.subscription.updated` / `deleted` — updates plan or suspends customer
- `invoice.payment_failed` — marks customer as suspended
