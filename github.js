/**
 * github.js — GitHub API helpers
 *
 * Wraps Octokit for the operations RepoDoc needs:
 * - Registering / removing webhooks on customer repos
 * - Validating webhook signatures
 * - Fetching repo metadata
 */

import { Octokit } from '@octokit/rest'
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Create an authenticated Octokit instance.
 * Uses the customer's token if provided, otherwise falls back to the
 * app-level GITHUB_TOKEN.
 */
export function createGitHubClient(token) {
  return new Octokit({ auth: token || process.env.GITHUB_TOKEN })
}

/**
 * Register a webhook on a GitHub repo that points to our /webhook endpoint.
 * Returns the webhook ID.
 */
export async function registerWebhook({ owner, name, token }) {
  const octokit  = createGitHubClient(token)
  const base_url = process.env.BASE_URL || 'https://your-app.up.railway.app'

  const { data } = await octokit.repos.createWebhook({
    owner,
    repo: name,
    config: {
      url:          `${base_url}/webhook/github`,
      content_type: 'json',
      secret:       process.env.GITHUB_WEBHOOK_SECRET,
    },
    events: ['push'],
    active: true,
  })

  return data.id
}

/**
 * Remove a previously registered webhook.
 */
export async function removeWebhook({ owner, name, webhookId, token }) {
  const octokit = createGitHubClient(token)
  await octokit.repos.deleteWebhook({
    owner,
    repo:       name,
    hook_id:    webhookId,
  })
}

/**
 * Fetch basic repo info (default branch, visibility, etc.)
 */
export async function getRepoInfo({ owner, name, token }) {
  const octokit = createGitHubClient(token)
  const { data } = await octokit.repos.get({ owner, repo: name })
  return {
    defaultBranch: data.default_branch,
    private:       data.private,
    description:   data.description,
    language:      data.language,
  }
}

/**
 * List files changed in a specific commit.
 */
export async function getCommitFiles({ owner, name, commitSha, token }) {
  const octokit = createGitHubClient(token)
  const { data } = await octokit.repos.getCommit({
    owner,
    repo: name,
    ref:  commitSha,
  })
  return (data.files ?? []).map(f => f.filename)
}

/**
 * Validate an incoming GitHub webhook signature.
 * Returns true if the signature matches, false otherwise.
 *
 * GitHub sends: X-Hub-Signature-256: sha256=<hex>
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) return true // Warn in production — never skip in real deployment

  if (!signatureHeader) return false

  const [algorithm, receivedHex] = signatureHeader.split('=')
  if (algorithm !== 'sha256') return false

  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  try {
    return timingSafeEqual(
      Buffer.from(receivedHex, 'hex'),
      Buffer.from(expected,     'hex')
    )
  } catch {
    return false
  }
}
