#!/usr/bin/env node
/**
 * setup.js — First-run setup helper
 * Run with: node scripts/setup.js
 *
 * Checks all dependencies are in place and creates a first demo customer.
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

console.log(`
╔══════════════════════════════════════════╗
║        RepoDoc — First-run Setup         ║
╚══════════════════════════════════════════╝
`)

// 1. Check Node version
const nodeVer = parseInt(process.versions.node.split('.')[0], 10)
if (nodeVer < 18) {
  console.error('✗ Node.js 18+ required. Current:', process.versions.node)
  process.exit(1)
}
console.log(`✓ Node.js ${process.versions.node}`)

// 2. Check Claude Code
try {
  const ver = execSync('claude --version', { encoding: 'utf8', stdio: 'pipe' }).trim()
  console.log(`✓ Claude Code: ${ver}`)
} catch {
  console.error(`✗ Claude Code not found. Install with:`)
  console.error(`    npm install -g @anthropic-ai/claude-code`)
  console.error(`  Then authenticate with: claude`)
  process.exit(1)
}

// 3. Check .env
if (!existsSync(join(ROOT, '.env'))) {
  console.log(`⚠ No .env file found. Copy .env.example and fill in your keys:`)
  console.log(`    cp .env.example .env`)
} else {
  console.log(`✓ .env file present`)
}

// 4. Check ANTHROPIC_API_KEY
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey || apiKey === 'sk-ant-...') {
  console.warn(`⚠ ANTHROPIC_API_KEY not set in environment`)
} else {
  console.log(`✓ ANTHROPIC_API_KEY is set`)
}

// 5. Create work directory
const workDir = process.env.WORK_DIR || '/tmp/repodoc-runs'
mkdirSync(workDir, { recursive: true })
console.log(`✓ Work dir ready: ${workDir}`)

// 6. Create data directory
mkdirSync(join(ROOT, 'data'), { recursive: true })
console.log(`✓ Data dir ready`)

// 7. Create a demo customer
try {
  const { default: db, customers, repos } = await import('../src/db.js')
  const { v4: uuidv4 } = await import('uuid')

  const existing = customers.findByEmail('demo@repodoc.dev')
  if (!existing) {
    customers.create({
      id: uuidv4(),
      email: 'demo@repodoc.dev',
      plan: 'pro',
      stripe_id: null
    })
    console.log(`✓ Demo customer created: demo@repodoc.dev (Pro plan)`)
    console.log(`  Customer ID: ${customers.findByEmail('demo@repodoc.dev').id}`)
  } else {
    console.log(`✓ Demo customer already exists: demo@repodoc.dev`)
    console.log(`  Customer ID: ${existing.id}`)
  }

  db.close()
} catch (e) {
  console.warn(`⚠ Could not create demo customer: ${e.message}`)
  console.warn(`  (Run 'npm install' first if packages are missing)`)
}

console.log(`
Setup complete. Next steps:

  1. Fill in .env with your API keys
  2. npm start
  3. Open http://localhost:3000
  4. Add a repo via the dashboard or API:

     curl -X POST http://localhost:3000/api/customers \\
       -H "Content-Type: application/json" \\
       -d '{"email":"you@yourco.com","plan":"pro"}'

     curl -X POST http://localhost:3000/api/customers/<id>/repos \\
       -H "Content-Type: application/json" \\
       -d '{"owner":"yourorg","name":"yourrepo"}'

  5. Or trigger a manual run:

     curl -X POST http://localhost:3000/api/repos/<repo-id>/trigger
`)
