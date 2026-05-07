#!/usr/bin/env node
/**
 * Post-deploy smoke test for boring-macro.
 *
 * Usage:
 *   node scripts/smoke.mjs https://boring-macro.fly.dev
 *   APP_URL=https://boring-macro.fly.dev node scripts/smoke.mjs
 *
 * Exits 0 on full pass, 1 on any failure.
 *
 * Why Origin header matters: browsers always send it; curl does not.
 * A smoke test without it passes even when real signups return "Invalid origin".
 */

const APP_URL = process.argv[2] ?? process.env.APP_URL
if (!APP_URL) {
  console.error('Usage: node scripts/smoke.mjs <app-url>')
  process.exit(1)
}

const base = APP_URL.replace(/\/$/, '')
const origin = base
const email = `smoke-${Date.now()}@example.com`
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

async function get(path, opts = {}) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual', ...opts })
  return res
}

async function post(path, body, cookie) {
  const headers = {
    'Content-Type': 'application/json',
    Origin: origin,
    ...(cookie ? { Cookie: cookie } : {}),
  }
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return res
}

console.log(`\nSmoke testing ${base}\n`)

// Infrastructure checks
await check('/health → 200', async () => {
  const res = await get('/health')
  if (res.status !== 200) throw new Error(`got ${res.status}`)
})

await check('/ready → 200', async () => {
  const res = await get('/ready')
  if (res.status !== 200) throw new Error(`got ${res.status}`)
})

await check('/ → 200 (SPA shell)', async () => {
  const res = await get('/')
  if (res.status !== 200) throw new Error(`got ${res.status}`)
  const text = await res.text()
  if (!text.includes('<!doctype html') && !text.includes('<!DOCTYPE html')) {
    throw new Error('response is not HTML')
  }
})

// Auth checks — these MUST include Origin header (browser behaviour)
let sessionCookie = ''

await check('POST /auth/sign-up/email with Origin → 200', async () => {
  const res = await post('/auth/sign-up/email', { email, password, name: 'Smoke Test' })
  if (res.status !== 200) {
    const body = await res.text()
    throw new Error(`got ${res.status}: ${body.slice(0, 120)}`)
  }
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) sessionCookie = setCookie.split(';')[0]
})

await check('POST /auth/sign-in/email with Origin → 200', async () => {
  const res = await post('/auth/sign-in/email', { email, password })
  if (res.status !== 200) {
    const body = await res.text()
    throw new Error(`got ${res.status}: ${body.slice(0, 120)}`)
  }
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) sessionCookie = setCookie.split(';')[0]
})

await check('GET /auth/get-session → 200 with user', async () => {
  const res = await fetch(`${base}/auth/get-session`, {
    headers: { Origin: origin, ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
  })
  if (res.status !== 200) throw new Error(`got ${res.status}`)
  const json = await res.json()
  if (!json?.user?.email) throw new Error(`no user in session: ${JSON.stringify(json).slice(0, 80)}`)
})

await check('GET /api/v1/agent/catalog → 401 (auth guard)', async () => {
  const res = await get('/api/v1/agent/catalog')
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
})

console.log(`\n${failed ? '❌ Some checks failed' : '✅ All checks passed'}\n`)
process.exit(failed ? 1 : 0)
