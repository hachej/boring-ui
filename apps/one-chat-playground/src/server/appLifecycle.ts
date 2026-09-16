import path from 'node:path'

import type { RuntimeBundle, RuntimeModeAdapter } from '@hachej/boring-agent/server'
import type { ExecOptions, ExecResult, Sandbox } from '@hachej/boring-agent/shared'

import { readIntent, recordIntentEvent, setIntentStatus } from './memoryFiles.js'
import { inspectSafeAdditiveSql, planSafeAdditiveMigration, type SqliteSchemaSnapshot } from './safeAdditiveSql.js'

export interface LifecycleApp {
  readonly slug: string
  readonly title: string
  readonly acceptedPort: number
  readonly candidatePort: number
}

export interface CandidateMetadata {
  readonly intentSlug: string
  readonly intentTitle: string
  readonly sessionId: string
  readonly model: string
}

export interface VerifiedCandidate {
  readonly intentSlug: string
  readonly previewUrl: string
  readonly approvedSql: readonly string[]
}

export interface LifecycleResult {
  readonly ok: boolean
  readonly message: string
  readonly intentSlug?: string
}

export interface VersionPreview {
  readonly url: string
  readonly label: string
}

export interface AppServiceStatus {
  readonly up: boolean
  readonly address: string
}

export interface AppLifecycleHost {
  readonly app: LifecycleApp
  readonly appRoot: string
  readonly acceptedUrl: string
  readonly candidateUrl: string
  readonly runtimeModeAdapter: RuntimeModeAdapter
  acquireAcceptedRuntime(): Promise<RuntimeBundle>
  stopAccepted(): Promise<void>
  startAccepted(): void
  startPreview(runtime: RuntimeBundle, port: number, signal: AbortSignal): Promise<void>
  health(runtime: RuntimeBundle, port: number, signal?: AbortSignal): Promise<void>
  log(message: string): void
}

interface CandidateState extends CandidateMetadata {
  readonly workspaceRoot: string
  runtime: RuntimeBundle
  approvedSql: readonly string[] | undefined
  verified: boolean
}

interface PreviewRun {
  readonly kind: 'candidate' | 'version'
  readonly controller: AbortController
  readonly done: Promise<void>
  readonly runtime: RuntimeBundle
  readonly worktreePath?: string
}

const CREDENTIALLESS_PROCESS_ENV_ALLOWLIST = /^(?:PATH|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|TZ|CI|NO_COLOR|FORCE_COLOR|TERM|COLORTERM)$/
const CREDENTIALLESS_EXPLICIT_ENV_ALLOWLIST = /^(?:PATH|COREPACK_HOME|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|TZ|CI|NO_COLOR|FORCE_COLOR|TERM|COLORTERM|PORT|SAMPLE_APP_PORT|VERIFY_PORT|BASE_URL|DATABASE_URL|ONE_CHAT_(?:DB|SOURCE|DESTINATION|SQL_BASE64|APPROVED_SQL|SKIP_DB_PUSH|HEALTH|HOST_PID))$/

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function allowlistedEnv(env: NodeJS.ProcessEnv, allowlist: RegExp): Record<string, string> {
  return Object.fromEntries(Object.entries(env).flatMap(([key, value]) => (
    value !== undefined && allowlist.test(key) ? [[key, value] as const] : []
  )))
}

function credentiallessProcessEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return allowlistedEnv(env, CREDENTIALLESS_PROCESS_ENV_ALLOWLIST)
}

/** Candidate/version processes get an empty credential surface and an isolated HOME. */
export function withoutRuntimeCredentials(runtime: RuntimeBundle): RuntimeBundle {
  const sandbox: Sandbox = {
    ...runtime.sandbox,
    exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
      const root = runtime.workspace.root
      return runtime.sandbox.exec(command, {
        ...options,
        env: {
          ...credentiallessProcessEnv(),
          HOME: path.posix.join(root, '.one-chat', 'home'),
          XDG_CONFIG_HOME: path.posix.join(root, '.one-chat', 'home', '.config'),
          NPM_CONFIG_USERCONFIG: '/dev/null',
          npm_config_minimum_release_age: '0',
          npm_config_dangerously_allow_all_builds: 'true',
          GIT_CONFIG_NOSYSTEM: '1',
          ...allowlistedEnv(options.env ?? {}, CREDENTIALLESS_EXPLICIT_ENV_ALLOWLIST),
        },
      })
    },
  }
  return { ...runtime, sandbox }
}

