/**
 * runner.js — Claude Code execution engine
 *
 * This is the heart of RepoDoc. It:
 * 1. Clones the target repo into an ephemeral working directory
 * 2. Builds a focused prompt based on what changed
 * 3. Spawns `claude -p --bare` with pre-approved tools
 * 4. Streams and parses the JSON output
 * 5. Returns structured results (PR URL, tokens, cost)
 */

import { spawn } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const WORK_DIR = process.env.WORK_DIR || '/tmp/repodoc-runs'
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude'

// Cost per million tokens (claude-sonnet-4, approximate)
const COST_PER_INPUT_MTok  = 3.00   // $3.00 / 1M input tokens
const COST_PER_OUTPUT_MTok = 15.00  // $15.00 / 1M output tokens

/**
 * Build the documentation prompt tailored to what changed.
 */
function buildPrompt({ owner, name, defaultBranch, changedFiles, commitSha, plan }) {
  const scope = plan === 'starter'
    ? 'README.md and CHANGELOG.md only'
    : 'README.md, all files under docs/, and CHANGELOG.md'

  const filesSection = changedFiles?.length
    ? `The following source files changed in the latest commit (${commitSha?.slice(0, 7) ?? 'unknown'}):\n${changedFiles.map(f => `  - ${f}`).join('\n')}\n\nFocus your documentation updates on these files, but update any other doc that references them too.`
    : `Run: git log --since='24 hours ago' --name-only --format='' | sort -u\nto discover what changed in the last 24 hours and focus on those files.`

  return `You are documenting the GitHub repository ${owner}/${name}.

${filesSection}

Your tasks:
1. Read the changed source files to understand what they do.
2. Update ${scope} to accurately reflect the current behavior.
3. Add a new entry to CHANGELOG.md in Keep a Changelog format under [Unreleased].
4. Stage only documentation files: git add README.md CHANGELOG.md docs/ 2>/dev/null || true
5. Commit with message: "docs: auto-update $(date +%Y-%m-%d)"
6. Push the commit to a new branch named: repodoc/auto-$(date +%Y%m%d-%H%M)
7. Create a pull request to ${defaultBranch} titled "docs: auto-update $(date +%Y-%m-%d)" with a brief summary of what changed.

Output the PR URL on the final line in this exact format:
PR_URL: https://github.com/...`
}

/**
 * Parse stream-json output from `claude -p --output-format stream-json`
 * Returns { prUrl, runLog, inputTokens, outputTokens }
 */
function parseStreamOutput(rawOutput) {
  const lines = rawOutput.split('\n').filter(Boolean)
  let inputTokens = 0
  let outputTokens = 0
  let prUrl = null
  const textParts = []

  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      if (event.type === 'usage') {
        inputTokens  += event.input_tokens  ?? 0
        outputTokens += event.output_tokens ?? 0
      }
      if (event.type === 'text' || event.type === 'assistant') {
        const text = event.text ?? event.content ?? ''
        textParts.push(text)
        // Extract PR URL if present
        const match = text.match(/PR_URL:\s*(https:\/\/github\.com\/\S+)/i)
        if (match) prUrl = match[1].trim()
      }
    } catch {
      // Non-JSON line — include in log verbatim
      textParts.push(line)
    }
  }

  return {
    prUrl,
    runLog: textParts.join('\n').slice(0, 50_000), // cap at 50KB
    inputTokens,
    outputTokens
  }
}

/**
 * Estimate cost in cents from token counts
 */
function estimateCost(inputTokens, outputTokens) {
  const inputCost  = (inputTokens  / 1_000_000) * COST_PER_INPUT_MTok
  const outputCost = (outputTokens / 1_000_000) * COST_PER_OUTPUT_MTok
  return Math.ceil((inputCost + outputCost) * 100) // cents
}

/**
 * Discover which files changed in the latest commit using git.
 * Runs inside the already-cloned repo directory.
 */
function getChangedFiles(repoDir, commitSha) {
  try {
    const cmd = commitSha
      ? `git diff-tree --no-commit-id -r --name-only ${commitSha}`
      : `git log --since='24 hours ago' --name-only --format='' | sort -u`
    const output = execSync(cmd, { cwd: repoDir, encoding: 'utf8' })
    return output.trim().split('\n').filter(Boolean).filter(f =>
      // Only show source files, not docs themselves
      !f.startsWith('docs/') && !f.match(/README|CHANGELOG/i)
    )
  } catch {
    return []
  }
}

/**
 * Main entry point. Runs a full RepoDoc job for one repository.
 *
 * @param {object} params
 * @param {string} params.owner         - GitHub repo owner
 * @param {string} params.name          - GitHub repo name
 * @param {string} params.defaultBranch - e.g. 'main'
 * @param {string} params.plan          - 'starter' | 'pro' | 'team'
 * @param {string} [params.commitSha]   - Specific commit to document (optional)
 * @param {string} [params.githubToken] - OAuth token for this customer
 * @returns {Promise<{ prUrl, runLog, inputTokens, outputTokens, costCents, durationMs }>}
 */
