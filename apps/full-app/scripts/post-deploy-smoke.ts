const BEAD_ID = 'boring-ui-v2-6u3z'
const REQUEST_TIMEOUT_MS = readPositiveIntEnv('SMOKE_REQUEST_TIMEOUT_MS', 10_000)
const RESEND_POLL_TIMEOUT_MS = 60_000
const RESEND_POLL_INTERVAL_MS = 5_000
const AGENT_CHAT_TIMEOUT_MS = readPositiveIntEnv('SMOKE_AGENT_CHAT_TIMEOUT_MS', 120_000)
const AGENT_SMOKE_MODEL_PROVIDER = process.env.SMOKE_AGENT_MODEL_PROVIDER ?? 'openrouter'
const AGENT_SMOKE_MODEL_ID = process.env.SMOKE_AGENT_MODEL_ID ?? 'qwen/qwen3.6-plus'

const VERIFY_LINK_PATTERN = /https?:\/\/[^\s"'<>]+\/auth\/verify-email\?[^\s"'<>]+/i

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

  // The API returns either `{ id, name, … }` (legacy shape) or
  // `{ workspace: { id, name, … }, role }` (current shape) — normalize.
  const body = (json ?? {}) as {
    id?: string
    name?: string
    workspace?: { id?: string; name?: string }
  }
  const id = body.id ?? body.workspace?.id
  const responseName = body.name ?? body.workspace?.name
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
    `${baseUrl}/api/v1/agent/sessions`,
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

function extractAssistantText(payloads: string[]): string {
  const chunks: string[] = []
  for (const payload of payloads) {
    if (payload === '[DONE]') continue
    try {
      collectAssistantTextFromPayload(JSON.parse(payload), chunks)
    } catch {
      // Some stream encodings use raw text-ish payloads. Treat only those raw
      // payloads as assistant text; metadata stays ignored by the JSON path.
      chunks.push(payload)
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
      `${baseUrl}/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
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
    const { status, text, headers } = await requestText(
      `${baseUrl}/api/v1/agent/chat`,
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
          'x-boring-workspace-id': workspaceId,
        },
        body: JSON.stringify({
          sessionId,
          message: 'Reply with exactly: ok',
          model: { provider: AGENT_SMOKE_MODEL_PROVIDER, id: AGENT_SMOKE_MODEL_ID },
        }),
      },
      step,
      AGENT_CHAT_TIMEOUT_MS,
    )

    if (status !== 200) {
      fail(step, `expected HTTP 200, got ${status} (${text.slice(0, 500)})`)
    }

    const contentType = headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      fail(step, `expected text/event-stream, got ${contentType}`)
    }

    const payloads = extractSsePayloads(text)
    if (!payloads.includes('[DONE]')) {
      fail(step, `expected [DONE] SSE marker, got ${text.slice(0, 1_000)}`)
    }

    const assistantText = extractAssistantText(payloads)
    if (!assistantText.toLowerCase().includes('ok')) {
      fail(step, `expected assistant text to contain ok, got ${JSON.stringify(assistantText)}`)
    }

    log('info', 'smoke.step.ok', {
      step,
      status,
      sessionId,
      eventCount: payloads.length,
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
    bead: BEAD_ID,
    timeoutMs: REQUEST_TIMEOUT_MS,
  })

  await stepHealth(baseUrl)
  const signup = await stepSignup(baseUrl)
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

  if (signup.cookie) {
    // We had an authenticated session from signup — double-check the
    // /auth/sign-in/email path also works, since deployments often disable
    // signup-auto-login but keep signin enabled.
    const signedIn = await stepSignin(baseUrl, signup.email, password)
    await stepListWorkspaces(baseUrl, signedIn.cookie, workspace.id)
    await stepSignout(baseUrl, signedIn.cookie)
    if (signedIn.cookie !== workspaceCookie) {
      await stepSignout(baseUrl, workspaceCookie)
    }
  } else {
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
