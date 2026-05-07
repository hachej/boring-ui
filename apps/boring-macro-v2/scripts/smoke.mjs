#!/usr/bin/env node
/**
 * Post-deploy smoke test for boring-macro.
 *
 * Usage:
 *   node scripts/smoke.mjs https://boring-macro.fly.dev
 *   APP_URL=https://boring-macro.fly.dev node scripts/smoke.mjs
 *
 * Env vars:
 *   AGENTMAIL_API_KEY  — agentmail.to key for real email delivery check (optional;
 *                        skips email check if absent). Reuses the first available
 *                        inbox — no inbox creation needed (free tier limit).
 *
 * Exits 0 on full pass, 1 on any failure.
 *
 * Why Origin header matters: browsers always send it; curl does not.
 * A smoke test without it passes even when real signups return "Invalid origin".
 *
 * Why real email check matters: MAIL_FROM/MAIL_TRANSPORT_URL misconfig silently
 * drops emails — the signup endpoint still returns 200, only the inbox is empty.
 */

const APP_URL = process.argv[2] ?? process.env.APP_URL
if (!APP_URL) {
  console.error('Usage: node scripts/smoke.mjs <app-url>')
  process.exit(1)
}

const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY
const AGENTMAIL_BASE = 'https://api.agentmail.to/v0'

const base = APP_URL.replace(/\/$/, '')
const origin = base
const password = 'SmokeTest123!'

let failed = false

async function check(label, fn) {
  try {
    await fn()
    console.log(`  ✓ ${label}`)
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`)
    failed = true
  }
}

async function appGet(path, opts = {}) {
  return fetch(`${base}${path}`, { redirect: 'manual', ...opts })
}

async function appPost(path, body, cookie) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function agentmailGet(path) {
  const res = await fetch(`${AGENTMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${AGENTMAIL_KEY}` },
  })
  if (!res.ok) throw new Error(`agentmail GET ${path} → ${res.status}`)
  return res.json()
}

async function waitForEmail(inboxId, { after, subject, timeoutMs = 20000, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const data = await agentmailGet(`/inboxes/${inboxId}/messages?limit=10`)
    const messages = data.messages ?? data.data ?? []
    const match = messages.find(m => {
      const receivedAt = new Date(m.received_at ?? m.created_at ?? 0).getTime()
      const subjectOk = !subject || m.subject?.toLowerCase().includes(subject.toLowerCase())
      const timeOk = !after || receivedAt >= after
      return subjectOk && timeOk
    })
    if (match) return match
    await new Promise(r => setTimeout(r, pollMs))
  }
  throw new Error(`no email matching "${subject}" arrived within ${timeoutMs}ms`)
}

async function fetchEmailBody(inboxId, messageId) {
  const encoded = encodeURIComponent(messageId)
  return agentmailGet(`/inboxes/${inboxId}/messages/${encoded}`)
}

function extractLink(text, pattern) {
  const match = text?.match(pattern)
  return match?.[0] ?? null
}

console.log(`\nSmoke testing ${base}\n`)

// ── Infrastructure ────────────────────────────────────────────────────────────

await check('/health → 200', async () => {
  const res = await appGet('/health')
  if (res.status !== 200) throw new Error(`got ${res.status}`)
})

await check('/ready → 200', async () => {
  const res = await appGet('/ready')
  if (res.status !== 200) throw new Error(`got ${res.status}`)
})

await check('/ → 200 (SPA shell)', async () => {
  const res = await appGet('/')
  if (res.status !== 200) throw new Error(`got ${res.status}`)
  const text = await res.text()
  if (!text.includes('<!doctype html') && !text.includes('<!DOCTYPE html'))
    throw new Error('response is not HTML')
})

// ── Auth (with Origin header — required for browser parity) ──────────────────

let sessionCookie = ''
let inboxId = null
let email = `smoke-${Date.now()}@example.com`
let signupTime = null

if (AGENTMAIL_KEY) {
  // Reuse the first available inbox (free tier caps at 3; no creation needed).
  // Use email+tag addressing so each run gets a unique address — avoids
  // "user already exists" errors while all mail still lands in the same inbox.
  const data = await agentmailGet('/inboxes')
  const inboxes = data.inboxes ?? data.data ?? []
  if (!inboxes.length) throw new Error('no agentmail inboxes available')
  inboxId = inboxes[0].inbox_id
  const [local, domain] = inboxes[0].email.split('@')
  email = `${local}+smoke-${Date.now()}@${domain}`
  console.log(`  (using inbox: ${inboxId}, address: ${email})`)
}

await check('POST /auth/sign-up/email with Origin → 200', async () => {
  signupTime = Date.now()
  const res = await appPost('/auth/sign-up/email', { email, password, name: 'Smoke Test' })
  if (res.status !== 200) {
    const body = await res.text()
    throw new Error(`got ${res.status}: ${body.slice(0, 120)}`)
  }
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) sessionCookie = setCookie.split(';')[0]
})

if (inboxId) {
  await check('verification email delivered + link works (agentmail)', async () => {
    const msg = await waitForEmail(inboxId, { subject: 'verify', after: signupTime, timeoutMs: 20000 })
    const body = await fetchEmailBody(inboxId, msg.message_id)
    const link = extractLink(body.text ?? body.extracted_text ?? '', /https?:\/\/\S+verify-email\S+/)
    if (!link) throw new Error('no verification link found in email body')
    const res = await fetch(link, { redirect: 'follow' })
    if (res.status !== 200) throw new Error(`verification link returned ${res.status}`)
  })
}

// Sign in AFTER email verification so the session reflects emailVerified: true
await check('POST /auth/sign-in/email with Origin → 200', async () => {
  const res = await appPost('/auth/sign-in/email', { email, password })
  if (res.status !== 200) {
    const body = await res.text()
    throw new Error(`got ${res.status}: ${body.slice(0, 120)}`)
  }
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) sessionCookie = setCookie.split(';')[0]
})

await check('GET /auth/get-session → 200 with verified user', async () => {
  const res = await fetch(`${base}/auth/get-session`, {
    headers: { Origin: origin, ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
  })
  if (res.status !== 200) throw new Error(`got ${res.status}`)
  const json = await res.json()
  if (!json?.user?.email) throw new Error(`no user in session: ${JSON.stringify(json).slice(0, 80)}`)
  if (inboxId && !json.user.emailVerified) throw new Error('emailVerified is still false after clicking link')
})

await check('GET /api/v1/agent/catalog → 401 (auth guard)', async () => {
  const res = await appGet('/api/v1/agent/catalog')
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
})

if (!AGENTMAIL_KEY) {
  console.log('\n  ⚠ AGENTMAIL_API_KEY not set — email delivery not verified')
}

console.log(`\n${failed ? '❌ Some checks failed' : '✅ All checks passed'}\n`)
process.exit(failed ? 1 : 0)
