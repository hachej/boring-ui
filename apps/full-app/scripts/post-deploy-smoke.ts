const TASK_ID = 'boring-ui-v2-6u3z'
const REQUEST_TIMEOUT_MS = readPositiveIntEnv('SMOKE_REQUEST_TIMEOUT_MS', 10_000)
const RESEND_POLL_TIMEOUT_MS = 60_000
const RESEND_POLL_INTERVAL_MS = 5_000
const AGENT_CHAT_TIMEOUT_MS = readPositiveIntEnv('SMOKE_AGENT_CHAT_TIMEOUT_MS', 120_000)
const AGENT_SMOKE_MODEL_PROVIDER = process.env.SMOKE_AGENT_MODEL_PROVIDER ?? 'openrouter'
const AGENT_SMOKE_MODEL_ID = process.env.SMOKE_AGENT_MODEL_ID ?? 'qwen/qwen3.6-plus'

const VERIFY_LINK_PATTERN = /https?:\/\/[^\s"'<>]+\/auth\/verify-email\?[^\s"'<>]+/i
const RESET_LINK_PATTERN = /https?:\/\/[^\s"'<>]+\/auth\/reset-password(?:\/[^\s"'<>?]+|\?)[^\s"'<>]*/i

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

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

interface AgentMailInbox {
  inboxId: string
  email: string
}

interface AgentMailInboxResponse {
  inbox_id?: string
  inboxId?: string
  email?: string
}

interface AgentMailMessageSummary {
  message_id?: string
  messageId?: string
  to?: string[]
  subject?: string | null
  timestamp?: string
  created_at?: string
}

interface AgentMailListMessagesResponse {
  messages?: AgentMailMessageSummary[]
}

interface AgentMailMessageResponse extends AgentMailMessageSummary {
  html?: string | null
  text?: string | null
  extracted_html?: string | null
  extracted_text?: string | null
}

function log(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    task: TASK_ID,
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

function extractLink(value: unknown, pattern: RegExp): string | null {
  const strings = collectStrings(value)
  for (const chunk of strings) {
    const normalized = chunk.replaceAll('&amp;', '&')
    const match = normalized.match(pattern)
    if (match?.[0]) return match[0]
  }
  return null
}

function extractVerifyLink(value: unknown): string | null {
  return extractLink(value, VERIFY_LINK_PATTERN)
}

function extractResetLink(value: unknown): string | null {
  return extractLink(value, RESET_LINK_PATTERN)
}

async function requestText(
  url: string,
  init: RequestInit,
  step: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ status: number; text: string; headers: Headers }> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    fail(step, `request failed: ${detail}`)
  }

  try {
    return { status: response.status, text: await response.text(), headers: response.headers }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    fail(step, `response body read failed: ${detail}`)
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  step: string,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const { status, text, headers } = await requestText(url, init, step)
  let parsed: unknown = text
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // Keep original text for diagnostics when endpoint is non-JSON.
    }
  }

  return { status, json: parsed, headers }
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
        headers: { 'content-type': 'application/json', origin: baseUrl },
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

async function findLinkViaResend(
  apiKey: string,
  recipient: string,
  notBeforeMs: number,
  extract: (value: unknown) => string | null,
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
      const link = extract(details)
      if (link) {
        return link
      }
    }

    await new Promise((resolve) => setTimeout(resolve, RESEND_POLL_INTERVAL_MS))
  }

  return null
}

async function findVerifyLinkViaResend(
  apiKey: string,
  recipient: string,
  notBeforeMs: number,
): Promise<string | null> {
  return findLinkViaResend(apiKey, recipient, notBeforeMs, extractVerifyLink)
}

async function findResetLinkViaResend(
  apiKey: string,
  recipient: string,
  notBeforeMs: number,
): Promise<string | null> {
  return findLinkViaResend(apiKey, recipient, notBeforeMs, extractResetLink)
}

async function listAgentMailInboxes(apiKey: string): Promise<AgentMailInbox[]> {
  const res = await fetch('https://api.agentmail.to/v0/inboxes?limit=20', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`list AgentMail inboxes failed (${res.status}): ${text}`)
  }
  const payload = (await res.json()) as { inboxes?: AgentMailInboxResponse[] }
  return (payload.inboxes ?? [])
    .map((inbox) => ({ inboxId: inbox.inbox_id ?? inbox.inboxId ?? '', email: inbox.email ?? '' }))
    .filter((inbox) => inbox.inboxId && inbox.email)
}