async function exec(
  runtime: RuntimeBundle,
  command: string,
  options: ExecOptions = {},
  errorPrefix = 'command failed',
): Promise<string> {
  const result = await runtime.sandbox.exec(command, {
    cwd: runtime.workspace.root,
    maxOutputBytes: 10 * 1024 * 1024,
    ...options,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
      ...options.env,
    },
  })
  if (result.exitCode !== 0) {
    const detail = decode(result.stderr).trim() || decode(result.stdout).trim()
    throw new Error(`${errorPrefix} (${result.exitCode})${detail ? `: ${detail.slice(-3_000)}` : ''}`)
  }
  return decode(result.stdout).trim()
}

const SQLITE_SCHEMA_SCRIPT = String.raw`
import Database from 'better-sqlite3'
const db = new Database(process.env.ONE_CHAT_DB, { readonly: true, fileMustExist: true })
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((table) => ({
  name: table.name,
  sql: table.sql,
  columns: db.prepare('PRAGMA table_info(' + JSON.stringify(table.name) + ')').all(),
  indexes: db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name").all(table.name),
}))
console.log(JSON.stringify({ tables }))
db.close()
`

const SQLITE_VACUUM_SCRIPT = String.raw`
import Database from 'better-sqlite3'
const db = new Database(process.env.ONE_CHAT_SOURCE)
db.pragma('wal_checkpoint(PASSIVE)')
db.prepare('VACUUM INTO ?').run(process.env.ONE_CHAT_DESTINATION)
db.close()
`

const SQLITE_APPLY_SCRIPT = String.raw`
import Database from 'better-sqlite3'
const db = new Database(process.env.ONE_CHAT_DB)
const sql = Buffer.from(process.env.ONE_CHAT_SQL_BASE64 || '', 'base64').toString('utf8').trim()
if (sql) db.transaction(() => db.exec(sql))()
db.close()
`

async function schemaSnapshot(runtime: RuntimeBundle, dbPath: string): Promise<SqliteSchemaSnapshot> {
  const output = await exec(
    runtime,
    `node --input-type=module -e ${shellQuote(SQLITE_SCHEMA_SCRIPT)}`,
    { env: { ONE_CHAT_DB: dbPath } },
    'schema inspection failed',
  )
  return JSON.parse(output) as SqliteSchemaSnapshot
}

async function removeIfPresent(runtime: RuntimeBundle, relativePath: string): Promise<void> {
  try {
    await runtime.workspace.unlink(relativePath)
  } catch {
    // A missing disposable file is already in the desired state.
  }
}

async function vacuumCopy(runtime: RuntimeBundle, source: string, destination: string): Promise<void> {
  await runtime.workspace.mkdir(path.posix.dirname(destination), { recursive: true })
  await removeIfPresent(runtime, destination)
  await exec(
    runtime,
    `node --input-type=module -e ${shellQuote(SQLITE_VACUUM_SCRIPT)}`,
    { env: { ONE_CHAT_SOURCE: source, ONE_CHAT_DESTINATION: destination } },
    'database snapshot failed',
  )
}

async function applySql(runtime: RuntimeBundle, dbPath: string, sqlPath: string): Promise<void> {
  const sql = await runtime.workspace.readFile(sqlPath)
  await exec(
    runtime,
    `node --input-type=module -e ${shellQuote(SQLITE_APPLY_SCRIPT)}`,
    { env: { ONE_CHAT_DB: dbPath, ONE_CHAT_SQL_BASE64: Buffer.from(sql).toString('base64') } },
    'schema transaction failed',
  )
}

function nowId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function changeLine(slug: string, summary: string): string {
  return `- ${new Date().toISOString().slice(0, 10)} · ${slug} · ${summary}`
}

