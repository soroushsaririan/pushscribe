# API Reference

Base URL: `http://localhost:3000` (or your deployed `BASE_URL`)

Rate limits: 100 requests / 15 minutes per IP for API routes; 300 requests / 60 seconds for webhook routes.

---

## Health

### `GET /api/health`

Returns server status and queue/job statistics.

```json
{
  "status": "ok",
  "queue": { "running": 1, "queued": 2, "max": 3 },
  "jobs": { "completed": 142, "failed": 3, "avgDuration": 18420 }
}
```

---

## Customers

### `POST /api/customers`

Create a customer. Returns existing record if `email` already exists.

**Body**
```json
{ "email": "you@co.com", "plan": "pro" }
```

**Response** `201` (or `200` if duplicate)
```json
{ "id": "uuid", "email": "you@co.com", "plan": "pro", "status": "active" }
```

---

### `GET /api/customers`

List all customers.

---

### `GET /api/customers/:id`

Get a single customer by ID.

---

## Repos

### `POST /api/customers/:customerId/repos`

Connect a GitHub repo to a customer. Fetches repo metadata from GitHub and registers a webhook.

Fails if the customer has reached their plan's repo limit (starter: 3, pro: 15, team: unlimited).

**Body**
```json
{ "owner": "yourorg", "name": "yourrepo" }
```

**Response** `201`
```json
{
  "id": "uuid",
  "customer_id": "...",
  "owner": "yourorg",
  "name": "yourrepo",
  "full_name": "yourorg/yourrepo",
  "default_branch": "main",
  "webhook_id": 123456789,
  "active": 1
}
```

---

### `GET /api/customers/:customerId/repos`

List all repos for a customer.

---

### `DELETE /api/customers/:customerId/repos/:repoId`

Disconnect a repo. Deregisters the GitHub webhook and marks the repo inactive.

---

## Jobs

### `POST /api/repos/:repoId/trigger`

Manually trigger a documentation run. Enqueues a job with `trigger: "manual"`.

**Response** `202`
```json
{ "jobId": "uuid" }
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
    "trigger": "webhook",
    "commit_sha": "abc1234",
    "status": "completed",
    "pr_url": "https://github.com/org/repo/pull/42",
    "tokens_used": 12400,
    "cost_cents": 18,
    "duration_ms": 21340,
    "created_at": "...",
    "completed_at": "..."
  }
]
```

---

### `GET /api/repos/:repoId/jobs/:jobId`

Get a single job, including `run_log` and `error` fields.

---

## Admin

### `GET /api/admin/stats`

Aggregate system statistics.

```json
{
  "customers": 12,
  "jobs": {
    "total": 340,
    "completed": 328,
    "failed": 12,
    "queued": 2,
    "running": 1,
    "avgDurationMs": 19200
  },
  "queue": { "running": 1, "queued": 2, "max": 3 }
}
```

---

### `GET /api/admin/jobs`

Last 50 jobs across all repos.

---

### `POST /api/admin/cron/run`

Force an immediate daily cron pass. Enqueues jobs for all active pro/team repos without waiting for the scheduled interval.

---

## Webhooks

### `POST /webhook/github`

Receives GitHub push events. Validates `X-Hub-Signature-256`. Ignores pushes to non-default branches. Responds `202` immediately and enqueues the job asynchronously.

### `POST /webhook/stripe`

Receives Stripe billing events. Handled events:

| Event | Action |
|-------|--------|
| `customer.subscription.created` | Set plan, activate customer |
| `customer.subscription.updated` | Update plan |
| `customer.subscription.deleted` | Set status to `cancelled` |
| `invoice.payment_failed` | Set status to `suspended` |
| `invoice.payment_succeeded` | Reactivate if suspended |
