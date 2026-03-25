/**
 * cron.js — Scheduled documentation runs
 *
 * Runs a daily doc generation pass for all active repos.
 * Uses a simple setInterval — replace with node-cron or a real scheduler
 * if you need per-timezone scheduling or more granular control.
 */

import { customers, repos } from './db.js'
import { enqueue } from './queue.js'

const DAILY_MS = 24 * 60 * 60 * 1000

let cronInterval = null

/**
 * Run docs for all active repos across all active customers.
 * Called once daily.
 */
async function runDailyPass() {
  console.log('[cron] Starting daily documentation pass...')
  const allCustomers = customers.list().filter(c => c.status === 'active')

  let scheduled = 0

  for (const customer of allCustomers) {
    // Pro and Team plans only — Starter gets webhook-only triggers
    if (customer.plan === 'starter') continue

    const customerRepos = repos.listByCustomer(customer.id).filter(r => r.active)

    for (const repo of customerRepos) {
      try {
        await enqueue({ repoId: repo.id, trigger: 'cron' })
        scheduled++
      } catch (err) {
        console.error(`[cron] Failed to enqueue ${repo.full_name}:`, err.message)
      }
    }
  }

  console.log(`[cron] Daily pass complete — scheduled ${scheduled} jobs`)
}

/**
 * Start the daily cron.
 */
export function startCron() {
  if (cronInterval) return

  // Run once shortly after startup (5 minutes), then every 24h
  setTimeout(() => {
    runDailyPass()
    cronInterval = setInterval(runDailyPass, DAILY_MS)
  }, 5 * 60 * 1000)

  console.log('[cron] Daily documentation scheduler started')
}

export function stopCron() {
  if (cronInterval) {
    clearInterval(cronInterval)
    cronInterval = null
  }
}

export { runDailyPass }