async function createAgentMailInbox(apiKey: string, timestamp: number): Promise<AgentMailInbox> {
  const body = {
    client_id: process.env.AGENTMAIL_CLIENT_ID ?? `boring-smoke-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    display_name: 'Boring Smoke Test',
    ...(process.env.AGENTMAIL_USERNAME ? { username: process.env.AGENTMAIL_USERNAME } : {}),
    ...(process.env.AGENTMAIL_DOMAIN ? { domain: process.env.AGENTMAIL_DOMAIN } : {}),
  }

  const res = await fetch('https://api.agentmail.to/v0/inboxes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const text = await res.text()
    if (res.status === 403 && /LimitExceededError|Inbox limit exceeded/i.test(text)) {
      const existing = await listAgentMailInboxes(apiKey)
      if (existing[0]) {
        log('warn', 'smoke.agentmail.inbox.reusing_existing', {
          inboxId: existing[0].inboxId,
          reason: 'create limit exceeded',
        })
        return existing[0]
      }
    }
    throw new Error(`create AgentMail inbox failed (${res.status}): ${text}`)
  }

  const payload = (await res.json()) as AgentMailInboxResponse
  const inboxId = payload.inbox_id ?? payload.inboxId
  if (!inboxId || !payload.email) {
    throw new Error(`create AgentMail inbox returned incomplete payload: ${JSON.stringify(payload)}`)
  }
  return { inboxId, email: payload.email }
}

async function prepareAgentMailInbox(timestamp: number): Promise<AgentMailInbox | null> {
  const apiKey = process.env.AGENTMAIL_API_KEY
  if (!apiKey) return null

  const configuredInboxId = process.env.AGENTMAIL_INBOX_ID
  const configuredEmail = process.env.AGENTMAIL_EMAIL ?? process.env.SMOKE_EMAIL
  if (configuredInboxId && configuredEmail) {
    return { inboxId: configuredInboxId, email: configuredEmail }
  }

  const inbox = await createAgentMailInbox(apiKey, timestamp)
  log('info', 'smoke.agentmail.inbox.created', { inboxId: inbox.inboxId, email: inbox.email })
  return inbox
}

async function stepSignup(baseUrl: string): Promise<{ email: string; cookie: string | null; verifyLink: string; agentMail: AgentMailInbox | null }> {
  const step = 'signup'
  const timestamp = Date.now()
  const agentMail = !process.env.SMOKE_EMAIL && process.env.AGENTMAIL_API_KEY
    ? await prepareAgentMailInbox(timestamp)
    : (process.env.AGENTMAIL_API_KEY && process.env.AGENTMAIL_INBOX_ID
        ? await prepareAgentMailInbox(timestamp)
        : null)
  const emailDomain = process.env.SMOKE_EMAIL_DOMAIN ?? 'example.com'
  const email = process.env.SMOKE_EMAIL ?? agentMail?.email ?? `smoke-${timestamp}@${emailDomain}`

  if (!process.env.SMOKE_EMAIL && !process.env.SMOKE_EMAIL_DOMAIN && !agentMail) {
    log('warn', 'smoke.signup.email_domain.default', {
      defaultDomain: emailDomain,
      detail: 'set SMOKE_EMAIL, SMOKE_EMAIL_DOMAIN, or AGENTMAIL_API_KEY for deterministic email delivery',
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
    if (process.env.SMOKE_SKIP_VERIFY_EMAIL === '1') {
      log('warn', 'smoke.signup.verify_email_skipped', {
        step,
        detail:
          'no verify link captured but SMOKE_SKIP_VERIFY_EMAIL=1 — proceeding without verifying email (suitable for dev / console:// transports)',
      })
      verifyLink = ''
    } else {
      fail(
        step,
        'signup succeeded but no verify-email link was found in response or resend inbox (set RESEND_API_KEY for email polling, or SMOKE_SKIP_VERIFY_EMAIL=1 to skip)',
      )
    }
  }

  log('info', 'smoke.step.ok', {
    step,
    email,
    usedPath,
    hasCookie: Boolean(cookie),
    verifyLinkHost: verifyLink ? new URL(verifyLink).host : null,
  })

  return { email, cookie, verifyLink, agentMail }
}

async function listAgentMailMessages(apiKey: string, inboxId: string): Promise<AgentMailMessageSummary[]> {
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`list AgentMail messages failed (${res.status}): ${body}`)
  }
  const payload = (await res.json()) as AgentMailListMessagesResponse
  return payload.messages ?? []
}

async function retrieveAgentMailMessage(
  apiKey: string,
  inboxId: string,
  messageId: string,
): Promise<AgentMailMessageResponse> {
  const res = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`retrieve AgentMail message failed (${res.status}): ${body}`)
  }
  return (await res.json()) as AgentMailMessageResponse
}

async function findResetLinkViaAgentMail(
  apiKey: string,
  inbox: AgentMailInbox,
  notBeforeMs: number,
): Promise<string | null> {
  const deadline = Date.now() + RESEND_POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const messages = await listAgentMailMessages(apiKey, inbox.inboxId)
    const candidates = messages.filter((message) => {
      const createdAt = Date.parse(message.timestamp ?? message.created_at ?? '')
      const toList = message.to ?? []
      return createdAt >= notBeforeMs && toList.some((to) => to.toLowerCase() === inbox.email.toLowerCase())
    })

    for (const candidate of candidates) {
      const messageId = candidate.message_id ?? candidate.messageId
      if (!messageId) continue
      const details = await retrieveAgentMailMessage(apiKey, inbox.inboxId, messageId)
      const resetLink = extractResetLink(details)
      if (resetLink) return resetLink
    }

    await new Promise((resolve) => setTimeout(resolve, RESEND_POLL_INTERVAL_MS))
  }

  return null
}

async function stepVerifyEmail(verifyLink: string): Promise<void> {
  const step = 'verify-email'
  if (!verifyLink) {
    log('warn', 'smoke.step.skipped', { step, reason: 'no verify link available' })
    return
  }

  log('info', 'smoke.step.start', { step, host: new URL(verifyLink).host })
  const { status, text } = await requestText(
    verifyLink,
    { method: 'GET', redirect: 'follow' },
    step,
  )
  if (status < 200 || status >= 400) {
    fail(step, `expected verify link to return <400, got ${status} (${text.slice(0, 500)})`)
  }
  log('info', 'smoke.step.ok', { step, status })
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

async function stepSignin(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{ cookie: string }> {
  const step = 'signin'
  log('info', 'smoke.step.start', { step, email })

  const paths = (process.env.SMOKE_SIGNIN_PATHS ?? '/auth/sign-in/email,/api/auth/sign-in/email')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  const attempts: Array<{ path: string; status: number; body: unknown }> = []
  for (const path of paths) {
    const url = `${baseUrl}${path}`
    log('info', 'smoke.signin.attempt', { step, path })
    const { status, json, headers } = await requestJson(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ email, password }),
      },
      step,
    )
    attempts.push({ path, status, body: json })
    if (status >= 200 && status < 300) {
      const cookie = parseSetCookie(headers)
      if (!cookie) {
        fail(step, `signin succeeded (${status} on ${path}) but no Set-Cookie returned`)
      }
      log('info', 'smoke.signin.success', { step, path, status })
      return { cookie }
    }
  }

  const summary = attempts.map((a) => `${a.path}=${a.status}`).join(', ')
  fail('signin', `all signin paths failed (${summary}); payload=${JSON.stringify(attempts)}`)
}

async function requestPasswordReset(baseUrl: string, email: string): Promise<unknown> {
  const step = 'password-reset.request'
  const paths = (process.env.SMOKE_FORGOT_PASSWORD_PATHS ?? '/auth/forget-password,/auth/request-password-reset,/api/auth/forget-password,/api/auth/request-password-reset')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const attempts: Array<{ path: string; status: number; body: unknown }> = []

  for (const path of paths) {
    log('info', 'smoke.password_reset.request.attempt', { step, path, email })
    const { status, json } = await requestJson(
      `${baseUrl}${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ email, redirectTo: '/auth/reset-password' }),
      },
      step,
    )
    attempts.push({ path, status, body: json })
    if (status >= 200 && status < 300) return json
  }

  const summary = attempts.map((a) => `${a.path}=${a.status}`).join(', ')
  fail(step, `all forgot-password paths failed (${summary}); payload=${JSON.stringify(attempts)}`)
}