async function appendChange(runtime: RuntimeBundle, slug: string, summary: string, replacePrior = true): Promise<void> {
  const relative = path.posix.join('docs', 'CHANGES.md')
  let body = '# Changes\n'
  try {
    body = await runtime.workspace.readFile(relative)
  } catch {
    // A generated app may not have a change log yet.
  }
  const line = changeLine(slug, summary)
  const previous = replacePrior
    ? body.split('\n').filter((candidate) => !candidate.includes(`· ${slug} ·`)).join('\n').trimEnd()
    : body.trimEnd()
  await runtime.workspace.mkdir('docs', { recursive: true })
  await runtime.workspace.writeFile(relative, `${previous}\n${line}\n`)
}

async function install(runtime: RuntimeBundle): Promise<void> {
  await exec(
    runtime,
    "pnpm install --frozen-lockfile --config.minimum-release-age=0",
    {
      env: {
        ...(process.env.COREPACK_HOME
          ? { COREPACK_HOME: process.env.COREPACK_HOME }
          : process.env.HOME
            ? { COREPACK_HOME: path.join(process.env.HOME, '.cache', 'node', 'corepack') }
            : {}),
      },
    },
    'candidate dependency install failed',
  )
}

async function modelSchema(runtime: RuntimeBundle): Promise<SqliteSchemaSnapshot> {
  const targetPath = path.posix.join('.one-chat', 'target.sqlite')
  await runtime.workspace.mkdir('.one-chat', { recursive: true })
  await removeIfPresent(runtime, targetPath)
  await exec(
    runtime,
    'pnpm --config.minimum-release-age=0 exec drizzle-kit push --config drizzle.config.ts --force',
    { env: { DATABASE_URL: `./${targetPath}` } },
    'candidate schema could not be materialized',
  )
  return schemaSnapshot(runtime, targetPath)
}

export interface AppLifecycle {
  prepareCandidate(metadata: CandidateMetadata): Promise<{ workspaceRoot: string; previewUrl: string }>
  candidateRoot(intentSlug: string): string | undefined
  verifyCandidate(intentSlug: string, stage?: 'mockup' | 'build'): Promise<VerifiedCandidate>
  keepChange(intentSlug: string): Promise<LifecycleResult>
  discardChange(intentSlug: string): Promise<LifecycleResult>
  undoChange(input: { slug?: string; sessionId: string; model: string }): Promise<LifecycleResult>
  showVersion(input: { commit?: string; slug?: string }): Promise<VersionPreview>
  appStatus(): Promise<AppServiceStatus>
  backToApp(): Promise<void>
  close(): Promise<void>
}

