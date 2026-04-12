/**
 * queue.js — In-memory job queue with concurrency control
 *
 * Keeps at most MAX_CONCURRENT Claude Code processes running at once.
 * Incoming jobs wait in a FIFO queue. Each job is persisted to SQLite
 * before execution and updated on completion/failure.
 *
 * For production at scale, swap this for a Bull/BullMQ + Redis queue.
 */

import { v4 as uuidv4 } from 'uuid'
import { jobs, repos, customers, default as db } from './db.js'
import { runDocJob } from './runner.js'

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT ?? '3', 10)

let running = 0
const waitQueue = []

// On startup, mark any jobs left in 'running' state as failed (server was restarted mid-job)
const fixed = db.prepare(`UPDATE jobs SET status = 'failed', error = 'Server restarted', finished_at = datetime('now') WHERE status = 'running'`).run()
if (fixed.changes > 0) console.log(`[queue] Marked ${fixed.changes} stale running job(s) as failed`)

/**
 * Process the next item in the wait queue if we have capacity.
 */
function drain() {
  while (running < MAX_CONCURRENT && waitQueue.length > 0) {
    const next = waitQueue.shift()
    running++
    next()
  }
}

/**
 * Enqueue a documentation job.
 *
 * @param {object} params
 * @param {string} params.repoId    - repos.id
 * @param {string} params.trigger   - 'webhook' | 'cron' | 'manual'
 * @param {string} [params.commitSha]
 * @returns {Promise<string>}       - The job ID
 */
export async function enqueue({ repoId, trigger, commitSha }) {
  const repo     = repos.findById(repoId)
  if (!repo) throw new Error(`Repo ${repoId} not found`)

  const customer = customers.findById(repo.customer_id)
  if (!customer) throw new Error(`Customer for repo ${repoId} not found`)
  if (customer.status !== 'active') throw new Error(`Customer account is ${customer.status}`)

  const jobId = uuidv4()
  jobs.create({ id: jobId, repo_id: repoId, trigger, commit_sha: commitSha })

  console.log(`[queue] Enqueued job ${jobId} for ${repo.full_name} (trigger: ${trigger})`)
  console.log(`[queue] Queue depth: ${waitQueue.length}, running: ${running}/${MAX_CONCURRENT}`)

  // Wrap actual execution in a promise that resolves when the job starts
  await new Promise(resolve => {
    waitQueue.push(resolve)
    drain()
  })

  // We now have a slot — run the job
  executeJob(jobId, repo, customer).finally(() => {
    running--
    drain()
  })

  return jobId
}

/**
 * Actually execute a single job. Updates DB status throughout.
 */
async function executeJob(jobId, repo, customer) {
  jobs.start(jobId)
  console.log(`[queue] Starting job ${jobId}`)

  try {
    const result = await runDocJob({
      owner:         repo.owner,
      name:          repo.name,
      defaultBranch: repo.default_branch,
      plan:          customer.plan,
    })

    jobs.complete(jobId, {
      pr_url:      result.prUrl,
      run_log:     result.runLog,
      tokens_used: result.tokensUsed,
      cost_cents:  result.costCents,
      duration_ms: result.durationMs,
    })

    console.log(`[queue] Job ${jobId} completed — PR: ${result.prUrl ?? 'no PR'}`)
  } catch (err) {
    console.error(`[queue] Job ${jobId} failed:`, err.message)
    jobs.fail(jobId, err.message)
  }
}

/**
 * Manually trigger a job for all repos on a customer (for cron use).
 */
export async function triggerAllRepos(customerId, trigger = 'cron') {
  const customerRepos = repos.listByCustomer(customerId).filter(r => r.active)
  const jobIds = []
  for (const repo of customerRepos) {
    const jobId = await enqueue({ repoId: repo.id, trigger })
    jobIds.push(jobId)
  }
  return jobIds
}

export function queueStats() {
  return { running, queued: waitQueue.length, max: MAX_CONCURRENT }
}