async function resetPasswordWithToken(
  baseUrl: string,
  token: string,
  newPassword: string,
): Promise<void> {
  const step = 'password-reset.consume'
  const paths = (process.env.SMOKE_RESET_PASSWORD_PATHS ?? '/auth/reset-password,/api/auth/reset-password')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const attempts: Array<{ path: string; status: number; body: unknown }> = []

  for (const path of paths) {
    log('info', 'smoke.password_reset.consume.attempt', { step, path })
    const { status, json } = await requestJson(
      `${baseUrl}${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ token, newPassword }),
      },
      step,
    )
    attempts.push({ path, status, body: json })
    if (status >= 200 && status < 300) {
      log('info', 'smoke.step.ok', { step, path, status })
      return
    }
  }

  const summary = attempts.map((a) => `${a.path}=${a.status}`).join(', ')
  fail(step, `all reset-password paths failed (${summary}); payload=${JSON.stringify(attempts)}`)
}

async function trySigninOnce(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{ ok: boolean; status: number; cookie: string | null; body: unknown; path: string }> {
  const path = (process.env.SMOKE_SIGNIN_PATHS ?? '/auth/sign-in/email,/api/auth/sign-in/email')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)[0] ?? '/auth/sign-in/email'
  const { status, json, headers } = await requestJson(
    `${baseUrl}${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ email, password }),
    },
    'signin.probe',
  )
  return { ok: status >= 200 && status < 300, status, cookie: parseSetCookie(headers), body: json, path }
}

