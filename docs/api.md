# API Reference

Base URL: `http://localhost:3000` (or your deployed `BASE_URL`).

Rate limit: 100 requests per 15 minutes per IP.

---

## Health

### `GET /api/health`

Returns 200 if the server is up.

```json
{ "status": "ok", "timestamp": "2026-03-25T00:00:00.000Z" }
```

---

## Customers

### `POST /api/customers`

Create a customer.

**Body:**
```json
{
  "email": "alice@example.com",
  "plan": "pro"
}
```

`plan` is one of `starter`, `pro`, `team`. Defaults to `starter`.

**Response 201:**
```json
{
  "id": "uuid",
  "email": "alice@example.com",
  "plan": "pro",
  "status": "active",
  "created_at": "..."
}
```

---

### `GET /api/customers`

List all customers.

**Response 200:** Array of customer objects.

---

### `GET /api/customers/:id`

Get a single customer.

---

## Repos

### `POST /api/customers/:id/repos`

Connect a GitHub repository to a customer. Registers a webhook on the repo automatically.

**Body:**
```json
{
  "owner": "myorg",
  "name": "myrepo"
}
```

Returns 400 if the customer has reached their plan's repo limit (Starter: 3, Pro: 15).

**Response 201:**
```json
{
  "id": "uuid",
  "customer_id": "...",
  "owner": "myorg",
  "name": "myrepo",
  "full_name": "myorg/myrepo",
  "default_branch": "main",
  "webhook_id": 12345678
}
```

---

### `GET /api/customers/:id/repos`

List all repos for a customer.

---

### `DELETE /api/customers/:id/repos/:repoId`

Disconnect a repo. Removes the GitHub webhook and marks the repo inactive.

---

## Jobs

### `POST /api/repos/:repoId/trigger`

Manually trigger a documentation run for a repo.

**Response 202:**
```json
{ "jobId": "uuid", "status": "queued" }
```

---

### `GET /api/repos/:repoId/jobs`

List job history for a repo (most recent 20).

**Response 200:**
```json
[
  {
    "id": "uuid",
    "trigger": "webhook",
    "commit_sha": "abc1234",
    "status": "done",
    "pr_url": "https://github.com/org/repo/pull/42",
    "tokens_used": 8500,
    "cost_cents": 12,
    "duration_ms": 34200,
    "created_at": "...",
    "finished_at": "..."
  }
]
```

`trigger` is one of `webhook`, `cron`, `manual`.
`status` is one of `queued`, `running`, `done`, `failed`.

---

### `GET /api/jobs/:jobId`

Get full details for a single job, including `run_log`.

---

## Admin

### `GET /api/admin/stats`

System-wide statistics.

**Response 200:**
```json
{
  "customers": 5,
  "repos": 12,
  "jobs": {
    "total": 340,
    "successful": 315,
    "failed": 8,
    "running": 1,
    "queued": 2,
    "total_tokens": 2840000,
    "avg_duration_ms": 28400
  },
  "queue": {
    "waiting": 2,
    "running": 1,
    "maxConcurrent": 3
  }
}
```

---

### `GET /api/admin/jobs`

Recent jobs across all customers (last 50).

---

### `POST /api/admin/cron`

Force an immediate cron pass — enqueues one job per active Pro/Team repo.

**Response 200:**
```json
{ "enqueued": 7 }
```

---

## Webhooks

### `POST /webhook/github`

Receives GitHub `push` events. Validates `X-Hub-Signature-256`. Enqueues a job for the matching repo.

### `POST /webhook/stripe`

Receives Stripe subscription lifecycle events. Updates customer plan and status.

Both endpoints return 200 immediately; processing is async.
