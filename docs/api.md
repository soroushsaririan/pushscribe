# API Reference

Base URL: `http://localhost:3000` (or your deployed `BASE_URL`).

All request bodies are JSON (`Content-Type: application/json`). All responses are JSON.

---

## Health

### `GET /api/health`

```json
{
  "status": "ok",
  "uptime": 3600,
  "queue": { "running": 1, "queued": 2, "max": 3 },
  "jobs": { "total": 142, "succeeded": 138, "failed": 4 }
}
```

---

## Customers

### `POST /api/customers`

Create a customer. Idempotent — returns existing record if email already registered.

**Body**
```json
{ "email": "user@example.com", "plan": "pro", "stripe_id": "cus_..." }
```

`plan` defaults to `"starter"`. `stripe_id` is optional.

**Response** `201`
```json
{ "id": "uuid", "email": "user@example.com", "plan": "pro", "status": "active", "created_at": "..." }
```

---

### `GET /api/customers`

Returns array of all customers.

---

### `GET /api/customers/:id`

Returns one customer or `404`.

---

## Repositories

### `POST /api/customers/:customerId/repos`

Connect a GitHub repository to a customer. Fetches repo metadata, registers a GitHub webhook, and saves the repo.

**Body**
```json
{ "owner": "myorg", "name": "myrepo", "github_token": "ghp_..." }
```

`github_token` is optional — falls back to the server's `GITHUB_TOKEN` env var.

**Response** `201`
```json
{
  "id": "uuid",
  "customer_id": "uuid",
  "owner": "myorg",
  "name": "myrepo",
  "default_branch": "main",
  "webhook_id": 12345678,
  "active": 1,
  "created_at": "..."
}
```

**Errors**
- `403` — account suspended or plan repo limit reached
- `409` — repo already connected
- `500` — GitHub API error

Plan limits: Starter = 3, Pro = 15, Team = unlimited.

---

### `GET /api/customers/:customerId/repos`

Returns array of repos for a customer.

---

### `DELETE /api/customers/:customerId/repos/:repoId`

Deactivates the repo and removes the GitHub webhook.

**Response** `200`
```json
{ "success": true }
```

---

## Jobs

### `POST /api/repos/:repoId/trigger`

Enqueue a manual documentation run.

**Response** `200`
```json
{ "jobId": "uuid", "message": "Job enqueued" }
```

---

### `GET /api/repos/:repoId/jobs`

List job history for a repo.

**Query params**
- `limit` — number of results (default `20`, max `100`)

**Response**
```json
[
  {
    "id": "uuid",
    "repo_id": "uuid",
    "trigger": "webhook",
    "status": "succeeded",
    "pr_url": "https://github.com/org/repo/pull/42",
    "tokens_used": 18500,
    "cost_cents": 12,
    "duration_ms": 47200,
    "created_at": "..."
  }
]
```

Job `trigger` values: `"webhook"`, `"cron"`, `"manual"`.
Job `status` values: `"pending"`, `"running"`, `"succeeded"`, `"failed"`.

---

### `GET /api/repos/:repoId/jobs/:jobId`

Returns a single job including `run_log` (capped at 50 KB).

---

## Admin

### `GET /api/admin/stats`

```json
{
  "customers": 12,
  "active_customers": 10,
  "jobs": { "total": 200, "succeeded": 190, "failed": 10 },
  "queue": { "running": 0, "queued": 0, "max": 3 }
}
```

---

### `GET /api/admin/jobs`

Returns the 50 most recent jobs across all repos.

---

### `POST /api/admin/cron/run`

Immediately triggers a daily cron pass (enqueues all active Pro/Team repos). Returns `200` before the pass completes.

```json
{ "message": "Cron pass started" }
```

---

## Webhooks

### `POST /webhook/github`

Receives GitHub push events. Validates the `X-Hub-Signature-256` HMAC header. Only processes pushes to the repo's configured default branch. Enqueues a job with the `commitSha` from the payload.

Returns `200 { "queued": true }` on success, `400` if signature invalid or branch mismatch.

---

### `POST /webhook/stripe`

Receives Stripe billing events. Validates the `Stripe-Signature` header.

Handled events:

| Event | Action |
|-------|--------|
| `customer.subscription.created` | Set plan and status `active` |
| `customer.subscription.updated` | Update plan |
| `customer.subscription.deleted` | Set status `cancelled` |
| `invoice.payment_failed` | Set status `past_due` |
| `invoice.payment_succeeded` | Set status `active` |