async function stepPasswordReset(
  baseUrl: string,
  email: string,
  oldPassword: string,
  agentMail: AgentMailInbox | null,
): Promise<{ cookie: string; newPassword: string }> {
  const step = 'password-reset'
  if (process.env.SMOKE_SKIP_PASSWORD_RESET === '1') {
    log('warn', 'smoke.password_reset.skipped', { step, reason: 'SMOKE_SKIP_PASSWORD_RESET=1' })
    const signedIn = await stepSignin(baseUrl, email, oldPassword)
    return { cookie: signedIn.cookie, newPassword: oldPassword }
  }

  log('info', 'smoke.step.start', { step, email, agentMail: Boolean(agentMail), resend: Boolean(process.env.RESEND_API_KEY) })
  const startedAt = Date.now()
  const payload = await requestPasswordReset(baseUrl, email)
  let resetLink = extractResetLink(payload)
  let resendLink: string | null = null
  let agentMailLink: string | null = null

  const resendApiKey = process.env.RESEND_API_KEY
  if (resendApiKey) {
    log('info', 'smoke.password_reset.email_poll.start', { provider: 'resend', timeoutMs: RESEND_POLL_TIMEOUT_MS })
    resendLink = await findResetLinkViaResend(resendApiKey, email, startedAt - 1_000)
    resetLink = resetLink ?? resendLink
  }

  const agentMailApiKey = process.env.AGENTMAIL_API_KEY
  if (agentMailApiKey && agentMail) {
    log('info', 'smoke.password_reset.email_poll.start', { provider: 'agentmail', inboxId: agentMail.inboxId, timeoutMs: RESEND_POLL_TIMEOUT_MS })
    agentMailLink = await findResetLinkViaAgentMail(agentMailApiKey, agentMail, startedAt - 1_000)
    resetLink = agentMailLink ?? resetLink
  }

  if (resendApiKey && !resendLink) {
    fail(step, 'reset email was not found in Resend sent mail')
  }
  if (agentMailApiKey && agentMail && !agentMailLink) {
    fail(step, 'reset email was not received in AgentMail inbox')
  }
  if (!resetLink) {
    fail(step, 'forgot-password succeeded but no reset-password link was found (set RESEND_API_KEY and/or AGENTMAIL_API_KEY, or SMOKE_SKIP_PASSWORD_RESET=1)')
  }

  const resetUrl = new URL(resetLink)
  const pathToken = resetUrl.pathname.match(/\/auth\/reset-password\/([^/]+)$/)?.[1]
  const token = resetUrl.searchParams.get('token') ?? (pathToken ? decodeURIComponent(pathToken) : null)
  if (!token) fail(step, `reset link did not include token: ${resetLink}`)

  const newPassword = process.env.SMOKE_RESET_PASSWORD ?? `${oldPassword}!Reset1`
  await resetPasswordWithToken(baseUrl, token, newPassword)

  const signedIn = await stepSignin(baseUrl, email, newPassword)
  if (process.env.SMOKE_ASSERT_OLD_PASSWORD_REJECTED !== '0' && oldPassword !== newPassword) {
    const oldSignin = await trySigninOnce(baseUrl, email, oldPassword)
    if (oldSignin.ok) {
      fail(step, `old password still signs in after reset via ${oldSignin.path}`)
    }
    log('info', 'smoke.password_reset.old_password_rejected', { status: oldSignin.status, path: oldSignin.path })
  }

  log('info', 'smoke.step.ok', {
    step,
    email,
    viaResend: Boolean(resendLink),
    viaAgentMail: Boolean(agentMailLink),
  })
  return { cookie: signedIn.cookie, newPassword }
}

