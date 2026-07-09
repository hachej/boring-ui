#!/usr/bin/env node

import { randomUUID } from 'node:crypto'

export {}

type UserKey = 'adam' | 'readonly'
type Operation = 'read' | 'write'
type Filesystem = 'company_context' | 'user'

interface MatrixUser {
  key: UserKey
  label: string
  email: string
  password: string
  workspaceId: string
}

interface MatrixCase {
  id: string
  user: UserKey
  operation: Operation
  filesystem: Filesystem
  location: string
  workspace: 'own' | 'adam' | 'readonly'
  path: string
  content?: string
  expected: number
  note: string
}

interface MatrixResult extends MatrixCase {
  actual: number
  ok: boolean
  body: string
}

interface CleanupTarget {
  testCase: MatrixCase
  cookie: string
}

type CookieJar = Record<UserKey, string>

const baseUrl = normalizeBaseUrl(readRequiredEnv('MATRIX_BASE_URL', process.env.MATRIX_BASE_URL ?? process.env.DEPLOY_URL))
const requestTimeoutMs = readPositiveIntEnv('MATRIX_REQUEST_TIMEOUT_MS', 10_000)
const publicReadPath = readRequiredEnv('MATRIX_COMPANY_PUBLIC_READ_PATH')
const privateReadPath = readRequiredEnv('MATRIX_COMPANY_PRIVATE_READ_PATH')
const publicWriteDir = normalizeCompanyDir(readRequiredEnv('MATRIX_COMPANY_PUBLIC_WRITE_DIR'))
const privateWriteDir = normalizeCompanyDir(readRequiredEnv('MATRIX_COMPANY_PRIVATE_WRITE_DIR'))
const adminCompanyWriteExpected = readStatusEnv('MATRIX_ADMIN_COMPANY_WRITE_EXPECTED', 403)
const readonlyCompanyWriteExpected = readStatusEnv('MATRIX_READONLY_COMPANY_WRITE_EXPECTED', 403)
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`

const users: Record<UserKey, MatrixUser> = {
  adam: {
    key: 'adam',
    label: 'Adam/admin',
    email: readRequiredEnv('MATRIX_ADAM_EMAIL'),
    password: readRequiredSecretEnv('MATRIX_ADAM_PASSWORD'),
    workspaceId: readRequiredEnv('MATRIX_ADAM_WORKSPACE_ID'),
  },
  readonly: {
    key: 'readonly',
    label: 'Readonly',
    email: readRequiredEnv('MATRIX_READONLY_EMAIL'),
    password: readRequiredSecretEnv('MATRIX_READONLY_PASSWORD'),
    workspaceId: readRequiredEnv('MATRIX_READONLY_WORKSPACE_ID'),
  },
}

function readRequiredEnv(name: string, value = process.env[name]): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${name} is required`)
  return trimmed
}

function readRequiredSecretEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function readStatusEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 599) throw new Error(`${name} must be an HTTP status code`)
  return parsed
}

function normalizeCompanyDir(value: string): string {
  const raw = value.trim()
  if (raw === '/') return '/'
  const trimmed = raw.replace(/\/+$/, '')
  if (!trimmed.startsWith('/')) throw new Error('company-context fixture directories must be absolute policy paths')
  return trimmed
}

function joinCompanyPath(dir: string, basename: string): string {
  return dir === '/' ? `/${basename}` : `${dir}/${basename}`
}

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) })
}

function normalizeBaseUrl(raw: string): string {
  const parsed = new URL(raw)
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && (loopback || process.env.MATRIX_ALLOW_INSECURE_HTTP === '1'))) {
    throw new Error('MATRIX_BASE_URL/DEPLOY_URL must be HTTPS unless targeting loopback or MATRIX_ALLOW_INSECURE_HTTP=1 is set')
  }
  return parsed.toString().replace(/\/$/, '')
}

