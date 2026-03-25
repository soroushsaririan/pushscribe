/**
 * api.js — REST API
 */

import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { customers, repos, jobs, sessions } from './db.js'
import { registerWebhook, removeWebhook, getRepoInfo } from './github.js'
import { enqueue, queueStats } from './queue.js'
import { runDailyPass } from './cron.js'

const router = Router()

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

// ─── Cookie helper ──────────────────────────────────────────────────────────

function parseCookies(req) {
  const list = {}
  const header = req.headers.cookie
  if (!header) return list
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) list[k.trim()] = decodeURIComponent(v.join('='))
  }
  return list
}

// ─── Auth middleware ────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const { session: sessionId } = parseCookies(req)
  if (!sessionId) return res.status(401).json({ error: 'Not authenticated' })

  const session = sessions.findById(sessionId)
  if (!session || new Date(session.expires_at) < new Date()) {
    res.setHeader('Set-Cookie', 'session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax')
    return res.status(401).json({ error: 'Session expired' })
  }

  req.customer = customers.findById(session.customer_id)
  req.session  = session
  next()
}

// ─── GitHub OAuth ───────────────────────────────────────────────────────────

router.get('/auth/github', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(500).send('GITHUB_CLIENT_ID not configured')
  }
  const params = new URLSearchParams({
    client_id:    process.env.GITHUB_CLIENT_ID,
    scope:        'repo user:email',
    redirect_uri: `${BASE_URL}/api/auth/github/callback`,
  })
  res.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

router.get('/auth/github/callback', async (req, res) => {
  const { code } = req.query
  if (!code) return res.redirect('/?error=no_code#login')

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({
        client_id:     process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    })
    const { access_token: githubToken } = await tokenRes.json()
    if (!githubToken) return res.redirect('/?error=auth_failed#login')

    // Get GitHub user info
    const [userRes, emailRes] = await Promise.all([
      fetch('https://api.github.com/user',        { headers: { Authorization: `Bearer ${githubToken}`, 'User-Agent': 'PushScribe' } }),
      fetch('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${githubToken}`, 'User-Agent': 'PushScribe' } }),
    ])
    const githubUser = await userRes.json()
    const emails     = await emailRes.json()
    const email      = (Array.isArray(emails) ? emails.find(e => e.primary)?.email : null)
                       ?? githubUser.email
                       ?? `${githubUser.login}@users.noreply.github.com`

    // Find or create customer
    let customer = customers.findByEmail(email)
    if (!customer) {
      const id = uuidv4()
      customers.create({ id, email, plan: 'starter', github_login: githubUser.login, github_avatar: githubUser.avatar_url })
      customer = customers.findById(id)
    } else {
      customers.updateGithubInfo(customer.id, githubUser.login, githubUser.avatar_url)
      customer = customers.findById(customer.id)
    }

    // Create session (7 days)
    const sessionId  = uuidv4()
    const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    sessions.create({ id: sessionId, customer_id: customer.id, github_token: githubToken, expires_at: expiresAt })

    res.setHeader('Set-Cookie', `session=${sessionId}; Max-Age=${7 * 24 * 3600}; Path=/; HttpOnly; SameSite=Lax`)
    res.redirect('/app')
  } catch (err) {
    console.error('[auth] GitHub OAuth error:', err)
    res.redirect('/?error=auth_failed')
  }
})

router.get('/auth/me', requireAuth, (req, res) => {
  const { id, email, plan, status, github_login, github_avatar } = req.customer
  res.json({ id, email, plan, status, github_login, github_avatar })
})

router.post('/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.session.id)
  res.setHeader('Set-Cookie', 'session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax')
  res.json({ ok: true })
})

// ─── User-scoped routes (/me) ───────────────────────────────────────────────

router.get('/me/repos', requireAuth, (req, res) => {
  res.json(repos.listByCustomer(req.customer.id))
})

router.get('/me/stats', requireAuth, (req, res) => {
  res.json(jobs.statsByCustomer(req.customer.id))
})