async function stepCreateWorkspace(
  baseUrl: string,
  cookie: string,
): Promise<{ id: string; name: string }> {
  const step = 'workspace.create'
  const name = `Smoke Workspace ${Date.now()}`
  log('info', 'smoke.step.start', { step, name })

  const { status, json } = await requestJson(
    `${baseUrl}/api/v1/workspaces`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    },
    step,
  )

  if (status < 200 || status >= 300) {
    fail(step, `expected 2xx creating workspace, got ${status} (${JSON.stringify(json)})`)
  }

  const body = (json ?? {}) as {
    workspace?: { id?: string; name?: string }
  }
  const id = body.workspace?.id
  const responseName = body.workspace?.name
  if (!id) {
    fail(step, `workspace create response missing id: ${JSON.stringify(json)}`)
  }

  log('info', 'smoke.step.ok', { step, status, workspaceId: id })
  return { id, name: responseName ?? name }
}

async function stepAgentModels(
  baseUrl: string,
  cookie: string,
  requireConfiguredModel: boolean,
): Promise<void> {
  const step = 'agent.models'
  log('info', 'smoke.step.start', {
    step,
    modelProvider: AGENT_SMOKE_MODEL_PROVIDER,
    modelId: AGENT_SMOKE_MODEL_ID,
  })

  const { status, json } = await requestJson(
    `${baseUrl}/api/v1/agent/models`,
    { method: 'GET', headers: { cookie } },
    step,
  )

  if (status !== 200) {
    fail(step, `expected HTTP 200, got ${status} (${JSON.stringify(json)})`)
  }

  const body = (json ?? {}) as {
    models?: Array<{ provider?: string; id?: string }>
    defaultModel?: { provider?: string; id?: string }
  }
  const models = Array.isArray(body.models) ? body.models : []
  const found = models.some(
    (model) => model.provider === AGENT_SMOKE_MODEL_PROVIDER && model.id === AGENT_SMOKE_MODEL_ID,
  )
  if (requireConfiguredModel && !found) {
    fail(
      step,
      `expected ${AGENT_SMOKE_MODEL_PROVIDER}:${AGENT_SMOKE_MODEL_ID} in agent models, got ${JSON.stringify(json)}`,
    )
  }

  log('info', 'smoke.step.ok', {
    step,
    status,
    modelCount: models.length,
    defaultModel: body.defaultModel ?? null,
    configuredModelFound: found,
  })
}

async function stepAgentSessions(
  baseUrl: string,
  cookie: string,
  workspaceId: string,
): Promise<void> {
  const step = 'agent.sessions'
  log('info', 'smoke.step.start', { step, workspaceId })

  const { status, json } = await requestJson(
    `${baseUrl}/api/v1/agent/pi-chat/sessions`,
    { method: 'GET', headers: { cookie, 'x-boring-workspace-id': workspaceId } },
    step,
  )

  if (status !== 200) {
    fail(step, `expected HTTP 200, got ${status} (${JSON.stringify(json)})`)
  }

  log('info', 'smoke.step.ok', { step, status })
}

function extractSsePayloads(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
}

