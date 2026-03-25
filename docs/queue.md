# Job Queue

RepoDoc uses an in-memory FIFO queue with concurrency control to serialize and throttle documentation runs.

## Concurrency

Maximum concurrent jobs defaults to `3`. Override with the `MAX_CONCURRENT` environment variable.

```
queued jobs → [ job4, job5, job6 ]
running     → [ job1, job2, job3 ]  ← at most MAX_CONCURRENT
```

When a running job finishes, the next queued job starts automatically.

## Enqueuing a job

Jobs are enqueued by three triggers:

| Trigger | Source |
|---------|--------|
| `webhook` | GitHub push to default branch |
| `cron` | Daily pass via `cron.js` |
| `manual` | `POST /api/repos/:repoId/trigger` |

```js
// queue.js
await enqueue(repoId, 'manual', commitSha);
```

`enqueue` validates:
1. Repo exists in the DB
2. Repo is active (`repos.active = 1`)
3. Customer is active (`customers.status = 'active'`)

If validation fails, it throws — callers should handle the error.

## Job states

```
queued → running → done
                 ↘ failed
```

State transitions are written to SQLite (`db.js`) at each step:
- `queued` — on `enqueue()`
- `running` — when the worker picks up the job (records `started_at`)
- `done` — on successful completion (records `pr_url`, `tokens`, `cost`, `duration`, `completed_at`)
- `failed` — on any error (records error message in `run_log`)

## Queue stats

`GET /api/health` returns current queue state:

```json
{
  "status": "ok",
  "uptime": 3600,
  "queue": {
    "running": 1,
    "queued": 2,
    "maxConcurrent": 3
  },
  "jobs": {
    "done": 142,
    "failed": 3,
    "running": 1,
    "queued": 2
  }
}
```

## Limitations

The queue is in-memory. If the process restarts:
- **Queued** jobs (not yet started) are lost — re-trigger manually or wait for the next cron pass
- **Running** jobs leave stale `status='running'` records in SQLite — re-trigger manually if needed

For production workloads requiring durability, replace `queue.js` with a persistent queue backed by Redis (e.g. BullMQ).
