/**
 * webhook.js — Inbound webhook handlers
 *
 * GitHub: fires on push → triggers doc generation
 * Stripe: fires on subscription events → updates plan / status
 */

import { Router } from 'express'
import { repos, customers } from './db.js'
import { verifyWebhookSignature } from './github.js'
import { enqueue } from './queue.js'

const router = Router()

// ─── GitHub webhook ─────────────────────────────────────────────────────────

router.post('/github', async (req, res) => {
  // Validate signature
  const signature = req.headers['x-hub-signature-256']
  const rawBody   = req.rawBody // set by express middleware below

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] Invalid GitHub signature — rejecting')
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const event = req.headers['x-github-event']

  // We only care about push events
  if (event !== 'push') {
    return res.status(200).json({ message: `Ignoring event: ${event}` })
  }

  const { repository, ref, after: commitSha } = req.body

  // Only trigger on pushes to the default branch
  const defaultBranch = repository?.default_branch ?? 'main'
  if (ref !== `refs/heads/${defaultBranch}`) {
    return res.status(200).json({ message: `Ignoring push to ${ref}` })
  }

  const owner = repository?.owner?.login
  const name  = repository?.name

  if (!owner || !name) {
    return res.status(400).json({ error: 'Missing repository info' })
  }

  // Look up the repo in our DB
  const repo = repos.findByWebhookRepo(owner, name)

  if (!repo) {
    console.log(`[webhook] Unknown repo ${owner}/${name} — ignoring`)
    return res.status(200).json({ message: 'Repo not registered' })
  }

  if (repo.customer_status !== 'active') {
    console.log(`[webhook] Customer for ${owner}/${name} is ${repo.customer_status} — skipping`)
    return res.status(200).json({ message: 'Account not active' })
  }

  // Respond immediately — GitHub times out webhooks in 10s
  res.status(202).json({ message: 'Job queued', repo: repo.full_name })

  // Enqueue asynchronously after response is sent
  setImmediate(async () => {
    try {
      const jobId = await enqueue({ repoId: repo.id, trigger: 'webhook', commitSha })
      console.log(`[webhook] Queued job ${jobId} for ${owner}/${name} at ${commitSha?.slice(0, 7)}`)
    } catch (err) {
      console.error(`[webhook] Failed to enqueue for ${owner}/${name}:`, err.message)
    }
  })
})

// ─── Stripe webhook ──────────────────────────────────────────────────────────

const PLAN_MAP = {
  // Map your Stripe Price IDs to plan names
  [process.env.STRIPE_PRICE_STARTER]: 'starter',
  [process.env.STRIPE_PRICE_PRO]:     'pro',
  [process.env.STRIPE_PRICE_TEAM]:    'team',
}

router.post('/stripe', async (req, res) => {
  // Validate Stripe signature
  let event
  try {
    // In production, use stripe.webhooks.constructEvent(rawBody, sig, secret)
    // Here we parse the JSON body directly (ensure you have rawBody middleware)
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch (err) {
    return res.status(400).json({ error: 'Invalid payload' })
  }

  const stripeCustomerId = event.data?.object?.customer

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub     = event.data.object
      const priceId = sub.items?.data?.[0]?.price?.id
      const plan    = PLAN_MAP[priceId]

      if (!plan) {
        console.warn(`[stripe] Unknown price ID: ${priceId}`)
        break
      }

      const customer = customers.findByStripeId(stripeCustomerId)
      if (customer) {
        customers.updatePlan(customer.id, plan)
        console.log(`[stripe] Updated ${customer.email} to plan: ${plan}`)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const customer = customers.findByStripeId(stripeCustomerId)
      if (customer) {
        customers.updateStatus(customer.id, 'cancelled')
        console.log(`[stripe] Cancelled: ${customer.email}`)
      }
      break
    }

    case 'invoice.payment_failed': {
      const customer = customers.findByStripeId(stripeCustomerId)
      if (customer) {
        customers.updateStatus(customer.id, 'suspended')
        console.log(`[stripe] Suspended (payment failed): ${customer.email}`)
      }
      break
    }

    case 'invoice.payment_succeeded': {
      const customer = customers.findByStripeId(stripeCustomerId)
      if (customer && customer.status === 'suspended') {
        customers.updateStatus(customer.id, 'active')
        console.log(`[stripe] Reactivated: ${customer.email}`)
      }
      break
    }

    default:
      // Ignore other events
      break
  }

  res.json({ received: true })
})

export default router