function collectAssistantTextFromPayload(value: unknown, acc: string[] = []): string[] {
  if (!value || typeof value !== 'object') return acc
  if (Array.isArray(value)) {
    for (const item of value) collectAssistantTextFromPayload(item, acc)
    return acc
  }

  const record = value as Record<string, unknown>
  for (const key of ['delta', 'text', 'textDelta', 'content']) {
    const candidate = record[key]
    if (typeof candidate === 'string') acc.push(candidate)
  }

  for (const key of ['parts', 'content', 'children']) {
    collectAssistantTextFromPayload(record[key], acc)
  }

  return acc
}

function extractPiChatText(snapshot: unknown): string {
  const chunks: string[] = []
  if (!snapshot || typeof snapshot !== 'object') return ''
  const messages = Array.isArray((snapshot as { messages?: unknown }).messages)
    ? (snapshot as { messages: unknown[] }).messages
    : []
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    if ((message as { role?: unknown }).role !== 'assistant') continue
    collectAssistantTextFromPayload((message as { parts?: unknown }).parts, chunks)
  }
  return chunks.join('')
}

function extractAssistantText(payloads: string[]): string {
  const chunks: string[] = []
  for (const payload of payloads) {
    if (payload === '[DONE]') continue
    try {
      collectAssistantTextFromPayload(JSON.parse(payload), chunks)
    } catch {
      // Some stream encodings may use raw text payloads. Accept only the exact
      // smoke target here so non-JSON error/metadata payloads cannot false-pass.
      if (payload.trim().toLowerCase() === 'ok') chunks.push(payload)
    }
  }
  return chunks.join('')
}

