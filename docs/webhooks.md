# Webhooks

RepoDoc uses two inbound webhooks: one from GitHub (to detect code pushes) and one from Stripe (to track subscription state).

## GitHub webhook

**Endpoint:** `POST /webhook/github`

### Setup

When you add a repo via `POST /api/customers/:id/repos`, RepoDoc automatically calls the GitHub API to register a push webhook pointing to `{BASE_URL}/webhook/github`. The webhook secret is set to `GITHUB_WEBHOOK_SECRET`.

To remove the webhook, call `DELETE /api/customers/:id/repos/:repoId`.

### Validation

Every request is validated before processing:

```js
// github.js
import { createHmac, timingSafeEqual } from 'crypto';

export function verifyWebhookSignature(payload, signature) {
  const expected = 'sha256=' + createHmac('sha256', GITHUB_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Requests with missing or invalid signatures return `401`.

### Filtering

Only push events to the repo's default branch trigger a documentation run. Pushes to other branches and non-push event types (e.g. `pull_request`, `ping`) are acknowledged with `200` and ignored.

### Payload used

From the push payload:
- `repository.full_name` — used to look up the repo in the DB
- `ref` — compared against the stored `default_branch`
- `after` — commit SHA passed to the runner so it can check out the exact state

## Stripe webhook

**Endpoint:** `POST /webhook/stripe`

### Setup

Set `STRIPE_WEBHOOK_SECRET` to the signing secret from your Stripe dashboard webhook configuration. Point the Stripe webhook at `{BASE_URL}/webhook/stripe`.

Map your Stripe Price IDs to plans:

```env
PRICE_STARTER=price_xxx
PRICE_PRO=price_yyy
PRICE_TEAM=price_zzz
```

### Handled events

| Event | Action |
|-------|--------|
| `customer.subscription.created` | Looks up customer by Stripe ID, updates plan from Price ID, sets status `active` |
| `customer.subscription.updated` | Same as created — handles plan upgrades/downgrades |
| `customer.subscription.deleted` | Sets customer status to `inactive` |
| `invoice.payment_failed` | Sets customer status to `past_due` |
| `invoice.payment_succeeded` | Sets customer status to `active` |

Unknown events return `200` and are ignored.

### Plan mapping

```js
// webhook.js
function getPlanFromPriceId(priceId) {
  if (priceId === process.env.PRICE_STARTER) return 'starter';
  if (priceId === process.env.PRICE_PRO)     return 'pro';
  if (priceId === process.env.PRICE_TEAM)    return 'team';
  return 'starter'; // fallback
}
```

## Manually re-registering a webhook

If the webhook gets out of sync (e.g. your `BASE_URL` changed), delete and re-add the repo:

```bash
# Remove (also deletes the GitHub webhook)
curl -X DELETE http://localhost:3000/api/customers/<customerId>/repos/<repoId>

# Re-add (registers a fresh webhook)
curl -X POST http://localhost:3000/api/customers/<customerId>/repos \
  -H "Content-Type: application/json" \
  -d '{"owner":"yourorg","name":"yourrepo"}'
```