function workspaceFor(testUser: MatrixUser, scope: MatrixCase['workspace']): string {
  if (scope === 'own') return testUser.workspaceId
  return users[scope].workspaceId
}

function cookieFrom(headers: Headers): string {
  const setCookie = headers.get('set-cookie')
  if (!setCookie) throw new Error('sign-in response did not set a cookie')
  return setCookie
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((part) => part.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

async function signIn(user: MatrixUser): Promise<string> {
  const response = await fetchWithTimeout(`${baseUrl}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email: user.email, password: user.password }),
  })
  if (!response.ok) throw new Error(`${user.label} sign-in failed: HTTP ${response.status} ${await response.text()}`)
  return cookieFrom(response.headers)
}

async function requestCase(testCase: MatrixCase, cookies: CookieJar, cleanupTargets: CleanupTarget[]): Promise<MatrixResult> {
  const cookie = cookies[testCase.user]
  const user = users[testCase.user]
  const workspaceId = workspaceFor(user, testCase.workspace)
  let response: Response
  if (testCase.operation === 'read') {
    const url = new URL(`${baseUrl}/api/v1/files`)
    url.searchParams.set('workspaceId', workspaceId)
    url.searchParams.set('filesystem', testCase.filesystem)
    url.searchParams.set('path', testCase.path)
    response = await fetchWithTimeout(url, { headers: { cookie } })
  } else {
    const content = testCase.content ?? `${testCase.id} ${runId}`
    cleanupTargets.push({ testCase, cookie: cleanupCookieFor(testCase, cookies) })
    const url = new URL(`${baseUrl}/api/v1/files`)
    url.searchParams.set('workspaceId', workspaceId)
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        filesystem: testCase.filesystem,
        path: testCase.path,
        content,
      }),
    })
    const body = await response.text()
    if (response.ok && !(testCase.expected >= 200 && testCase.expected < 300)) {
      cleanupTargets.push({ testCase, cookie: cleanupCookieFor(testCase, cookies) })
    }
    const statusMatches = response.status === testCase.expected
    if (statusMatches && response.ok && testCase.expected >= 200 && testCase.expected < 300) {
      const verified = await verifyWrite(testCase, cookie, workspaceId, content)
      return { ...testCase, actual: response.status, ok: verified, body: verified ? body : 'write verification failed' }
    }
    if (statusMatches && testCase.expected >= 400) {
      const noSideEffect = await verifyDeniedWriteNoSideEffect(testCase, cleanupCookieFor(testCase, cookies))
      if (!noSideEffect) cleanupTargets.push({ testCase, cookie: cleanupCookieFor(testCase, cookies) })
      return { ...testCase, actual: response.status, ok: noSideEffect, body: noSideEffect ? body : 'denied write had side effects' }
    }
    return { ...testCase, actual: response.status, ok: statusMatches, body }
  }

  const body = await response.text()
  return { ...testCase, actual: response.status, ok: response.status === testCase.expected, body }
}

function cleanupWorkspaceId(testCase: MatrixCase): string {
  return testCase.filesystem === 'company_context' ? users.adam.workspaceId : workspaceFor(users[testCase.user], testCase.workspace)
}

async function verifyWrite(testCase: MatrixCase, cookie: string, workspaceId: string, content: string): Promise<boolean> {
  const url = new URL(`${baseUrl}/api/v1/files`)
  url.searchParams.set('workspaceId', workspaceId)
  url.searchParams.set('filesystem', testCase.filesystem)
  url.searchParams.set('path', testCase.path)
  const response = await fetchWithTimeout(url, { headers: { cookie } })
  if (!response.ok) return false
  try {
    const parsed = await response.json() as { content?: unknown }
    return parsed.content === content
  } catch {
    return false
  }
}

async function verifyDeniedWriteNoSideEffect(testCase: MatrixCase, cookie: string): Promise<boolean> {
  const url = new URL(`${baseUrl}/api/v1/files`)
  url.searchParams.set('workspaceId', cleanupWorkspaceId(testCase))
  url.searchParams.set('filesystem', testCase.filesystem)
  url.searchParams.set('path', testCase.path)
  const response = await fetchWithTimeout(url, { headers: { cookie } })
  return response.status === 404
}

function cleanupCookieFor(testCase: MatrixCase, cookies: CookieJar): string {
  if (testCase.filesystem !== 'user') return cookies.adam
  if (testCase.workspace === 'adam') return cookies.adam
  if (testCase.workspace === 'readonly') return cookies.readonly
  return cookies[testCase.user]
}

async function signOut(cookie: string): Promise<void> {
  const response = await fetchWithTimeout(`${baseUrl}/auth/sign-out`, {
    method: 'POST',
    headers: { cookie, origin: baseUrl, 'content-type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw new Error(`sign-out failed: HTTP ${response.status}`)
}

async function cleanupWrite(target: CleanupTarget): Promise<void> {
  const workspaceId = cleanupWorkspaceId(target.testCase)
  const url = new URL(`${baseUrl}/api/v1/files`)
  url.searchParams.set('workspaceId', workspaceId)
  url.searchParams.set('filesystem', target.testCase.filesystem)
  url.searchParams.set('path', target.testCase.path)
  const response = await fetchWithTimeout(url, { method: 'DELETE', headers: { cookie: target.cookie } })
  if (!response.ok && response.status !== 404) {
    if (response.status === 403 && await verifyDeniedWriteNoSideEffect(target.testCase, target.cookie)) return
    throw new Error(`${target.testCase.id} cleanup failed: HTTP ${response.status}`)
  }
}

function buildCases(): MatrixCase[] {
  const adamUserPath = `adam-user-matrix-${runId}.txt`
  const readonlyUserPath = `readonly-user-matrix-${runId}.txt`
  const cases: MatrixCase[] = []

  for (const user of ['adam', 'readonly'] as const) {
    const isAdmin = user === 'adam'
    cases.push(
      {
        id: `${user}-read-company-public`,
        user,
        operation: 'read',
        filesystem: 'company_context',
        location: 'company public',
        workspace: 'own',
        path: publicReadPath,
        expected: 200,
        note: 'public company context is readable by both policy users',
      },
      {
        id: `${user}-read-company-adam-private`,
        user,
        operation: 'read',
        filesystem: 'company_context',
        location: 'company adam-private',
        workspace: 'own',
        path: privateReadPath,
        expected: isAdmin ? 200 : 404,
        note: 'adam-private company context is restricted to Adam/admin',
      },
      {
        id: `${user}-write-company-public`,
        user,
        operation: 'write',
        filesystem: 'company_context',
        location: 'company public',
        workspace: 'own',
        path: joinCompanyPath(publicWriteDir, `${user}-company-public-write-${runId}.txt`),
        expected: isAdmin ? adminCompanyWriteExpected : readonlyCompanyWriteExpected,
        note: 'company context writes require admin',
      },
      {
        id: `${user}-write-company-adam-private`,
        user,
        operation: 'write',
        filesystem: 'company_context',
        location: 'company adam-private',
        workspace: 'own',
        path: joinCompanyPath(privateWriteDir, `${user}-company-private-write-${runId}.txt`),
        expected: isAdmin ? adminCompanyWriteExpected : readonlyCompanyWriteExpected,
        note: 'company context writes require admin, including private area',
      },
      {
        id: `${user}-write-own-user-workspace`,
        user,
        operation: 'write',
        filesystem: 'user',
        location: 'own user workspace',
        workspace: 'own',
        path: user === 'adam' ? adamUserPath : readonlyUserPath,
        expected: 200,
        note: 'each user can write their own workspace',
      },
      {
        id: `${user}-read-own-user-workspace`,
        user,
        operation: 'read',
        filesystem: 'user',
        location: 'own user workspace',
        workspace: 'own',
        path: user === 'adam' ? adamUserPath : readonlyUserPath,
        expected: 200,
        note: 'each user can read their own workspace',
      },
      {
        id: `${user}-write-other-user-workspace`,
        user,
        operation: 'write',
        filesystem: 'user',
        location: 'other user workspace',
        workspace: user === 'adam' ? 'readonly' : 'adam',
        path: `${user}-cross-workspace-write-${runId}.txt`,
        expected: 403,
        note: 'workspace membership blocks writes to the other user workspace',
      },
      {
        id: `${user}-read-other-user-workspace`,
        user,
        operation: 'read',
        filesystem: 'user',
        location: 'other user workspace',
        workspace: user === 'adam' ? 'readonly' : 'adam',
        path: user === 'adam' ? readonlyUserPath : adamUserPath,
        expected: 403,
        note: 'workspace membership blocks reads from the other user workspace',
      },
    )
  }

  return cases
}

function compactBody(body: string, actual: number): string {
  if (body === 'write verification failed' || body === 'denied write had side effects') return body
  if (actual >= 200 && actual < 300) return '[success body redacted]'
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown }
    const code = typeof parsed.error?.code === 'string' ? parsed.error.code : typeof parsed.code === 'string' ? parsed.code : 'error'
    const message = typeof parsed.error?.message === 'string' ? parsed.error.message : typeof parsed.message === 'string' ? parsed.message : ''
    return [code, message].filter(Boolean).join(': ').slice(0, 100)
  } catch {
    return '[error body redacted]'
  }
}

function printMarkdown(results: MatrixResult[]): void {
  console.log(`\nGovernance access matrix (${baseUrl})\n`)
  console.log('| User | Operation | Filesystem | Location | Workspace | Path | Expected | Actual | Result |')
  console.log('|---|---:|---|---|---|---|---:|---:|---|')
  for (const result of results) {
    console.log(`| ${users[result.user].label} | ${result.operation} | \`${result.filesystem}\` | ${result.location} | ${result.workspace} | \`${result.path}\` | ${result.expected} | ${result.actual} | ${result.ok ? '✅' : `❌ ${compactBody(result.body, result.actual)}`} |`)
  }
}

async function main() {
  const cookies: Partial<CookieJar> = {}
  const cleanupTargets: CleanupTarget[] = []
  const results: MatrixResult[] = []
  const cleanupFailures: string[] = []
  let primaryError: unknown = null
  try {
    cookies.adam = await signIn(users.adam)
    cookies.readonly = await signIn(users.readonly)
    const completeCookies = cookies as CookieJar
    for (const testCase of buildCases()) {
      results.push(await requestCase(testCase, completeCookies, cleanupTargets))
    }
  } catch (error) {
    primaryError = error
  } finally {
    for (const target of cleanupTargets.reverse()) {
      await cleanupWrite(target).catch((error) => {
        cleanupFailures.push(error instanceof Error ? error.message : String(error))
      })
    }
    await Promise.all(Object.values(cookies).filter((cookie): cookie is string => Boolean(cookie)).map((cookie) => signOut(cookie).catch((error) => {
      cleanupFailures.push(error instanceof Error ? error.message : String(error))
    })))
  }

  printMarkdown(results)

  const failures = results.filter((result) => !result.ok)
  if (primaryError || failures.length > 0 || cleanupFailures.length > 0) {
    if (primaryError) console.error(primaryError instanceof Error ? primaryError.stack ?? primaryError.message : String(primaryError))
    for (const failure of cleanupFailures) console.error(`cleanup failed: ${failure}`)

    if (failures.length > 0) console.error(`\n${failures.length} governance access matrix case(s) failed.`)
    if (cleanupFailures.length > 0) console.error(`${cleanupFailures.length} cleanup operation(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll governance access matrix cases passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