async function tryDeleteAgentSession(
  baseUrl: string,
  cookie: string,
  workspaceId: string,
  sessionId: string,
): Promise<{ status: number; detail: unknown }> {
  try {
    const response = await fetch(
      `${baseUrl}/api/v1/agent/pi-chat/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        headers: { cookie, 'x-boring-workspace-id': workspaceId },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    )
    const text = await response.text().catch((error) => String(error))
    let detail: unknown = text
    if (text) {
      try {
        detail = JSON.parse(text)
      } catch {
        // Keep original text for diagnostics.
      }
    }
    return { status: response.status, detail }
  } catch (error) {
    return { status: 0, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function stepAgentChat(
  baseUrl: string,
  cookie: string,
  workspaceId: string,
): Promise<void> {
  const step = 'agent.chat'
  const sessionId = `smoke-${Date.now()}`
  log('info', 'smoke.step.start', {
    step,
    workspaceId,
    sessionId,
    modelProvider: AGENT_SMOKE_MODEL_PROVIDER,
    modelId: AGENT_SMOKE_MODEL_ID,
  })

  try {
    const { status, text } = await requestText(
      `${baseUrl}/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/prompt`,
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
          'x-boring-workspace-id': workspaceId,
        },
        body: JSON.stringify({
          message: 'Reply with exactly: ok',
          clientNonce: `smoke-${sessionId}`,
          model: { provider: AGENT_SMOKE_MODEL_PROVIDER, id: AGENT_SMOKE_MODEL_ID },
        }),
      },
      step,
      AGENT_CHAT_TIMEOUT_MS,
    )

    if (status !== 200) {
      fail(step, `expected HTTP 200, got ${status} (${text.slice(0, 500)})`)
    }

    const state = await requestJson(
      `${baseUrl}/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/state`,
      { method: 'GET', headers: { cookie, 'x-boring-workspace-id': workspaceId } },
      step,
    )
    if (state.status !== 200) {
      fail(step, `expected state HTTP 200, got ${state.status}`)
    }
    const assistantText = extractPiChatText(state.json)
    if (!assistantText.toLowerCase().includes('ok')) {
      fail(step, `expected assistant text to contain ok, got ${JSON.stringify(assistantText)}`)
    }

    log('info', 'smoke.step.ok', {
      step,
      status,
      sessionId,
      assistantText,
    })
  } finally {
    const cleanup = await tryDeleteAgentSession(baseUrl, cookie, workspaceId, sessionId)
    if ((cleanup.status < 200 || cleanup.status >= 300) && cleanup.status !== 404) {
      log('warn', 'smoke.agent.chat.cleanup_failed', {
        step,
        sessionId,
        status: cleanup.status,
        detail: cleanup.detail,
      })
    }
  }
}

async function stepAgentSmoke(
  baseUrl: string,
  cookie: string,
  workspaceId: string,
): Promise<void> {
  const chatEnabled = process.env.SMOKE_AGENT_CHAT === '1'
  await stepAgentModels(baseUrl, cookie, chatEnabled)
  await stepAgentSessions(baseUrl, cookie, workspaceId)
  if (!chatEnabled) {
    log('warn', 'smoke.step.skipped', {
      step: 'agent.chat',
      detail: 'set SMOKE_AGENT_CHAT=1 to run paid OpenRouter/Qwen agent chat smoke',
    })
    return
  }
  await stepAgentChat(baseUrl, cookie, workspaceId)
}

async function stepListWorkspaces(
  baseUrl: string,
  cookie: string,
  expectedId: string,
): Promise<void> {
  const step = 'workspace.list'
  log('info', 'smoke.step.start', { step, expectedId })

  const { status, json } = await requestJson(
    `${baseUrl}/api/v1/workspaces`,
    { method: 'GET', headers: { cookie } },
    step,
  )

  if (status !== 200) {
    fail(step, `expected HTTP 200 listing workspaces, got ${status}`)
  }

  const body = (json ?? {}) as { workspaces?: Array<{ id: string }> }
  const list = Array.isArray(body.workspaces) ? body.workspaces : []
  const found = list.some((w) => w.id === expectedId)
  if (!found) {
    fail(
      step,
      `workspace ${expectedId} not present in list (got ${list.length} workspaces): ${JSON.stringify(list)}`,
    )
  }

  log('info', 'smoke.step.ok', { step, status, count: list.length })
}

async function stepSignout(baseUrl: string, cookie: string): Promise<void> {
  const step = 'signout'
  log('info', 'smoke.step.start', { step })

  const { status } = await requestJson(
    `${baseUrl}/auth/sign-out`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
      body: '{}',
    },
    step,
  )

  if (status < 200 || status >= 300) {
    fail(step, `expected 2xx on sign-out, got ${status}`)
  }

  log('info', 'smoke.step.ok', { step, status })
}

async function main(): Promise<void> {
  const baseUrl = normalizeBaseUrl(process.env.DEPLOY_URL ?? '')

  log('info', 'smoke.start', {
    deployUrl: baseUrl,
    timeoutMs: REQUEST_TIMEOUT_MS,
  })

  await stepHealth(baseUrl)
  const signup = await stepSignup(baseUrl)
  await stepVerifyEmail(signup.verifyLink)
  await stepCapabilities(baseUrl, signup.cookie)

  // Auth flow continuation: signup already authenticates the user (signup
  // returns a session cookie when email-verification is not strict). When the
  // signup cookie is present we exercise the workspace surface end-to-end with
  // it, then explicitly re-authenticate via /auth/sign-in/email to validate
  // the second auth path. SMOKE_PASSWORD is shared with the signup step so
  // the passwords stay in sync (default value mirrors the signup default).
  const password = process.env.SMOKE_PASSWORD ?? 'Zk8$mN!qR2xFgWpJ'

  let workspaceCookie = signup.cookie
  if (!workspaceCookie) {
    log('info', 'smoke.signin.required', { reason: 'signup returned no session cookie' })
    const signedIn = await stepSignin(baseUrl, signup.email, password)
    workspaceCookie = signedIn.cookie
  }

  const workspace = await stepCreateWorkspace(baseUrl, workspaceCookie)
  await stepListWorkspaces(baseUrl, workspaceCookie, workspace.id)
  await stepAgentSmoke(baseUrl, workspaceCookie, workspace.id)

  // Exercise the full forgot/reset-password email loop with the same real
  // mailbox used for signup. When RESEND_API_KEY and AGENTMAIL_API_KEY are
  // both present this proves both provider-side send and mailbox delivery.
  const reset = await stepPasswordReset(baseUrl, signup.email, password, signup.agentMail)
  await stepListWorkspaces(baseUrl, reset.cookie, workspace.id)
  await stepSignout(baseUrl, reset.cookie)
  if (reset.cookie !== workspaceCookie) {
    await stepSignout(baseUrl, workspaceCookie)
  }

  log('info', 'smoke.complete', {
    deployUrl: baseUrl,
    signupEmail: signup.email,
    workspaceId: workspace.id,
  })
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error)
  log('error', 'smoke.failed', { detail })
  process.exit(1)
})
