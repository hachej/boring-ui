import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, test, vi } from 'vitest'
import { createSandboxRuntimeModeAdapter, type RuntimeBundle } from '@hachej/boring-agent/server'

import { withoutRuntimeCredentials } from '../appLifecycle'
import { createAppRegistry, type AppRegistry, type OneChatAppProcess } from '../appRegistry'
import { agreeIntent, openIntent } from '../memoryFiles'

const templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../template-app')
const active: Array<{ registry: AppRegistry; adapter: ReturnType<typeof createSandboxRuntimeModeAdapter> }> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.allSettled(active.splice(0).map(async ({ registry, adapter }) => {
    await registry.close()
    await adapter.dispose?.()
  }))
})

function pendingUntilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

function output(result: Awaited<ReturnType<RuntimeBundle['sandbox']['exec']>>): string {
  return new TextDecoder().decode(result.stdout).trim()
}

async function fixture(options: { failAcceptedHealth?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-lifecycle-'))
  const adapter = createSandboxRuntimeModeAdapter('direct')
  let failAcceptedHealth = options.failAcceptedHealth === true
  const runs: Array<{ app: OneChatAppProcess; signal: AbortSignal }> = []
  const registry = createAppRegistry({
    appsRoot: path.join(root, 'apps'),
    templateRoot,
    publicHost: '127.0.0.1',
    runtimeModeAdapter: adapter,
    portStart: 5446,
    portEnd: 5447,
    isPortAvailable: async () => true,
    runApp: async (_runtime, app, signal) => {
      runs.push({ app, signal })
      await pendingUntilAbort(signal)
    },
    healthCheck: async (_runtime, port) => {
      if (port === 5446 && failAcceptedHealth) {
        failAcceptedHealth = false
        throw new Error('deliberate accepted health failure')
      }
    },
    logger: { info: () => {}, error: () => {} },
  })
  active.push({ registry, adapter })
  await registry.init()
  const app = await registry.create('Members')
  const accepted = await adapter.create({
    workspaceRoot: registry.rootFor(app.slug),
    workspaceId: 'test-accepted',
    sessionId: 'test-accepted',
  })
  await openIntent(accepted.workspace, 'phone-numbers', 'Add phone numbers.', undefined, 'phone numbers')
  await agreeIntent(accepted.workspace, 'phone-numbers', 'Members shall have an optional phone number.')
  return {
    root,
    registry,
    app,
    accepted,
    runs,
    lifecycle: registry.lifecycleFor(app.slug),
  }
}

async function preparePhoneCandidate(value: Awaited<ReturnType<typeof fixture>>) {
  await value.lifecycle.prepareCandidate({
    intentSlug: 'phone-numbers',
    intentTitle: 'Phone numbers',
    sessionId: 'session-1',
    model: 'openai-codex/gpt-5.5',
  })
  const candidate = await createSandboxRuntimeModeAdapter('direct').create({
    workspaceRoot: path.join(value.registry.rootFor(value.app.slug), 'candidate'),
    workspaceId: 'test-candidate',
    sessionId: 'test-candidate',
  })
  const schema = await candidate.workspace.readFile('src/db/schema.ts')
  await candidate.workspace.writeFile(
    'src/db/schema.ts',
    schema.replace('note: text("note"),', 'note: text("note"),\n  phone: text("phone"),'),
  )
  return candidate
}

describe('hidden app revision lifecycle', () => {
  test('candidate commands receive only allowlisted non-credential environment values', async () => {
    let received: Record<string, string> | undefined
    const runtime = {
      workspace: { root: '/workspace' },
      sandbox: {
        async exec(_command: string, options?: { env?: Record<string, string> }) {
          received = options?.env
          return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
        },
      },
    } as unknown as RuntimeBundle

    await withoutRuntimeCredentials(runtime).sandbox.exec('true', {
      env: {
        DATABASE_URL: './data/app.sqlite',
        VERIFY_PORT: '5442',
        OPENAI_API_KEY: 'must-not-leak',
        AWS_ACCESS_KEY_ID: 'must-not-leak-either',
      },
    })

    expect(received).toMatchObject({
      DATABASE_URL: './data/app.sqlite',
      VERIFY_PORT: '5442',
      HOME: '/workspace/.one-chat/home',
      NPM_CONFIG_USERCONFIG: '/dev/null',
    })
    expect(received).not.toHaveProperty('OPENAI_API_KEY')
    expect(received).not.toHaveProperty('AWS_ACCESS_KEY_ID')
  })

  test('candidate commands inherit only non-credential process environment', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'do-not-copy')
    vi.stubEnv('DATABASE_URL', 'postgres://secret')
    let captured: Record<string, string> | undefined
    const runtime = {
      workspace: { root: '/candidate' },
      sandbox: {
        exec: async (_command: string, options?: { env?: Record<string, string> }) => {
          captured = options?.env
          return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
        },
      },
    } as unknown as RuntimeBundle

    await withoutRuntimeCredentials(runtime).sandbox.exec('true', { env: { PORT: '5442' } })

    expect(captured?.PATH).toBe(process.env.PATH)
    expect(captured?.PORT).toBe('5442')
    expect(captured).not.toHaveProperty('OPENAI_API_KEY')
    expect(captured).not.toHaveProperty('DATABASE_URL')
  })

  test('a failing post-Keep health check restores last-good source and data', async () => {
    const value = await fixture({ failAcceptedHealth: true })
    const oldHead = output(await value.accepted.sandbox.exec('git rev-parse HEAD', { cwd: value.accepted.workspace.root }))
    const candidate = await preparePhoneCandidate(value)

    await value.lifecycle.verifyCandidate('phone-numbers')
    const acceptedRun = value.runs.find((run) => run.app.port === value.app.acceptedPort)
    expect(acceptedRun?.signal.aborted).toBe(false)

    const result = await value.lifecycle.keepChange('phone-numbers')
    expect(result).toMatchObject({ ok: false })
    expect(output(await value.accepted.sandbox.exec('git rev-parse HEAD', { cwd: value.accepted.workspace.root }))).toBe(oldHead)
    expect(await value.accepted.workspace.readFile('src/db/schema.ts')).not.toContain('phone: text("phone")')
    const columns = output(await value.accepted.sandbox.exec(
      `node --input-type=module -e "import Database from 'better-sqlite3';console.log(JSON.stringify(new Database('data/app.sqlite').prepare('pragma table_info(items)').all().map(x=>x.name)))"`,
      { cwd: value.accepted.workspace.root },
    ))
    expect(JSON.parse(columns)).not.toContain('phone')
    const acceptedRuns = value.runs.filter((run) => run.app.port === value.app.acceptedPort)
    expect(acceptedRuns.length).toBeGreaterThanOrEqual(2)
    expect(acceptedRuns.at(-1)?.signal.aborted).toBe(false)

    expect(await value.lifecycle.keepChange('phone-numbers')).toMatchObject({ ok: true })
    const promotedCommits = output(await value.accepted.sandbox.exec(
      `git rev-list --count ${oldHead}..main`,
      { cwd: value.accepted.workspace.root },
    ))
    expect(promotedCommits).toBe('1')
    expect(await value.accepted.workspace.readFile('src/db/schema.ts')).toContain('phone: text("phone")')
    await candidate.disposeRuntime?.()
  }, 180_000)

  test('a code-only Keep can be undone and its kept version can be shown read-only', async () => {
    const value = await fixture()
    await value.lifecycle.prepareCandidate({
      intentSlug: 'phone-numbers',
      intentTitle: 'Phone numbers',
      sessionId: 'session-1',
      model: 'openai-codex/gpt-5.5',
    })
    const candidate = await createSandboxRuntimeModeAdapter('direct').create({
      workspaceRoot: path.join(value.registry.rootFor(value.app.slug), 'candidate'),
      workspaceId: 'test-code-candidate',
      sessionId: 'test-code-candidate',
    })
    const route = await candidate.workspace.readFile('src/routes/index.tsx')
    await candidate.workspace.writeFile('src/routes/index.tsx', `${route}\n// one-chat code-only marker\n`)

    await value.lifecycle.verifyCandidate('phone-numbers')
    expect(await value.lifecycle.keepChange('phone-numbers')).toMatchObject({ ok: true })
    const keptHead = output(await value.accepted.sandbox.exec('git rev-parse HEAD', { cwd: value.accepted.workspace.root }))
    expect(await value.accepted.workspace.readFile('src/routes/index.tsx')).toContain('one-chat code-only marker')

    const undone = await value.lifecycle.undoChange({ sessionId: 'session-2', model: 'openai-codex/gpt-5.5' })
    expect(undone).toMatchObject({ ok: true, intentSlug: 'phone-numbers' })
    expect(await value.accepted.workspace.readFile('src/routes/index.tsx')).not.toContain('one-chat code-only marker')
    const undoLog = output(await value.accepted.sandbox.exec('git log -1 --format=%B', { cwd: value.accepted.workspace.root }))
    expect(undoLog).toContain(`One-Chat-Undo: ${keptHead}`)
    expect(undoLog).toContain('One-Chat-Session: session-2')

    const shown = await value.lifecycle.showVersion({ commit: keptHead })
    expect(shown.url).toBe(value.registry.candidateUrlFor(value.app))
    expect(shown.label).toContain('phone-numbers')
    const versionRun = value.runs.filter((run) => run.app.port === value.app.candidatePort).at(-1)
    expect(versionRun?.signal.aborted).toBe(false)
    await value.lifecycle.backToApp()
    expect(versionRun?.signal.aborted).toBe(true)
    await candidate.disposeRuntime?.()
  }, 240_000)

  test('Keep writes one trailer-bearing commit and Undo refuses schema loss without touching data', async () => {
    const value = await fixture()
    const candidate = await preparePhoneCandidate(value)
    await value.lifecycle.verifyCandidate('phone-numbers')
    expect(value.runs.find((run) => run.app.port === value.app.acceptedPort)?.signal.aborted).toBe(false)

    const kept = await value.lifecycle.keepChange('phone-numbers')
    expect(kept).toMatchObject({ ok: true })
    const keptHead = output(await value.accepted.sandbox.exec('git rev-parse HEAD', { cwd: value.accepted.workspace.root }))
    const log = output(await value.accepted.sandbox.exec('git log -1 --format=%B', { cwd: value.accepted.workspace.root }))
    expect(log).toContain('One-Chat-Intent: phone-numbers')
    expect(log).toContain('One-Chat-Session: session-1')
    expect(log).toContain('One-Chat-Model: openai-codex/gpt-5.5')
    const changes = await readFile(path.join(value.registry.rootFor(value.app.slug), 'docs', 'CHANGES.md'), 'utf8')
    expect(changes.match(/· phone-numbers ·/g)).toHaveLength(1)

    const beforeDb = output(await value.accepted.sandbox.exec(
      `node --input-type=module -e "import Database from 'better-sqlite3';const d=new Database('data/app.sqlite');d.prepare('insert into items(title,note,phone) values(?,?,?)').run('A','B','123');console.log(d.prepare('select phone from items where title=?').get('A').phone)"`,
      { cwd: value.accepted.workspace.root },
    ))
    expect(beforeDb).toBe('123')

    const undone = await value.lifecycle.undoChange({ sessionId: 'session-2', model: 'openai-codex/gpt-5.5' })
    expect(undone.ok).toBe(false)
    expect(undone.message).toBe("I can't take that back without losing the phone numbers you saved; want me to hide the field instead?")
    expect(output(await value.accepted.sandbox.exec('git rev-parse HEAD', { cwd: value.accepted.workspace.root }))).toBe(keptHead)
    const phone = output(await value.accepted.sandbox.exec(
      `node --input-type=module -e "import Database from 'better-sqlite3';console.log(new Database('data/app.sqlite').prepare('select phone from items where title=?').get('A').phone)"`,
      { cwd: value.accepted.workspace.root },
    ))
    expect(phone).toBe('123')
    await candidate.disposeRuntime?.()
  }, 180_000)
})
