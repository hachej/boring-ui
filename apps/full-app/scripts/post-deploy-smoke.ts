const BEAD_ID = 'boring-ui-v2-6u3z'
const REQUEST_TIMEOUT_MS = 10_000
const RESEND_POLL_TIMEOUT_MS = 60_000
const RESEND_POLL_INTERVAL_MS = 5_000

const VERIFY_LINK_PATTERN = /https?:\/\/[^\s"'<>]+\/auth\/verify-email\?[^\s"'<>]+/i

interface LogFields {
  [key: string]: unknown
}

interface SmokeResult {
  ok: boolean
  step: string
  detail?: string
}

interface SentEmailSummary {
  id: string
  to: string[]
  subject: string | null
  created_at: string
}

interface SentEmailsListResponse {
  data?: SentEmailSummary[]
}

interface RetrievedEmailResponse {
  id?: string
  to?: string[]
  subject?: string
  html?: string | null
  text?: string | null
}

function log(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    bead: BEAD_ID,
    ...fields,
  }

  const serialized = JSON.stringify(line)
  if (level === 'error') {
    console.error(serialized)
    return
  }

  if (level === 'warn') {
    console.warn(serialized)
    return
  }

  console.log(serialized)
}

function fail(step: string, detail: string): never {
  log('error', 'smoke.step.failed', { step, detail })
  throw new Error(`[${step}] ${detail}`)
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    fail('input', 'DEPLOY_URL is empty')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    fail('input', `DEPLOY_URL is not a valid URL: ${trimmed}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('input', `DEPLOY_URL must be http/https: ${trimmed}`)
  }

  return parsed.toString().replace(/\/$/, '')
}

function parseSetCookie(headers: Headers): string | null {
  const raw = headers.get('set-cookie')
  if (!raw) return null

  const chunks = raw
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((value) => value.trim())
    .filter(Boolean)

  const cookies = chunks
    .map((value) => value.split(';')[0]?.trim())
    .filter(Boolean)

  if (cookies.length === 0) return null
  return cookies.join('; ')
}

function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') {
    acc.push(value)
    return acc
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, acc)
    return acc
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectStrings(nested, acc)
    }
  }

  return acc
}

function extractVerifyLink(value: unknown): string | null {
  const strings = collectStrings(value)
  for (const chunk of strings) {
    const normalized = chunk.replaceAll('&amp;', '&')
    const match = normalized.match(VERIFY_LINK_PATTERN)
    if (match?.[0]) return match[0]
  }
  return null
}

async function requestJson(
  url: string,
  init: RequestInit,
  step: string,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    fail(step, `request failed: ${detail}`)
  }

  const text = await response.text()
  let parsed: unknown = text
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // Keep original text for diagnostics when endpoint is non-JSON.
    }
  }

  return { status: response.status, json: parsed, headers: response.headers }
}

async function stepHealth(baseUrl: string): Promise<SmokeResult> {
  const step = 'health'
  log('info', 'smoke.step.start', { step, url: `${baseUrl}/health` })

  const { status, json } = await requestJson(`${baseUrl}/health`, { method: 'GET' }, step)

  if (status !== 200) {
    fail(step, `expected HTTP 200, got ${status} (${JSON.stringify(json)})`)
  }

  const ok = (json as { ok?: unknown })?.ok
  if (ok !== true) {
    fail(step, `expected body.ok === true, got ${JSON.stringify(json)}`)
  }

  log('info', 'smoke.step.ok', { step, status })
  return { ok: true, step }
}

function buildSignupPayload(email: string): Record<string, string> {
  return {
    name: 'Deploy Smoke',
    email,
    password: process.env.SMOKE_PASSWORD ?? 'Zk8$mN!qR2xFgWpJ',
    callbackURL: '/workspace',
  }
}

async function trySignup(
  baseUrl: string,
  email: string,
): Promise<{ payload: unknown; cookie: string | null; usedPath: string }> {
  const paths = (process.env.SMOKE_SIGNUP_PATHS ?? '/auth/sign-up/email,/api/auth/sign-up/email')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const payload = buildSignupPayload(email)
  const attempts: Array<{ path: string; status: number; body: unknown }> = []

  for (const path of paths) {
    const step = 'signup'
    const target = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
    log('info', 'smoke.signup.attempt', { step, path })

    const { status, json, headers } = await requestJson(
      target,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      step,
    )

    attempts.push({ path, status, body: json })

    if (status === 200) {
      const cookie = parseSetCookie(headers)
      log('info', 'smoke.signup.success', { step, path, status, hasCookie: Boolean(cookie) })
      return { payload: json, cookie, usedPath: path }
    }
  }

  const summary = attempts.map((a) => `${a.path}:${a.status}`).join(', ')
  fail('signup', `all signup paths failed (${summary}); payload=${JSON.stringify(attempts)}`)
}

async function listSentEmails(apiKey: string, limit = 50): Promise<SentEmailSummary[]> {
  const res = await fetch(`https://api.resend.com/emails?limit=${limit}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`list sent emails failed (${res.status}): ${body}`)
  }

  const payload = (await res.json()) as SentEmailsListResponse
  return payload.data ?? []
}