export async function runDocJob({ owner, name, defaultBranch = 'main', plan = 'starter', commitSha, githubToken }) {
  const runId   = `${owner}-${name}-${Date.now()}`
  const workDir = join(WORK_DIR, runId)
  const started = Date.now()

  // Ensure work dir exists
  mkdirSync(workDir, { recursive: true })

  try {
    // ── 1. Clone the repo ──────────────────────────────────────────────────
    const token = githubToken || process.env.GITHUB_TOKEN
    const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${name}.git`

    console.log(`[runner] Cloning ${owner}/${name} into ${workDir}`)
    execSync(`git clone --depth 50 --single-branch --branch ${defaultBranch} ${cloneUrl} .`, {
      cwd: workDir,
      timeout: 120_000,
      stdio: 'pipe'
    })

    // Configure git identity for the commit
    execSync(`git config user.email "repodoc[bot]@repodoc.dev"`, { cwd: workDir })
    execSync(`git config user.name "RepoDoc Bot"`, { cwd: workDir })
    // Store credentials for push
    execSync(`git config credential.helper store`, { cwd: workDir })
    writeFileSync(join(workDir, '.git-credentials'), `https://x-access-token:${token}@github.com\n`)

    // ── 2. Discover changed files ──────────────────────────────────────────
    const changedFiles = getChangedFiles(workDir, commitSha)
    console.log(`[runner] Changed files: ${changedFiles.join(', ') || '(none specific, using 24h window)'}`)

    // ── 3. Write the MCP config into the work dir ──────────────────────────
    const mcpConfig = {
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', workDir]
        },
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: token }
        }
      }
    }
    writeFileSync(join(workDir, '.mcp.json'), JSON.stringify(mcpConfig, null, 2))

    // Copy CLAUDE.md into the work dir so Claude Code picks it up
    const claudeMdSrc = join(process.cwd(), 'CLAUDE.md')
    if (existsSync(claudeMdSrc)) {
      const { copyFileSync } = await import('fs')
      copyFileSync(claudeMdSrc, join(workDir, 'CLAUDE.md'))
    }

    // ── 4. Build the prompt ────────────────────────────────────────────────
    const prompt = buildPrompt({ owner, name, defaultBranch, changedFiles, commitSha, plan })

    // ── 5. Spawn claude -p --bare ──────────────────────────────────────────
    const allowedTools = [
      'Read',
      'Write',
      'Bash(git log *)',
      'Bash(git diff *)',
      'Bash(git diff-tree *)',
      'Bash(git add *)',
      'Bash(git commit *)',
      'Bash(git checkout *)',
      'Bash(git push *)',
      'Bash(git branch *)',
      'Bash(date *)',
      'Bash(sort *)',
      'Bash(find * -name "*.md")',
      'Bash(find * -name "*.ts")',
      'Bash(find * -name "*.js")',
      'Bash(find * -name "*.py")',
      'Bash(find * -name "*.go")',
      'Bash(cat *)',
      'Bash(ls *)',
    ].join(',')

    const args = [
      '-p', prompt,
      '--bare',
      '--allowedTools', allowedTools,
      '--output-format', 'stream-json',
    ]

    console.log(`[runner] Spawning: ${CLAUDE_BIN} -p "<prompt>" --bare --output-format stream-json`)

    const rawOutput = await new Promise((resolve, reject) => {
      const chunks = []
      const proc = spawn(CLAUDE_BIN, args, {
        cwd: workDir,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          GITHUB_TOKEN: token,
        },
        timeout: 10 * 60 * 1000, // 10-minute hard timeout
      })

      proc.stdout.on('data', d => chunks.push(d.toString()))
      proc.stderr.on('data', d => console.error('[claude stderr]', d.toString()))

      proc.on('close', code => {
        if (code === 0 || code === null) {
          resolve(chunks.join(''))
        } else {
          reject(new Error(`Claude Code exited with code ${code}`))
        }
      })
      proc.on('error', reject)
    })

    // ── 6. Parse results ───────────────────────────────────────────────────
    const { prUrl, runLog, inputTokens, outputTokens } = parseStreamOutput(rawOutput)
    const costCents  = estimateCost(inputTokens, outputTokens)
    const durationMs = Date.now() - started

    console.log(`[runner] Done — PR: ${prUrl ?? 'none'} | tokens: ${inputTokens + outputTokens} | $${(costCents / 100).toFixed(4)} | ${durationMs}ms`)

    return {
      prUrl,
      runLog,
      inputTokens,
      outputTokens,
      tokensUsed: inputTokens + outputTokens,
      costCents,
      durationMs
    }

  } finally {
    // ── 7. Always clean up ─────────────────────────────────────────────────
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch (e) {
      console.warn(`[runner] Failed to clean up ${workDir}:`, e.message)
    }
  }
}
