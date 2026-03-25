/**
 * server.js — PushScribe main entry point
 *
 * Express server that handles:
 * - Inbound GitHub & Stripe webhooks
 * - REST API for the dashboard
 * - Static dashboard UI
 * - Daily cron scheduler
 */

import 'dotenv/config'
import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { rateLimit } from 'express-rate-limit'

import apiRouter     from './api.js'
import webhookRouter from './webhook.js'
import { startCron } from './cron.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT      = parseInt(process.env.PORT ?? '3000', 10)

const app = express()

// ─── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ─── Raw body capture for webhook signature verification ───────────────────
// Scoped to /webhook only — must come after body parsers
app.use('/webhook', (req, res, next) => {
  req.rawBody = JSON.stringify(req.body)
  next()
})

// ─── Security headers ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// ─── Rate limiting ─────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // GitHub can fire many webhooks quickly
})

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/webhook',  webhookLimiter, webhookRouter)
app.use('/api',      apiLimiter,     apiRouter)

// ─── Named page routes (must come before static) ───────────────────────────
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'landing.html'))
})

app.get('/app', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'))
})

// ─── Static files ──────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'public')))

// Catch-all → serve dashboard SPA
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'))
})

// ─── Error handler ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║           PushScribe is running             ║
╠══════════════════════════════════════════╣
║  Dashboard  →  http://localhost:${PORT}     ║
║  API        →  http://localhost:${PORT}/api ║
║  Webhooks   →  POST /webhook/github      ║
╚══════════════════════════════════════════╝
`)

  if (process.env.NODE_ENV !== 'test') {
    startCron()
  }
})

export default app