async function retrieveEmail(apiKey: string, id: string): Promise<RetrievedEmailResponse> {
  const res = await fetch(`https://api.resend.com/emails/${id}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`retrieve email failed (${res.status}): ${body}`)
  }

  return (await res.json()) as RetrievedEmailResponse
}

async function findVerifyLinkViaResend(
  apiKey: string,
  recipient: string,
  notBeforeMs: number,
): Promise<string | null> {
  const deadline = Date.now() + RESEND_POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const sent = await listSentEmails(apiKey)
    const candidates = sent.filter((email) => {
      const createdAt = Date.parse(email.created_at)
      const toList = email.to ?? []
      return createdAt >= notBeforeMs && toList.some((to) => to.toLowerCase() === recipient.toLowerCase())
    })

    for (const candidate of candidates) {
      const details = await retrieveEmail(apiKey, candidate.id)
      const verifyLink = extractVerifyLink(details)
      if (verifyLink) {
        return verifyLink
      }
    }

    await new Promise((resolve) => setTimeout(resolve, RESEND_POLL_INTERVAL_MS))
  }

  return null
}

async function stepSignup(baseUrl: string): Promise<{ email: string; cookie: string | null; verifyLink: string }> {
  const step = 'signup'
  const timestamp = Date.now()
  const emailDomain = process.env.SMOKE_EMAIL_DOMAIN ?? 'example.com'
  const email = process.env.SMOKE_EMAIL ?? `smoke-${timestamp}@${emailDomain}`

  if (!process.env.SMOKE_EMAIL && !process.env.SMOKE_EMAIL_DOMAIN) {
    log('warn', 'smoke.signup.email_domain.default', {
      defaultDomain: emailDomain,
      detail: 'set SMOKE_EMAIL or SMOKE_EMAIL_DOMAIN for deterministic email delivery',
    })
  }

  log('info', 'smoke.step.start', { step, email })

  const signupStartedAt = Date.now()
  const { payload, cookie, usedPath } = await trySignup(baseUrl, email)

  let verifyLink = extractVerifyLink(payload)

  if (!verifyLink) {
    const resendApiKey = process.env.RESEND_API_KEY
    if (resendApiKey) {
      log('info', 'smoke.signup.email_poll.start', {
        provider: 'resend',
        timeoutMs: RESEND_POLL_TIMEOUT_MS,
      })
      verifyLink = await findVerifyLinkViaResend(resendApiKey, email, signupStartedAt - 1_000)
    }
  }

  if (!verifyLink) {
    fail(
      step,
      'signup succeeded but no verify-email link was found in response or resend inbox (set RESEND_API_KEY for email polling)',
    )
  }

  log('info', 'smoke.step.ok', {
    step,
    email,
    usedPath,
    hasCookie: Boolean(cookie),
    verifyLinkHost: new URL(verifyLink).host,
  })

  return { email, cookie, verifyLink }
}

async function stepCapabilities(baseUrl: string, cookie: string | null): Promise<SmokeResult> {
  const step = 'capabilities'
  log('info', 'smoke.step.start', { step, url: `${baseUrl}/api/v1/capabilities` })

  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie

  const { status, json } = await requestJson(
    `${baseUrl}/api/v1/capabilities`,
    { method: 'GET', headers },
    step,
  )

  if (status !== 200) {
    fail(step, `expected HTTP 200, got ${status} (${JSON.stringify(json)})`)
  }

  if (!json || typeof json !== 'object' || !('agent' in (json as Record<string, unknown>))) {
    fail(step, `expected response to include 'agent' key, got ${JSON.stringify(json)}`)
  }

  log('info', 'smoke.step.ok', { step, status })
  return { ok: true, step }
}

async function main(): Promise<void> {
  const baseUrl = normalizeBaseUrl(process.env.DEPLOY_URL ?? '')

  log('info', 'smoke.start', {
    deployUrl: baseUrl,
    bead: BEAD_ID,
    timeoutMs: REQUEST_TIMEOUT_MS,
  })

  await stepHealth(baseUrl)
  const signup = await stepSignup(baseUrl)
  await stepCapabilities(baseUrl, signup.cookie)

  log('info', 'smoke.complete', {
    deployUrl: baseUrl,
    signupEmail: signup.email,
  })
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error)
  log('error', 'smoke.failed', { detail })
  process.exit(1)
})