router.post('/me/repos', requireAuth, async (req, res) => {
  const customer = req.customer
  if (customer.status !== 'active') return res.status(403).json({ error: 'account suspended' })

  const { owner, name } = req.body
  if (!owner || !name) return res.status(400).json({ error: 'owner and name required' })

  if (!repos.canAddRepo(customer.id, customer.plan)) {
    return res.status(403).json({ error: 'Plan limit reached. Upgrade to add more repos.', plan: customer.plan })
  }

  const existing = repos.findByFullName(customer.id, `${owner}/${name}`)
  if (existing) return res.status(409).json({ error: 'repo already connected', repo: existing })

  try {
    const token = req.session.github_token || process.env.GITHUB_TOKEN
    const info  = await getRepoInfo({ owner, name, token })

    const repoId = uuidv4()
    repos.create({ id: repoId, customer_id: customer.id, owner, name, default_branch: info.defaultBranch })

    try {
      const webhookId = await registerWebhook({ owner, name, token })
      repos.updateWebhookId(repoId, webhookId)
    } catch (whErr) {
      console.warn(`[api] Webhook registration failed for ${owner}/${name}:`, whErr.message)
    }

    res.status(201).json(repos.findById(repoId))
  } catch (err) {
    console.error('[api] Failed to add repo:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/me/repos/:repoId', requireAuth, async (req, res) => {
  const repo = repos.findById(req.params.repoId)
  if (!repo || repo.customer_id !== req.customer.id) return res.status(404).json({ error: 'not found' })

  if (repo.webhook_id) {
    try {
      const token = req.session.github_token || process.env.GITHUB_TOKEN
      await removeWebhook({ owner: repo.owner, name: repo.name, webhookId: repo.webhook_id, token })
    } catch (e) { console.warn('[api] Webhook removal failed:', e.message) }
  }

  repos.deactivate(repo.id)
  res.json({ success: true })
})

router.get('/me/repos/:repoId/jobs', requireAuth, (req, res) => {
  const repo = repos.findById(req.params.repoId)
  if (!repo || repo.customer_id !== req.customer.id) return res.status(404).json({ error: 'not found' })
  const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100)
  res.json(jobs.listByRepo(repo.id, limit))
})

router.post('/me/repos/:repoId/trigger', requireAuth, async (req, res) => {
  const repo = repos.findById(req.params.repoId)
  if (!repo || repo.customer_id !== req.customer.id) return res.status(404).json({ error: 'not found' })
  if (!repo.active) return res.status(403).json({ error: 'repo is deactivated' })

  try {
    const jobId = await enqueue({ repoId: repo.id, trigger: 'manual' })
    res.json({ jobId, message: 'Job enqueued' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Health ─────────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), queue: queueStats(), jobs: jobs.stats() })
})

// ─── Admin routes (keep for debugging) ─────────────────────────────────────

router.post('/customers', (req, res) => {
  const { email, plan = 'starter', stripe_id } = req.body
  if (!email) return res.status(400).json({ error: 'email required' })
  const existing = customers.findByEmail(email)
  if (existing) return res.json(existing)
  const customer = { id: uuidv4(), email, plan, stripe_id }
  customers.create(customer)
  res.status(201).json(customers.findById(customer.id))
})

router.get('/customers', (req, res) => res.json(customers.list()))
router.get('/customers/:id', (req, res) => {
  const customer = customers.findById(req.params.id)
  if (!customer) return res.status(404).json({ error: 'not found' })
  res.json(customer)
})

router.post('/customers/:customerId/repos', async (req, res) => {
  const customer = customers.findById(req.params.customerId)
  if (!customer) return res.status(404).json({ error: 'customer not found' })
  if (customer.status !== 'active') return res.status(403).json({ error: 'account suspended' })

  const { owner, name, github_token } = req.body
  if (!owner || !name) return res.status(400).json({ error: 'owner and name required' })

  if (!repos.canAddRepo(customer.id, customer.plan)) {
    return res.status(403).json({ error: 'Plan limit reached.', plan: customer.plan })
  }

  const existing = repos.findByFullName(customer.id, `${owner}/${name}`)
  if (existing) return res.status(409).json({ error: 'repo already connected', repo: existing })

  try {
    const info   = await getRepoInfo({ owner, name, token: github_token })
    const repoId = uuidv4()
    repos.create({ id: repoId, customer_id: customer.id, owner, name, default_branch: info.defaultBranch })
    try {
      const webhookId = await registerWebhook({ owner, name, token: github_token })
      repos.updateWebhookId(repoId, webhookId)
    } catch (whErr) { console.warn(`[api] Webhook failed:`, whErr.message) }
    res.status(201).json(repos.findById(repoId))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/customers/:customerId/repos', (req, res) => {
  const customer = customers.findById(req.params.customerId)
  if (!customer) return res.status(404).json({ error: 'not found' })
  res.json(repos.listByCustomer(req.params.customerId))
})

router.delete('/customers/:customerId/repos/:repoId', async (req, res) => {
  const repo = repos.findById(req.params.repoId)
  if (!repo || repo.customer_id !== req.params.customerId) return res.status(404).json({ error: 'not found' })
  if (repo.webhook_id) {
    try { await removeWebhook({ owner: repo.owner, name: repo.name, webhookId: repo.webhook_id }) }
    catch (e) { console.warn('[api] Webhook removal failed:', e.message) }
  }
  repos.deactivate(repo.id)
  res.json({ success: true })
})

router.get('/repos/:repoId/jobs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100)
  res.json(jobs.listByRepo(req.params.repoId, limit))
})

router.get('/repos/:repoId/jobs/:jobId', (req, res) => {
  const job = jobs.findById(req.params.jobId)
  if (!job || job.repo_id !== req.params.repoId) return res.status(404).json({ error: 'not found' })
  res.json(job)
})

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

router.get('/admin/stats', (req, res) => {
  const allCustomers = customers.list()
  res.json({ customers: allCustomers.length, active_customers: allCustomers.filter(c => c.status === 'active').length, jobs: jobs.stats(), queue: queueStats() })
})

router.get('/admin/jobs', (req, res) => res.json(jobs.listRecent(50)))

router.post('/admin/cron/run', async (req, res) => {
  res.json({ message: 'Cron pass started' })
  runDailyPass().catch(console.error)
})

export default router
