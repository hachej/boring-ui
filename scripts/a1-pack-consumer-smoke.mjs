#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const EXPECTED_VERSION = '0.1.89'
const DEFAULT_TIMEOUT_MS = 120_000
const INSTALL_TIMEOUT_MS = 600_000
const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const tempBase = process.env.BORING_A1_PACK_TMPDIR
  ?? join(homedir(), '.cache', 'boring-a1-pack-smoke')

function truthyEnv(value) {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes'
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, NO_COLOR: '1', TMPDIR: tempBase, ...(options.env ?? {}) },
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })
}

function spawnCaptured(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, NO_COLOR: '1', TMPDIR: tempBase, ...(options.env ?? {}) },
    encoding: 'utf8',
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })
  if (result.error) throw result.error
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function findAbsolutePathLeak(text) {
  const patterns = [
    // file URLs for POSIX and Windows paths, e.g. file:///tmp/x, file:///C:/tmp/x.
    /\bfile:\/\/{2,3}(?:[A-Za-z]:\/|\/)?[^\s"'<>)]*/i,
    // Windows drive paths, e.g. C:\tmp\x, C:/tmp/x, or path:C:/tmp/x.
    /(?:^|[\s"'([{=,:])[A-Za-z]:[\\/][^\s"'<>)]*/,
    // Windows UNC paths, e.g. \\server\share\x.
    /(?:^|[\s"'([{=,:])\\\\[^\\/\s"'<>:]+\\[^\s"'<>)]*/,
    // POSIX-style UNC paths, e.g. //server/share, but avoid protocol-relative URLs with dotted hosts.
    /(?:^|[\s"'([{=,])\/\/(?![A-Za-z0-9.-]*\.[A-Za-z]{2,}(?:\/|$))[^/\s"'<>:]+\/[^\s"'<>)]*/,
    // POSIX filesystem paths in bare or delimited forms, e.g. /tmp/x, /tmp,, path:/tmp/x.
    // Restrict root-only matches to common filesystem roots so safe HTTP routes such as /api/v1 are accepted.
    /(?:^|[\s"'([{=,:])\/(?:tmp|home|Users|var|usr|opt|etc|data|mnt|workspace|workspaces|root|app|srv|run)(?=$|[\/\s"'<>),;.!?:])(?:[\/:][A-Za-z0-9._~+:-]+)*/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return undefined
}

function assertNoForbiddenOutput(label, result, forbiddenMarkers) {
  for (const [streamName, text] of [['stdout', result.stdout], ['stderr', result.stderr]]) {
    const absolutePathLeak = findAbsolutePathLeak(text)
    if (absolutePathLeak) {
      throw new Error(`${label} leaked an absolute path in ${streamName}`)
    }
    for (const marker of forbiddenMarkers) {
      if (marker && text.includes(marker)) {
        throw new Error(`${label} leaked a forbidden marker in ${streamName}`)
      }
    }
  }
}

function expectLeakCaught(name, result, forbiddenMarkers = []) {
  try {
    assertNoForbiddenOutput(name, result, forbiddenMarkers)
  } catch {
    return
  }
  throw new Error(`${name} self-proof failed`)
}

function selfProofForbiddenOutputScanner() {
  assertNoForbiddenOutput('output scanner clean self-proof', {
    stdout: 'Authored agent dev one-shot completed. workspace local:abc123 route /api/v1/ok relative/path ok https://example.com/a //cdn.example.com/app.js',
    stderr: '',
  }, ['SECRET'])
  expectLeakCaught('output scanner stdout marker self-proof', { stdout: 'SECRET', stderr: '' }, ['SECRET'])
  expectLeakCaught('output scanner stderr marker self-proof', { stdout: '', stderr: 'SECRET' }, ['SECRET'])
  expectLeakCaught('output scanner bare POSIX path self-proof', { stdout: '', stderr: '/tmp/forbidden-path' })
  expectLeakCaught('output scanner root-only POSIX punctuation self-proof', { stdout: 'path was /tmp, redacted', stderr: '' })
  expectLeakCaught('output scanner reviewer root POSIX self-proof', { stdout: '/root/.cache/secret', stderr: '' })
  expectLeakCaught('output scanner app root POSIX self-proof', { stdout: '/app/server.js', stderr: '' })
  expectLeakCaught('output scanner srv root POSIX self-proof', { stdout: '/srv/app', stderr: '' })
  expectLeakCaught('output scanner run root POSIX self-proof', { stdout: '/run/user/1000/socket', stderr: '' })
  expectLeakCaught('output scanner delimited POSIX path self-proof', { stdout: 'path:/tmp/forbidden-path', stderr: '' })
  expectLeakCaught('output scanner POSIX file URL self-proof', { stdout: 'file:///tmp/forbidden-path', stderr: '' })
  expectLeakCaught('output scanner UNC POSIX self-proof', { stdout: '//server/share/secret', stderr: '' })
  expectLeakCaught('output scanner Windows UNC self-proof', { stdout: '\\\\server\\share\\secret', stderr: '' })
  expectLeakCaught('output scanner Windows drive path self-proof', { stdout: 'C:\\tmp\\forbidden-path', stderr: '' })
  expectLeakCaught('output scanner Windows slash drive path self-proof', { stdout: 'path:C:/tmp/forbidden-path', stderr: '' })
  expectLeakCaught('output scanner Windows file URL self-proof', { stdout: 'file:///C:/tmp/forbidden-path', stderr: '' })
  console.log('package output scanner self-proof ok')
}

function runTsc(input) {
  const result = spawnSync('pnpm', [
    'exec',
    'tsc',
    '--noEmit',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--jsx',
    'react-jsx',
    '--skipLibCheck',
    input.file,
  ], {
    cwd: input.cwd,
    env: { ...process.env, NO_COLOR: '1', TMPDIR: tempBase },
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
  })
  if (result.error) throw result.error
  return result
}

function assertTscPass(input) {
  console.log(`$ pnpm exec tsc --noEmit ${input.file}`)
  const result = runTsc(input)
  if (result.status !== 0) {
    console.error(result.stdout)
    console.error(result.stderr)
    throw new Error(`${input.label} expected TypeScript compile success, got ${result.status}`)
  }
}

function assertTscFail(input) {
  console.log(`$ pnpm exec tsc --noEmit ${input.file} # expected failure`)
  const result = runTsc(input)
  const output = `${result.stdout}\n${result.stderr}`
  if (result.status === 0 || !output.includes('has no exported member')) {
    console.error(result.stdout)
    console.error(result.stderr)
    throw new Error(`${input.label} expected missing-export TypeScript failure, got ${result.status}`)
  }
}

function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
}

function assertArtifact(path) {
  if (!existsSync(path)) throw new Error(`required build artifact missing before pack: ${path}`)
}

function assertPackageVersion(packageDir, expectedName) {
  const manifest = readPackageJson(packageDir)
  assertEqual(manifest.name, expectedName, `${expectedName} package name`)
  assertEqual(manifest.version, EXPECTED_VERSION, `${expectedName} package version`)
}

function assertSafeGeneratedWorkRoot(workRoot) {
  const resolvedBase = resolve(tempBase)
  const resolvedWorkRoot = resolve(workRoot)
  if (!resolvedWorkRoot.startsWith(`${resolvedBase}/`)) {
    throw new Error(`refusing to remove work root outside temp base: ${resolvedWorkRoot}`)
  }
  if (!basename(resolvedWorkRoot).startsWith('boring-a1-pack-consumer-')) {
    throw new Error(`refusing to remove unexpected work root name: ${resolvedWorkRoot}`)
  }
}

async function main() {
  await mkdir(tempBase, { recursive: true })
  const workRoot = mkdtempSync(join(tempBase, 'boring-a1-pack-consumer-'))
  const retainDebug = truthyEnv(process.env.BORING_A1_PACK_RETAIN_DEBUG)
  let setupFailureSelfTest = false
  console.log(`A1 pack smoke generated workspace: ${workRoot}`)
  console.log(retainDebug
    ? 'A1 pack smoke retain flag enabled; generated workspace will be kept.'
    : 'A1 pack smoke will remove only its generated workspace in finally.')

  try {
    assertSafeGeneratedWorkRoot(workRoot)
    if (truthyEnv(process.env.BORING_A1_PACK_SELF_TEST_SETUP_FAILURE)) {
      setupFailureSelfTest = true
      throw new Error('intentional setup failure self-test')
    }

    const packDir = join(workRoot, 'packs')
    const consumerDir = join(workRoot, 'consumer')
    await mkdir(packDir, { recursive: true })
    await mkdir(consumerDir, { recursive: true })

    const agentDir = join(repoRoot, 'packages/agent')
    const workspaceDir = join(repoRoot, 'packages/workspace')
    const cliDir = join(repoRoot, 'packages/cli')

    assertPackageVersion(agentDir, '@hachej/boring-agent')
    assertPackageVersion(workspaceDir, '@hachej/boring-workspace')
    assertPackageVersion(cliDir, '@hachej/boring-ui-cli')

    run('pnpm', ['--filter', '@hachej/boring-workspace', 'build'], { timeoutMs: 900_000 })

    for (const artifact of [
      join(agentDir, 'dist/server/index.js'),
      join(agentDir, 'dist/shared/index.js'),
      join(agentDir, 'dist/front/index.js'),
      join(workspaceDir, 'dist/app-server.js'),
      join(workspaceDir, 'dist/server.js'),
      join(workspaceDir, 'dist/workspace.js'),
      join(cliDir, 'dist/index.js'),
      join(cliDir, 'dist/server/cli.js'),
    ]) assertArtifact(artifact)

    function pack(packageDir, expectedName) {
      const output = run('pnpm', ['--dir', packageDir, 'pack', '--json', '--pack-destination', packDir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        timeoutMs: 180_000,
      })
      const parsed = JSON.parse(output.trim())
      const entry = Array.isArray(parsed) ? parsed[0] : parsed
      const filename = entry.filename
      if (typeof filename !== 'string') throw new Error(`pnpm pack did not report filename for ${expectedName}`)
      const expectedBasename = `${expectedName.replace('@', '').replace('/', '-')}-${EXPECTED_VERSION}.tgz`
      assertEqual(basename(filename), expectedBasename, `${expectedName} tarball name/version`)
      return filename
    }

    const agentTarball = pack(agentDir, '@hachej/boring-agent')
    const workspaceTarball = pack(workspaceDir, '@hachej/boring-workspace')
    const cliTarball = pack(cliDir, '@hachej/boring-ui-cli')
    console.log(`agent tarball:     ${agentTarball}`)
    console.log(`workspace tarball: ${workspaceTarball}`)
    console.log(`cli tarball:       ${cliTarball}`)

    writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
      private: true,
      type: 'module',
      packageManager: 'pnpm@10.33.2',
      dependencies: {
        '@hachej/boring-agent': `file:${agentTarball}`,
        '@hachej/boring-workspace': `file:${workspaceTarball}`,
        '@hachej/boring-ui-cli': `file:${cliTarball}`,
      },
      devDependencies: {
        typescript: '6.0.3',
      },
      pnpm: {
        overrides: {
          '@hachej/boring-agent': `file:${agentTarball}`,
          '@hachej/boring-workspace': `file:${workspaceTarball}`,
          '@mariozechner/pi-coding-agent': 'npm:@earendil-works/pi-coding-agent@0.80.7',
          '@earendil-works/pi-ai': '0.80.7',
          '@perspective-dev/client': '4.4.1',
          '@perspective-dev/viewer': '4.4.1',
          '@perspective-dev/viewer-datagrid': '4.4.1',
          '@perspective-dev/viewer-d3fc': '4.4.1',
          'better-auth': '1.6.22',
        },
      },
    }, null, 2))

    run('pnpm', ['install', '--ignore-scripts'], { cwd: consumerDir, timeoutMs: INSTALL_TIMEOUT_MS })

    for (const [packageName, expectedVersion] of [
      ['@hachej/boring-agent', EXPECTED_VERSION],
      ['@hachej/boring-workspace', EXPECTED_VERSION],
      ['@hachej/boring-ui-cli', EXPECTED_VERSION],
    ]) {
      const manifest = JSON.parse(readFileSync(join(consumerDir, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8'))
      assertEqual(manifest.name, packageName, `${packageName} installed package name`)
      assertEqual(manifest.version, expectedVersion, `${packageName} installed package version`)
    }

    const typeProofDir = join(consumerDir, 'type-proof')
    await mkdir(typeProofDir, { recursive: true })
    writeFileSync(join(typeProofDir, 'server-positive.ts'), `
import { materializeAgentDirectory, type MaterializedAgentSourceV1 } from '@hachej/boring-agent/server'
const source: MaterializedAgentSourceV1 = Object.freeze({
  schemaVersion: 1,
  agentTypeId: 'claims-assistant',
  version: '1.0.0',
  instructions: 'typed proof',
  tools: [],
  declaredToolRefs: [],
})
void source
void materializeAgentDirectory
`)
    writeFileSync(join(typeProofDir, 'shared-type-negative.ts'), `
import type { MaterializedAgentSourceV1 } from '@hachej/boring-agent/shared'
const source: MaterializedAgentSourceV1 | undefined = undefined
void source
`)
    writeFileSync(join(typeProofDir, 'front-type-negative.ts'), `
import type { MaterializedAgentSourceV1 } from '@hachej/boring-agent/front'
const source: MaterializedAgentSourceV1 | undefined = undefined
void source
`)
    writeFileSync(join(typeProofDir, 'front-value-negative.ts'), `
import { materializeAgentDirectory } from '@hachej/boring-agent/front'
void materializeAgentDirectory
`)
    writeFileSync(join(typeProofDir, 'cli-server-positive.ts'), `
import {
  runCli,
  type AgentDevTrustedToolCatalogAdapter,
  type RunCliAgentDevOptions,
  type RunCliOptions,
} from '@hachej/boring-ui-cli/server'
const adapter: AgentDevTrustedToolCatalogAdapter = { resolveToolCatalog() { return undefined } }
const agentDev: RunCliAgentDevOptions = { trustedToolCatalogAdapter: adapter, provisionWorkspace: false }
const options: RunCliOptions = { argv: ['agent', 'dev'], publicDir: '.', agentDev }
void runCli
void options
`)
    assertTscPass({ cwd: consumerDir, file: join(typeProofDir, 'server-positive.ts'), label: 'server MaterializedAgentSourceV1 import' })
    assertTscFail({ cwd: consumerDir, file: join(typeProofDir, 'shared-type-negative.ts'), label: 'shared MaterializedAgentSourceV1 import negative' })
    assertTscFail({ cwd: consumerDir, file: join(typeProofDir, 'front-type-negative.ts'), label: 'front MaterializedAgentSourceV1 import negative' })
    assertTscFail({ cwd: consumerDir, file: join(typeProofDir, 'front-value-negative.ts'), label: 'front materializeAgentDirectory import negative' })
    assertTscPass({ cwd: consumerDir, file: join(typeProofDir, 'cli-server-positive.ts'), label: 'CLI server seam type import' })
    console.log('package TypeScript export proof ok')

    const probe = `
import assert from 'node:assert/strict'
import { materializeAgentDirectory } from '@hachej/boring-agent/server'
import * as shared from '@hachej/boring-agent/shared'
import * as front from '@hachej/boring-agent/front'
assert.equal(typeof materializeAgentDirectory, 'function')
assert.equal(Object.hasOwn(shared, 'materializeAgentDirectory'), false)
assert.equal(Object.hasOwn(front, 'materializeAgentDirectory'), false)
console.log('package runtime value export probe ok')
`
    run(process.execPath, ['--input-type=module', '--eval', probe], { cwd: consumerDir })

    const exampleDir = join(consumerDir, 'node_modules/@hachej/boring-agent/examples/trusted-authored-agent')
    const validate = run('pnpm', ['exec', 'boring-ui', 'agent', 'validate', exampleDir, '--json'], {
      cwd: consumerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const validatePayload = JSON.parse(validate)
    assertEqual(validatePayload.ok, true, 'installed-bin validate ok')
    assertEqual(validatePayload.agent.agentTypeId, 'claims-assistant', 'installed-bin validate agent id')
    assertEqual(validatePayload.agent.version, '1.0.0', 'installed-bin validate example version')
    console.log('installed-bin validate ok')

    const dev = spawnSync('pnpm', ['exec', 'boring-ui', 'agent', 'dev', exampleDir, '--prompt', 'pack smoke'], {
      cwd: consumerDir,
      env: { ...process.env, NO_COLOR: '1', TMPDIR: tempBase, BORING_UI_WORKSPACES_PATH: join(workRoot, 'workspaces.yaml') },
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
    })
    if (dev.error) throw dev.error
    if (dev.status !== 1 || !dev.stderr.includes('AUTHORED_AGENT_CATALOG_REQUIRED')) {
      console.error(dev.stdout)
      console.error(dev.stderr)
      throw new Error(`installed-bin dev fail-closed smoke expected AUTHORED_AGENT_CATALOG_REQUIRED, got ${dev.status}`)
    }
    console.log('installed-bin dev fail-closed smoke ok')

    const serverSeamPublicDir = join(consumerDir, 'server-seam-public')
    await mkdir(join(serverSeamPublicDir, 'assets'), { recursive: true })
    writeFileSync(join(serverSeamPublicDir, 'index.html'), '<!doctype html><div id="root"></div>')
    const serverSeamWorkspaceRoot = join(consumerDir, 'server-seam-workspace')
    await mkdir(serverSeamWorkspaceRoot, { recursive: true })
    const serverSeamCaptureFile = join(consumerDir, 'server-seam-capture.json')
    const serverSeamProbe = `
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { runCli } from '@hachej/boring-ui-cli/server'
import { resolveMode } from '@hachej/boring-agent/server'

const captureFile = ${JSON.stringify(serverSeamCaptureFile)}
function readCapture() {
  try { return JSON.parse(readFileSync(captureFile, 'utf8')) } catch { return {} }
}
function record(patch) {
  writeFileSync(captureFile, JSON.stringify({ ...readCapture(), ...patch }, null, 2))
}
class Store {
  constructor() { this.records = new Map() }
  _record(id, ctx = {}) {
    const existing = this.records.get(id)
    if (existing) return existing
    const record = { id, title: 'Pack seam capture', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', turnCount: 0, ctx }
    this.records.set(id, record)
    return record
  }
  async list(ctx) { return [...this.records.values()].filter((record) => (record.ctx.workspaceId ?? '') === (ctx.workspaceId ?? '') && (record.ctx.userId ?? '') === (ctx.userId ?? '')) }
  async create(ctx) { return this._record('created-session', ctx) }
  async load(ctx, id) { return this._record(id, ctx) }
  async delete(ctx, id) { this.records.delete(id) }
}
class Adapter {
  constructor(input, sessionId, ctx) { this.input = input; this.sessionId = sessionId; this.ctx = ctx; this.subscribers = new Set(); this.streaming = false }
  readSnapshot() { return { state: {}, messages: [], isStreaming: this.streaming, isRetrying: false, retryAttempt: 0, pendingMessageCount: 0, steeringMessages: [], followUpMessages: [], followUpMode: 'one-at-a-time', sessionId: this.sessionId, sessionName: 'Pack seam capture' } }
  subscribe(listener) { this.subscribers.add(listener); return () => this.subscribers.delete(listener) }
  emit(event) { for (const listener of this.subscribers) listener(event) }
  async prompt(promptInput) {
    const text = typeof promptInput === 'string' ? promptInput : promptInput.text
    record({ promptText: text })
    const tool = this.input.tools.find((candidate) => candidate.name === 'claims_lookup')
    assert.ok(tool, 'claims_lookup tool was provided')
    const result = await tool.execute({ from: 'pack-server-seam' }, { abortSignal: new AbortController().signal, toolCallId: 'pack-tool-call', sessionId: this.sessionId, workspaceId: this.ctx.workspaceId, requestId: 'pack-request' })
    const textResult = Array.isArray(result?.content) ? result.content.map((part) => part?.text).filter(Boolean).join('\\n') : ''
    record({ toolInvoked: true, toolName: tool.name, toolResult: textResult })
    this.emit({ type: 'agent_start', turnId: 'pack-turn' })
    this.emit({ type: 'agent_end', turnId: 'pack-turn', status: 'ok', messages: [], willRetry: false })
  }
  async followUp() {}
  clearFollowUp() {}
  async abort() { this.streaming = false }
}
function createHarnessFactory() {
  return async (input) => {
    const sessions = new Store()
    const adapters = new Map()
    record({ factoryInput: { cwd: input.cwd, systemPromptAppend: input.systemPromptAppend, tools: input.tools.map((tool) => tool.name) } })
    return {
      id: 'pack-server-seam-harness',
      placement: 'server',
      sessions,
      async getPiSessionAdapter(sendInput, ctx) {
        const key = sendInput.sessionId
        if (!adapters.has(key)) adapters.set(key, new Adapter(input, key, ctx))
        return adapters.get(key)
      },
      async reloadSession() { return true },
    }
  }
}
const direct = resolveMode('direct')
const runtimeModeAdapter = {
  ...direct,
  id: 'direct',
  async create(ctx) {
    const previous = readCapture().runtime ?? {}
    record({ runtime: { ...previous, create: (previous.create ?? 0) + 1, mode: this.id } })
    return await direct.create(ctx)
  },
  async dispose() {
    const previous = readCapture().runtime ?? {}
    record({ runtime: { ...previous, dispose: (previous.dispose ?? 0) + 1, mode: this.id } })
    await direct.dispose?.()
  },
}
const trustedToolCatalogAdapter = {
  async resolveToolCatalog(input) {
    record({ catalogRequest: input })
    assert.deepEqual(input.declaredToolRefs, ['claims.lookup'])
    return new Map([['claims.lookup', {
      name: 'claims_lookup',
      description: 'Trusted packed seam claims lookup',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute(params, ctx) {
        record({ toolParams: params, toolCtx: { sessionId: ctx.sessionId, workspaceId: ctx.workspaceId } })
        return { content: [{ type: 'text', text: 'PACK_TOOL_SECRET_RESULT' }] }
      },
    }]])
  },
}
await runCli({
  argv: ['agent', 'dev', ${JSON.stringify(exampleDir)}, '--prompt', 'PACK_USER_SECRET_PROMPT', '--allow-direct'],
  publicDir: ${JSON.stringify(serverSeamPublicDir)},
  agentDev: { trustedToolCatalogAdapter, harnessFactory: createHarnessFactory(), runtimeModeAdapter, provisionWorkspace: false },
})
const capture = readCapture()
assert.equal(capture.promptText, 'PACK_USER_SECRET_PROMPT')
assert.equal(capture.toolInvoked, true)
assert.equal(capture.toolName, 'claims_lookup')
assert.equal(capture.toolResult, 'PACK_TOOL_SECRET_RESULT')
assert.deepEqual(capture.toolParams, { from: 'pack-server-seam' })
assert.deepEqual(capture.catalogRequest.declaredToolRefs, ['claims.lookup'])
assert.match(capture.factoryInput.systemPromptAppend, /authored claims assistant example/)
assert.ok(capture.factoryInput.tools.includes('claims_lookup'))
assert.deepEqual(capture.runtime, { create: 1, dispose: 1, mode: 'direct' })
console.log('supported CLI server seam tool-bearing one-shot ok')
`
    selfProofForbiddenOutputScanner()
    const serverSeamProbePath = join(consumerDir, 'server-seam-probe.mjs')
    const serverSeamWorkspacesPath = join(workRoot, 'server-seam-workspaces.yaml')
    writeFileSync(serverSeamProbePath, serverSeamProbe)
    const serverSeamResult = spawnCaptured(process.execPath, [serverSeamProbePath], {
      cwd: consumerDir,
      env: {
        BORING_AGENT_WORKSPACE_ROOT: serverSeamWorkspaceRoot,
        BORING_UI_WORKSPACES_PATH: serverSeamWorkspacesPath,
      },
    })
    assertNoForbiddenOutput('supported CLI server seam one-shot', serverSeamResult, [
      'PACK_USER_SECRET_PROMPT',
      'authored claims assistant example',
      'PACK_TOOL_SECRET_RESULT',
      'SECRET',
      workRoot,
      consumerDir,
      exampleDir,
      serverSeamPublicDir,
      serverSeamWorkspaceRoot,
      serverSeamCaptureFile,
      serverSeamProbePath,
      serverSeamWorkspacesPath,
      tempBase,
      repoRoot,
      'A1 conformance failure: authored executable modules must never be imported',
      'not-imported.mjs',
      'tools/not-imported',
    ])
    if (serverSeamResult.status !== 0) {
      throw new Error(`supported server seam one-shot failed with status ${serverSeamResult.status ?? 'null'}${serverSeamResult.signal ? ` signal ${serverSeamResult.signal}` : ''}`)
    }
    const serverSeamCombinedOutput = `${serverSeamResult.stdout}\n${serverSeamResult.stderr}`
    if (!serverSeamCombinedOutput.includes('supported CLI server seam tool-bearing one-shot ok')) {
      throw new Error('supported server seam one-shot did not report success')
    }
    console.log('supported CLI server seam one-shot ok; stdout/stderr leakage scan ok')
  } catch (error) {
    if (setupFailureSelfTest && error instanceof Error && error.message === 'intentional setup failure self-test') {
      console.log('A1 pack smoke setup-failure self-test reached cleanup path.')
    } else {
      throw error
    }
  } finally {
    if (retainDebug) {
      console.log(`A1 pack smoke retained generated workspace: ${workRoot}`)
    } else {
      assertSafeGeneratedWorkRoot(workRoot)
      await rm(workRoot, { recursive: true, force: true })
      if (existsSync(workRoot)) throw new Error(`A1 pack smoke cleanup failed: ${workRoot}`)
      console.log(`A1 pack smoke removed generated workspace: ${workRoot}`)
    }
  }

  if (setupFailureSelfTest) {
    if (existsSync(workRoot)) throw new Error(`A1 pack smoke setup-failure self-test leaked work root: ${workRoot}`)
    console.log(`A1 pack smoke setup-failure self-test proved root removed: ${workRoot}`)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`)
}

await main()