export function createAppLifecycle(host: AppLifecycleHost): AppLifecycle {
  let candidate: CandidateState | undefined
  let preview: PreviewRun | undefined
  let mutation = Promise.resolve()

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutation.then(operation, operation)
    mutation = next.then(() => undefined, () => undefined)
    return next
  }

  const acceptedRuntime = () => host.acquireAcceptedRuntime()

  const stopPreview = async () => {
    const active = preview
    preview = undefined
    if (!active) return
    active.controller.abort(new Error('preview stopped'))
    await Promise.race([active.done.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5_000))])
    if (active.kind === 'version') await active.runtime.disposeRuntime?.().catch(() => undefined)
    if (active.kind === 'version' && active.worktreePath) {
      const accepted = await acceptedRuntime()
      await exec(accepted, `git worktree remove --force ${shellQuote(active.worktreePath)}`, {}, 'version cleanup failed').catch((error) => host.log(String(error)))
    }
  }

  const startPreview = async (runtime: RuntimeBundle, kind: PreviewRun['kind'], worktreePath?: string) => {
    await stopPreview()
    const controller = new AbortController()
    const done = host.startPreview(runtime, host.app.candidatePort, controller.signal).catch((error) => {
      if (!controller.signal.aborted) host.log(`${kind} preview stopped: ${String(error)}`)
    })
    preview = { kind, controller, done, runtime, worktreePath }
    await host.health(runtime, host.app.candidatePort, controller.signal)
  }

  const cleanupCandidate = async (removeBranch: boolean) => {
    await stopPreview()
    const current = candidate
    candidate = undefined
    if (current) await current.runtime.disposeRuntime?.().catch(() => undefined)
    const accepted = await acceptedRuntime()
    await exec(accepted, 'git worktree remove --force candidate', {}, 'candidate cleanup failed').catch(() => undefined)
    if (removeBranch && current) {
      await exec(accepted, `git branch -D ${shellQuote(`try/${current.intentSlug}`)}`, {}, 'candidate branch cleanup failed').catch(() => undefined)
    }
    await exec(accepted, 'git worktree prune', {}, 'candidate worktree prune failed').catch(() => undefined)
  }

  const prepareCandidate = (metadata: CandidateMetadata) => serialize(async () => {
    if (candidate?.intentSlug === metadata.intentSlug) {
      await stopPreview()
      const accepted = await acceptedRuntime()
      const intentPath = path.posix.join('agent', 'intents', `${metadata.intentSlug}.md`)
      await candidate.runtime.workspace.writeFile(intentPath, await accepted.workspace.readFile(intentPath))
      candidate.verified = false
      candidate.approvedSql = undefined
      return { workspaceRoot: candidate.workspaceRoot, previewUrl: host.candidateUrl }
    }
    if (candidate) throw new Error('another change is already being tried')
    const accepted = await acceptedRuntime()
    const dirty = await exec(accepted, 'git status --porcelain --untracked-files=no', {}, 'could not inspect the accepted app')
    if (dirty) throw new Error('the accepted app has an unfinished change')
    await exec(
      accepted,
      `git worktree add -b ${shellQuote(`try/${metadata.intentSlug}`)} candidate main`,
      {},
      'candidate worktree could not be created',
    )
    const workspaceRoot = path.join(host.appRoot, 'candidate')
    let runtime: RuntimeBundle | undefined
    try {
      runtime = withoutRuntimeCredentials(await host.runtimeModeAdapter.create({
        workspaceRoot,
        workspaceId: `one-chat-candidate:${host.app.slug}`,
        sessionId: `one-chat-candidate:${host.app.slug}:${metadata.intentSlug}`,
      }))
      await runtime.workspace.mkdir(path.posix.join('agent', 'intents'), { recursive: true })
      const intentPath = path.posix.join('agent', 'intents', `${metadata.intentSlug}.md`)
      await runtime.workspace.writeFile(intentPath, await accepted.workspace.readFile(intentPath))
      await install(runtime)
      await vacuumCopy(accepted, 'data/app.sqlite', 'candidate/data/app.sqlite')
      candidate = { ...metadata, workspaceRoot, runtime, approvedSql: undefined, verified: false }
      return { workspaceRoot, previewUrl: host.candidateUrl }
    } catch (error) {
      await runtime?.disposeRuntime?.().catch(() => undefined)
      await exec(accepted, 'git worktree remove --force candidate', {}, 'candidate cleanup failed').catch(() => undefined)
      await exec(accepted, `git branch -D ${shellQuote(`try/${metadata.intentSlug}`)}`, {}, 'candidate cleanup failed').catch(() => undefined)
      throw error
    }
  })

  const verifyPreparedCandidate = async (intentSlug: string, stage?: 'mockup' | 'build'): Promise<VerifiedCandidate> => {
    const current = candidate
    if (!current || current.intentSlug !== intentSlug) throw new Error(`there is no candidate for ${intentSlug}`)
    current.verified = false
    current.approvedSql = undefined
    await stopPreview()
    if (stage === 'build') {
      try {
        const smoke = await current.runtime.workspace.stat('scripts/smoke.mjs')
        if (smoke.kind !== 'file') throw new Error('not a file')
      } catch {
        throw new Error('verification failed: BUILD needs scripts/smoke.mjs with the agreement checks')
      }
    }
    await exec(current.runtime, 'pnpm --config.minimum-release-age=0 run typecheck', {}, 'typecheck failed')
    const [live, target] = await Promise.all([
      acceptedRuntime().then((runtime) => schemaSnapshot(runtime, 'data/app.sqlite')),
      modelSchema(current.runtime),
    ])
    const plan = planSafeAdditiveMigration(live, target)
    if (!plan.ok) throw new Error(`schema check refused the change: ${plan.reason}`)
    const sql = plan.statements.join('\n')
    const inspected = inspectSafeAdditiveSql(sql, new Set(live.tables.map((table) => table.name)))
    if (!inspected.ok) throw new Error(`schema check refused the change: ${inspected.reason}`)
    await current.runtime.workspace.mkdir('.one-chat', { recursive: true })
    await current.runtime.workspace.writeFile(path.posix.join('.one-chat', 'approved.sql'), `${sql}${sql ? '\n' : ''}`)
    const accepted = await acceptedRuntime()
    await vacuumCopy(accepted, 'data/app.sqlite', 'candidate/data/app.sqlite')
    await applySql(current.runtime, 'data/app.sqlite', path.posix.join('.one-chat', 'approved.sql'))
    await exec(
      current.runtime,
      'bash ./verify.sh',
      {
        env: {
          DATABASE_URL: './data/app.sqlite',
          VERIFY_PORT: String(host.app.candidatePort),
          ONE_CHAT_APPROVED_SQL: './.one-chat/approved.sql',
          ONE_CHAT_SKIP_DB_PUSH: '1',
        },
        timeoutMs: 180_000,
      },
      'verification failed',
    )
    await startPreview(current.runtime, 'candidate')
    current.approvedSql = plan.statements
    current.verified = true
    return { intentSlug, previewUrl: host.candidateUrl, approvedSql: plan.statements }
  }

  const commitCandidate = async (current: CandidateState): Promise<string> => {
    const priorMessage = await exec(current.runtime, 'git log -1 --format=%B', {}, 'candidate history could not be read')
    const amendingRetry = priorMessage.match(/^One-Chat-Intent:\s*(\S+)$/m)?.[1] === current.intentSlug
    await appendChange(current.runtime, current.intentSlug, current.intentTitle)
    await exec(current.runtime, 'git add -A', {}, 'candidate staging failed')
    const message = [
      current.intentTitle,
      '',
      `One-Chat-Intent: ${current.intentSlug}`,
      `One-Chat-Session: ${current.sessionId}`,
      `One-Chat-Model: ${current.model}`,
    ].join('\n')
    await exec(
      current.runtime,
      `git commit ${amendingRetry ? '--amend ' : ''}-m ${shellQuote(message)}`,
      {},
      'candidate commit failed',
    )
    return exec(current.runtime, 'git rev-parse HEAD', {}, 'candidate commit could not be read')
  }

  const restoreLastGood = async (accepted: RuntimeBundle, oldSha: string, backupPath: string | undefined) => {
    await host.stopAccepted().catch(() => undefined)
    const head = await exec(accepted, 'git rev-parse HEAD', {}, 'could not inspect failed promotion').catch(() => '')
    if (head && head !== oldSha) {
      await exec(accepted, `git update-ref refs/heads/main ${shellQuote(oldSha)} ${shellQuote(head)}`, {}, 'main ref restore failed')
      await exec(accepted, `git restore --source ${shellQuote(oldSha)} --staged --worktree .`, {}, 'last-good source restore failed')
    }
    if (backupPath) {
      await removeIfPresent(accepted, 'data/app.sqlite-wal')
      await removeIfPresent(accepted, 'data/app.sqlite-shm')
      await exec(accepted, `cp ${shellQuote(backupPath)} data/app.sqlite`, {}, 'database backup restore failed')
    }
    host.startAccepted()
    await host.health(accepted, host.app.acceptedPort)
  }

  const keepChange = (intentSlug: string) => serialize(async (): Promise<LifecycleResult> => {
    const current = candidate
    if (!current || current.intentSlug !== intentSlug || !current.verified || !current.approvedSql) {
      return { ok: false, message: 'I can’t keep that yet because the preview has not passed its checks.', intentSlug }
    }
    await stopPreview()
    const accepted = await acceptedRuntime()
    const oldSha = await exec(accepted, 'git rev-parse HEAD', {}, 'could not read the last-good version')
    let backupPath: string | undefined
    try {
      const commit = await commitCandidate(current)
      await host.stopAccepted()
      backupPath = path.posix.join('data', 'backups', `${nowId()}.sqlite`)
      await vacuumCopy(accepted, 'data/app.sqlite', backupPath)
      await accepted.workspace.mkdir('.one-chat', { recursive: true })
      const sqlPath = path.posix.join('.one-chat', `approved-${intentSlug}.sql`)
      await accepted.workspace.writeFile(sqlPath, `${current.approvedSql.join('\n')}${current.approvedSql.length ? '\n' : ''}`)
      await applySql(accepted, 'data/app.sqlite', sqlPath)
      await exec(accepted, `git merge --ff-only ${shellQuote(commit)}`, {}, 'candidate promotion failed')
      host.startAccepted()
      await host.health(accepted, host.app.acceptedPort)
      const keptIntent = await readIntent(accepted.workspace, intentSlug)
      if (keptIntent) {
        await recordIntentEvent(
          accepted.workspace,
          intentSlug,
          `Revision v${keptIntent.revision} validated and kept.`,
        ).catch((error) => host.log(`intent revision journal update failed: ${String(error)}`))
      }
      await setIntentStatus(accepted.workspace, intentSlug, 'kept').catch((error) => host.log(`intent status update failed: ${String(error)}`))
      await cleanupCandidate(true)
      return {
        ok: true,
        message: `Kept. Your app is updated. Address: ${host.acceptedUrl} On your phone, open that address and choose Add to Home Screen. If it does not open, tell me “my app is down”.`,
        intentSlug,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      try {
        await restoreLastGood(accepted, oldSha, backupPath)
      } catch (restoreError) {
        host.log(`keep rollback failed for ${intentSlug}: ${String(restoreError)}`)
      }
      host.log(`keep failed for ${intentSlug}: ${reason}`)
      return { ok: false, message: `I couldn’t keep that change because ${reason.split('\n')[0]}. Your app is back as it was.`, intentSlug }
    }
  })

  const discardChange = (intentSlug: string) => serialize(async (): Promise<LifecycleResult> => {
    if (!candidate || candidate.intentSlug !== intentSlug) {
      return { ok: false, message: 'There is no preview to leave behind.', intentSlug }
    }
    await cleanupCandidate(true)
    await setIntentStatus((await acceptedRuntime()).workspace, intentSlug, 'agreed').catch((error) => host.log(`intent status update failed: ${String(error)}`))
    return { ok: true, message: 'Left it as it was.', intentSlug }
  })

  const keptCommit = async (accepted: RuntimeBundle, requestedSlug?: string) => {
    const output = await exec(accepted, 'git log main --format=%H%x1f%ct%x1f%B%x1e', {}, 'change history could not be read')
    const entries = output.split('\x1e').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [sha = '', timestamp = '', ...body] = entry.split('\x1f')
      const message = body.join('\x1f')
      return {
        sha,
        timestamp: Number(timestamp),
        message,
        slug: message.match(/^One-Chat-Intent:\s*(\S+)$/m)?.[1],
        undoSha: message.match(/^One-Chat-Undo:\s*(\S+)$/m)?.[1],
      }
    })
    const undone = new Set(entries.flatMap((entry) => entry.undoSha ? [entry.undoSha] : []))
    return entries.find((entry) => entry.slug && !entry.undoSha && !undone.has(entry.sha) && (!requestedSlug || entry.slug === requestedSlug))
  }

  const cleanupUndoWorktree = async (accepted: RuntimeBundle, branch: string, runtime?: RuntimeBundle) => {
    await runtime?.disposeRuntime?.().catch(() => undefined)
    await exec(accepted, 'git worktree remove --force candidate', {}, 'undo worktree cleanup failed').catch(() => undefined)
    await exec(accepted, `git branch -D ${shellQuote(branch)}`, {}, 'undo branch cleanup failed').catch(() => undefined)
  }

  const undoChange = (input: { slug?: string; sessionId: string; model: string }) => serialize(async (): Promise<LifecycleResult> => {
    if (candidate) return { ok: false, message: 'Please keep or leave the current preview before taking back an earlier change.' }
    const accepted = await acceptedRuntime()
    const kept = await keptCommit(accepted, input.slug)
    if (!kept?.slug) return { ok: false, message: 'There is no kept change to take back.' }
    const branch = `undo/${kept.slug}-${Date.now()}`
    let existingChangeLog = '# Changes\n'
    try {
      existingChangeLog = await accepted.workspace.readFile(path.posix.join('docs', 'CHANGES.md'))
    } catch {
      // The first undo may start the readable history.
    }
    await exec(accepted, `git worktree add -b ${shellQuote(branch)} candidate main`, {}, 'undo copy could not be prepared')
    const workspaceRoot = path.join(host.appRoot, 'candidate')
    let runtime: RuntimeBundle | undefined
    try {
      runtime = withoutRuntimeCredentials(await host.runtimeModeAdapter.create({
        workspaceRoot,
        workspaceId: `one-chat-undo:${host.app.slug}`,
        sessionId: `one-chat-undo:${host.app.slug}:${kept.slug}`,
      }))
      await install(runtime)
      await exec(runtime, `git revert --no-commit ${shellQuote(kept.sha)}`, {}, 'the change could not be taken back cleanly')
      await runtime.workspace.mkdir('docs', { recursive: true })
      await runtime.workspace.writeFile(path.posix.join('docs', 'CHANGES.md'), existingChangeLog)
      await appendChange(runtime, kept.slug, `Undid ${kept.message.split('\n', 1)[0] ?? kept.slug}`, false)
      const [live, target] = await Promise.all([schemaSnapshot(accepted, 'data/app.sqlite'), modelSchema(runtime)])
      const plan = planSafeAdditiveMigration(live, target)
      if (!plan.ok) {
        await cleanupUndoWorktree(accepted, branch, runtime)
        const savedThing = kept.message.split('\n', 1)[0]?.trim().toLowerCase() || 'information'
        return {
          ok: false,
          message: `I can't take that back without losing the ${savedThing} you saved; want me to hide the field instead?`,
          intentSlug: kept.slug,
        }
      }
      await runtime.workspace.mkdir('.one-chat', { recursive: true })
      await runtime.workspace.writeFile(path.posix.join('.one-chat', 'approved.sql'), `${plan.statements.join('\n')}${plan.statements.length ? '\n' : ''}`)
      await vacuumCopy(accepted, 'data/app.sqlite', 'candidate/data/app.sqlite')
      await applySql(runtime, 'data/app.sqlite', path.posix.join('.one-chat', 'approved.sql'))
      await exec(runtime, 'bash ./verify.sh', {
        env: {
          DATABASE_URL: './data/app.sqlite',
          VERIFY_PORT: String(host.app.candidatePort),
          ONE_CHAT_APPROVED_SQL: './.one-chat/approved.sql',
          ONE_CHAT_SKIP_DB_PUSH: '1',
        },
        timeoutMs: 180_000,
      }, 'the earlier app no longer passes its checks')
      const message = [
        `Undo ${kept.message.split('\n', 1)[0] ?? kept.slug}`,
        '',
        `One-Chat-Undo: ${kept.sha}`,
        `One-Chat-Intent: ${kept.slug}`,
        `One-Chat-Session: ${input.sessionId}`,
        `One-Chat-Model: ${input.model}`,
      ].join('\n')
      await exec(runtime, 'git add -A', {}, 'undo staging failed')
      await exec(runtime, `git commit -m ${shellQuote(message)}`, {}, 'undo commit failed')
      const undoSha = await exec(runtime, 'git rev-parse HEAD', {}, 'undo commit could not be read')
      const oldSha = await exec(accepted, 'git rev-parse HEAD', {}, 'could not read current version')
      try {
        await host.stopAccepted()
        await accepted.workspace.mkdir('.one-chat', { recursive: true })
        await accepted.workspace.writeFile(path.posix.join('.one-chat', 'undo.sql'), `${plan.statements.join('\n')}${plan.statements.length ? '\n' : ''}`)
        await applySql(accepted, 'data/app.sqlite', path.posix.join('.one-chat', 'undo.sql'))
        await exec(accepted, `git merge --ff-only ${shellQuote(undoSha)}`, {}, 'undo promotion failed')
        host.startAccepted()
        await host.health(accepted, host.app.acceptedPort)
      } catch (error) {
        await restoreLastGood(accepted, oldSha, undefined)
        throw error
      }
      await setIntentStatus(accepted.workspace, kept.slug, 'undone').catch((error) => host.log(`intent status update failed: ${String(error)}`))
      await cleanupUndoWorktree(accepted, branch, runtime)
      return { ok: true, message: 'Taken back. Your saved information is still there.', intentSlug: kept.slug }
    } catch (error) {
      await cleanupUndoWorktree(accepted, branch, runtime)
      const reason = error instanceof Error ? error.message : String(error)
      host.log(`undo failed for ${kept.slug}: ${reason}`)
      return { ok: false, message: `I couldn’t take that back because ${reason.split('\n')[0]}.`, intentSlug: kept.slug }
    }
  })

  const showVersion = (input: { commit?: string; slug?: string }) => serialize(async (): Promise<VersionPreview> => {
    const accepted = await acceptedRuntime()
    let ref = input.commit?.trim()
    if (!ref && input.slug) ref = (await keptCommit(accepted, input.slug))?.sha
    if (!ref) throw new Error('Choose a previous change to show.')
    const sha = await exec(accepted, `git rev-parse --verify ${shellQuote(`${ref}^{commit}`)}`, {}, 'that version was not found')
    await exec(accepted, `git merge-base --is-ancestor ${shellQuote(sha)} main`, {}, 'that version is not part of this app')
    const short = sha.slice(0, 12)
    const relative = path.posix.join('versions', short)
    await stopPreview()
    await exec(accepted, `git worktree add --detach ${shellQuote(relative)} ${shellQuote(sha)}`, {}, 'previous version could not be prepared')
    const workspaceRoot = path.join(host.appRoot, 'versions', short)
    let runtime: RuntimeBundle | undefined
    try {
      runtime = withoutRuntimeCredentials(await host.runtimeModeAdapter.create({
        workspaceRoot,
        workspaceId: `one-chat-version:${host.app.slug}:${short}`,
        sessionId: `one-chat-version:${host.app.slug}:${short}`,
      }))
      await install(runtime)
      await vacuumCopy(accepted, 'data/app.sqlite', `${relative}/data/app.sqlite`)
      await startPreview(runtime, 'version', relative)
      const date = await exec(accepted, `git show -s --format=%cs ${shellQuote(sha)}`, {}, 'version date could not be read')
      let changes = ''
      try {
        changes = (await runtime.workspace.readFile(path.posix.join('docs', 'CHANGES.md'))).split('\n').filter((line) => line.trim().startsWith('-')).at(-1)?.trim() ?? ''
      } catch {
        // Label can still show the commit date.
      }
      return { url: host.candidateUrl, label: [date, changes].filter(Boolean).join(' — ') }
    } catch (error) {
      await runtime?.disposeRuntime?.().catch(() => undefined)
      await exec(accepted, `git worktree remove --force ${shellQuote(relative)}`, {}, 'version cleanup failed').catch(() => undefined)
      throw error
    }
  })

  return {
    prepareCandidate,
    candidateRoot(intentSlug) {
      return candidate?.intentSlug === intentSlug ? candidate.workspaceRoot : undefined
    },
    verifyCandidate: (intentSlug, stage) => serialize(() => verifyPreparedCandidate(intentSlug, stage)),
    keepChange,
    discardChange,
    undoChange,
    showVersion,
    appStatus: () => serialize(async () => {
      const accepted = await acceptedRuntime()
      try {
        await host.health(accepted, host.app.acceptedPort)
        return { up: true, address: host.acceptedUrl }
      } catch (error) {
        host.log(`accepted app status check failed; restarting: ${String(error)}`)
        await host.stopAccepted().catch(() => undefined)
        host.startAccepted()
        return { up: false, address: host.acceptedUrl }
      }
    }),
    backToApp: () => serialize(stopPreview),
    close: () => serialize(async () => {
      if (candidate) await cleanupCandidate(true)
      else await stopPreview()
    }),
  }
}
