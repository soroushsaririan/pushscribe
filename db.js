/**
 * db.js — SQLite persistence layer
 * Stores customers, repos, jobs, and run logs.
 * Using better-sqlite3 for synchronous, zero-dependency SQLite.
 */

import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'repodoc.db')

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'starter',  -- starter | pro | team
    stripe_id   TEXT,
    status      TEXT NOT NULL DEFAULT 'active',   -- active | suspended | cancelled
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS repos (
    id            TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    owner         TEXT NOT NULL,
    name          TEXT NOT NULL,
    full_name     TEXT NOT NULL,  -- owner/name
    default_branch TEXT NOT NULL DEFAULT 'main',
    webhook_id    INTEGER,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(customer_id, full_name)
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id            TEXT PRIMARY KEY,
    repo_id       TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    trigger       TEXT NOT NULL,   -- webhook | cron | manual
    commit_sha    TEXT,
    status        TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
    pr_url        TEXT,
    run_log       TEXT,
    tokens_used   INTEGER,
    cost_cents    INTEGER,
    duration_ms   INTEGER,
    error         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    started_at    TEXT,
    finished_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_repo ON jobs(repo_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_repos_customer ON repos(customer_id);
`)

// ─── Customer operations ───────────────────────────────────────────────────

export const customers = {
  create({ id, email, plan = 'starter', stripe_id }) {
    return db.prepare(`
      INSERT INTO customers (id, email, plan, stripe_id)
      VALUES (@id, @email, @plan, @stripe_id)
    `).run({ id, email, plan, stripe_id })
  },

  findById(id) {
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
  },

  findByEmail(email) {
    return db.prepare('SELECT * FROM customers WHERE email = ?').get(email)
  },

  findByStripeId(stripe_id) {
    return db.prepare('SELECT * FROM customers WHERE stripe_id = ?').get(stripe_id)
  },

  updatePlan(id, plan) {
    return db.prepare(`
      UPDATE customers SET plan = @plan, updated_at = datetime('now') WHERE id = @id
    `).run({ id, plan })
  },

  updateStatus(id, status) {
    return db.prepare(`
      UPDATE customers SET status = @status, updated_at = datetime('now') WHERE id = @id
    `).run({ id, status })
  },

  list() {
    return db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all()
  }
}

// ─── Repo operations ───────────────────────────────────────────────────────

const PLAN_LIMITS = { starter: 3, pro: 15, team: Infinity }

export const repos = {
  create({ id, customer_id, owner, name, default_branch = 'main' }) {
    return db.prepare(`
      INSERT INTO repos (id, customer_id, owner, name, full_name, default_branch)
      VALUES (@id, @customer_id, @owner, @name, @full_name, @default_branch)
    `).run({ id, customer_id, owner, name, full_name: `${owner}/${name}`, default_branch })
  },

  findById(id) {
    return db.prepare('SELECT * FROM repos WHERE id = ?').get(id)
  },

  findByFullName(customer_id, full_name) {
    return db.prepare(
      'SELECT * FROM repos WHERE customer_id = ? AND full_name = ?'
    ).get(customer_id, full_name)
  },

  findByWebhookRepo(owner, name) {
    return db.prepare(
      'SELECT r.*, c.plan, c.status as customer_status FROM repos r JOIN customers c ON r.customer_id = c.id WHERE r.owner = ? AND r.name = ? AND r.active = 1'
    ).get(owner, name)
  },

  listByCustomer(customer_id) {
    return db.prepare(
      'SELECT * FROM repos WHERE customer_id = ? ORDER BY created_at DESC'
    ).all(customer_id)
  },

  countByCustomer(customer_id) {
    return db.prepare(
      'SELECT COUNT(*) as count FROM repos WHERE customer_id = ? AND active = 1'
    ).get(customer_id).count
  },

  canAddRepo(customer_id, plan) {
    const count = repos.countByCustomer(customer_id)
    return count < (PLAN_LIMITS[plan] ?? 3)
  },

  updateWebhookId(id, webhook_id) {
    return db.prepare('UPDATE repos SET webhook_id = ? WHERE id = ?').run(webhook_id, id)
  },

  deactivate(id) {
    return db.prepare('UPDATE repos SET active = 0 WHERE id = ?').run(id)
  }
}

// ─── Job operations ────────────────────────────────────────────────────────

export const jobs = {
  create({ id, repo_id, trigger, commit_sha }) {
    return db.prepare(`
      INSERT INTO jobs (id, repo_id, trigger, commit_sha)
      VALUES (@id, @repo_id, @trigger, @commit_sha)
    `).run({ id, repo_id, trigger, commit_sha: commit_sha ?? null })
  },

  findById(id) {
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)
  },

  start(id) {
    return db.prepare(`
      UPDATE jobs SET status = 'running', started_at = datetime('now') WHERE id = ?
    `).run(id)
  },

  complete(id, { pr_url, run_log, tokens_used, cost_cents, duration_ms }) {
    return db.prepare(`
      UPDATE jobs
      SET status = 'done',
          pr_url = @pr_url,
          run_log = @run_log,
          tokens_used = @tokens_used,
          cost_cents = @cost_cents,
          duration_ms = @duration_ms,
          finished_at = datetime('now')
      WHERE id = @id
    `).run({ id, pr_url: pr_url ?? null, run_log: run_log ?? null, tokens_used: tokens_used ?? 0, cost_cents: cost_cents ?? 0, duration_ms: duration_ms ?? 0 })
  },

  fail(id, error) {
    return db.prepare(`
      UPDATE jobs
      SET status = 'failed', error = @error, finished_at = datetime('now')
      WHERE id = @id
    `).run({ id, error: String(error) })
  },

  listByRepo(repo_id, limit = 20) {
    return db.prepare(
      'SELECT * FROM jobs WHERE repo_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(repo_id, limit)
  },

  listRecent(limit = 50) {
    return db.prepare(`
      SELECT j.*, r.full_name, c.email
      FROM jobs j
      JOIN repos r ON j.repo_id = r.id
      JOIN customers c ON r.customer_id = c.id
      ORDER BY j.created_at DESC LIMIT ?
    `).all(limit)
  },

  stats() {
    return db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(tokens_used) as total_tokens,
        AVG(duration_ms) as avg_duration_ms
      FROM jobs
    `).get()
  }
}

export default db
