/**
 * api.js — Internal REST API
 *
 * Used by the dashboard and customer onboarding flows.
 * In production, add JWT auth middleware before these routes.
 */

import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { customers, repos, jobs } from '../db.js'
import { registerWebhook, removeWebhook, getRepoInfo } from '../github.js'
import { enqueue, queueStats } from '../queue.js'
import { runDailyPass } from '../cron.js'

const router = Router()

// ─── Health ────────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  const stats = jobs.stats()
  const queue = queueStats()
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    queue,
    jobs: stats
  })
})

// ─── Customers ─────────────────────────────────────────────────────────────

router.post('/customers', (req, res) => {
  const { email, plan = 'starter', stripe_id } = req.body
  if (!email) return res.status(400).json({ error: 'email required' })

  const existing = customers.findByEmail(email)
  if (existing) return res.json(existing)

  const customer = { id: uuidv4(), email, plan, stripe_id }
  customers.create(customer)
  res.status(201).json(customers.findById(customer.id))
})

router.get('/customers', (req, res) => {
  res.json(customers.list())
})

router.get('/customers/:id', (req, res) => {
  const customer = customers.findById(req.params.id)
  if (!customer) return res.status(404).json({ error: 'not found' })
  res.json(customer)
})

// ─── Repos ─────────────────────────────────────────────────────────────────

router.post('/customers/:customerId/repos', async (req, res) => {
  const customer = customers.findById(req.params.customerId)
  if (!customer) return res.status(404).json({ error: 'customer not found' })
  if (customer.status !== 'active') return res.status(403).json({ error: 'account suspended' })

  const { owner, name, github_token } = req.body
  if (!owner || !name) return res.status(400).json({ error: 'owner and name required' })

  // Check plan limits
  if (!repos.canAddRepo(customer.id, customer.plan)) {
    return res.status(403).json({
      error: `Plan limit reached. Upgrade to add more repos.`,
      plan: customer.plan
    })
  }

  // Check for duplicates
  const existing = repos.findByFullName(customer.id, `${owner}/${name}`)
  if (existing) return res.status(409).json({ error: 'repo already connected', repo: existing })

  try {
    // Fetch repo metadata from GitHub
    const info = await getRepoInfo({ owner, name, token: github_token })

    const repoId = uuidv4()
    repos.create({
      id: repoId,
      customer_id: customer.id,
      owner,
      name,
      default_branch: info.defaultBranch
    })

    // Register webhook
    try {
      const webhookId = await registerWebhook({ owner, name, token: github_token })
      repos.updateWebhookId(repoId, webhookId)
    } catch (whErr) {
      console.warn(`[api] Webhook registration failed for ${owner}/${name}:`, whErr.message)
      // Don't fail the whole request — repo is connected, webhook optional
    }

    const repo = repos.findById(repoId)
    res.status(201).json(repo)
  } catch (err) {
    console.error('[api] Failed to add repo:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/customers/:customerId/repos', (req, res) => {
  const customer = customers.findById(req.params.customerId)
  if (!customer) return res.status(404).json({ error: 'not found' })

  const customerRepos = repos.listByCustomer(req.params.customerId)
  res.json(customerRepos)
})

router.delete('/customers/:customerId/repos/:repoId', async (req, res) => {
  const repo = repos.findById(req.params.repoId)
  if (!repo || repo.customer_id !== req.params.customerId) {
    return res.status(404).json({ error: 'not found' })
  }

  // Remove webhook if we registered one
  if (repo.webhook_id) {
    try {
      await removeWebhook({ owner: repo.owner, name: repo.name, webhookId: repo.webhook_id })
    } catch (e) {
      console.warn('[api] Webhook removal failed:', e.message)
    }
  }

  repos.deactivate(repo.id)
  res.json({ success: true })
})

// ─── Jobs ──────────────────────────────────────────────────────────────────

router.get('/repos/:repoId/jobs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100)
  res.json(jobs.listByRepo(req.params.repoId, limit))
})

router.get('/repos/:repoId/jobs/:jobId', (req, res) => {
  const job = jobs.findById(req.params.jobId)
  if (!job || job.repo_id !== req.params.repoId) {
    return res.status(404).json({ error: 'not found' })
  }
  res.json(job)
})

// Manual trigger
router.post('/repos/:repoId/trigger', async (req, res) => {
  const repo = repos.findById(req.params.repoId)
  if (!repo) return res.status(404).json({ error: 'repo not found' })
  if (!repo.active) return res.status(403).json({ error: 'repo is deactivated' })

  try {
    const jobId = await enqueue({ repoId: repo.id, trigger: 'manual' })
    res.json({ jobId, message: 'Job enqueued' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Admin / stats ─────────────────────────────────────────────────────────

router.get('/admin/stats', (req, res) => {
  const jobStats   = jobs.stats()
  const qStats     = queueStats()
  const allCustomers = customers.list()

  res.json({
    customers: allCustomers.length,
    active_customers: allCustomers.filter(c => c.status === 'active').length,
    jobs: jobStats,
    queue: qStats,
  })
})

router.get('/admin/jobs', (req, res) => {
  res.json(jobs.listRecent(50))
})

// Force a daily cron pass (admin use)
router.post('/admin/cron/run', async (req, res) => {
  res.json({ message: 'Cron pass started' })
  runDailyPass().catch(console.error)
})

export default router
