import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  DisposableSandboxProviderV1,
  SandboxProviderCreateContextV1,
  WorkspaceSandboxPairV1,
} from '@hachej/boring-sandbox/shared'

const execFileAsync = promisify(execFile)

type SandboxHandle = WorkspaceSandboxPairV1['sandbox']
type SandboxExecFn = SandboxHandle['exec']
type SandboxExecOptions = Parameters<SandboxExecFn>[1]
type SandboxExecResult = Awaited<ReturnType<SandboxExecFn>>

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export type ExactShaTemplateSource = 'archive' | 'fetch'

export interface ExactShaTemplateProviderOptions {
  /** Underlying disposable provider whose `create` receives a `templatePath` pointing at the exported tree. */
  inner: DisposableSandboxProviderV1
  /** Git working tree whose tracked, committed HEAD is exported for every sandbox creation. */
  sourceRoot: string
  /** Scratch directory under which one randomly-named export is created and removed per `create` call. */
  scratchRoot: string
  /**
   * `'archive'` uploads/seeds the full tracked tree (`git archive`), which
   * can take minutes for a large repo when the fast tarball-upload path is
   * unavailable. `'fetch'` seeds only four tiny marker/bootstrap files and
   * has the sandbox `git fetch` the exact SHA from `origin` itself on first
   * use — seconds, but only works when that SHA has been pushed and is
   * reachable on a public (or sandbox-credentialed) origin.
   *
   * Default: `'fetch'` when `sourceRoot` has a resolvable `origin` remote,
   * else `'archive'`.
   */
  source?: ExactShaTemplateSource
}

/**
 * Bootstrap script written into the sandbox in `'fetch'` mode. Reads the
 * exact SHA and origin URL from the sibling marker files this provider also
 * writes, initializes a git repo in place if needed, fetches that one commit
 * (shallow first, falling back to a full fetch if the remote/host doesn't
 * support shallow fetch of an arbitrary SHA), and verifies the checkout
 * landed on the exact SHA.
 */
export const FACTORY_BOOTSTRAP_SCRIPT = [
  'set -e',
  'sha=$(cat .factory-sha)',
  'remote=$(cat .factory-remote)',
  'if [ ! -d .git ]; then git init -q .; git remote add origin "$remote"; fi',
  'git fetch -q --depth 1 origin "$sha" || git fetch -q origin "$sha"',
  'git checkout -q --detach FETCH_HEAD',
  'test "$(git rev-parse HEAD)" = "$sha"',
  'echo "factory-bootstrap ok $sha"',
].join('; ') + '\n'

/** Best-effort current branch name of `sourceRoot`; `undefined` when not resolvable (detached HEAD, not a git repo). */
async function resolveBranchBestEffort(sourceRoot: string): Promise<string | undefined> {
  try {
    const branch = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: sourceRoot })
    ).stdout.trim()
    return branch || undefined
  } catch {
    return undefined
  }
}

/** Strip embedded credentials and normalize SSH remotes to plain https. */
function normalizeRemoteUrl(rawUrl: string): string {
  const url = rawUrl.trim()
  const scpLike = /^(?:[\w.-]+@)?([\w.-]+):(.+)$/.exec(url)
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && scpLike) {
    const [, host, path] = scpLike
    return `https://${host}/${path.replace(/^\/+/, '')}`
  }
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    if (parsed.protocol === 'ssh:' || parsed.protocol === 'git:') {
      return `https://${parsed.host}${parsed.pathname}`
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export interface FetchBootstrapFile {
  readonly path: string
  readonly content: string
}

/**
 * Builds the marker/bootstrap file set for `'fetch'`-mode template seeding:
 * `.factory-sha`, `.factory-branch`, `.factory-remote` (origin URL, stripped
 * of embedded credentials and normalized to plain https), and
 * `factory-bootstrap.sh`. Shared by `createExactShaTemplateProvider`'s own
 * `'fetch'` export path and by any other caller (e.g. `demoPlugin`) that
 * seeds a sandbox with the same exact-SHA-fetch bootstrap.
 */
export async function buildFetchBootstrapFiles(sourceRoot: string, sha: string): Promise<FetchBootstrapFile[]> {
  const rawRemote = (await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: sourceRoot })).stdout.trim()
  const remote = normalizeRemoteUrl(rawRemote)
  const branch = (await resolveBranchBestEffort(sourceRoot)) ?? 'HEAD'
  return [
    { path: '.factory-sha', content: sha },
    { path: '.factory-branch', content: branch },
    { path: '.factory-remote', content: remote },
    { path: 'factory-bootstrap.sh', content: FACTORY_BOOTSTRAP_SCRIPT },
  ]
}

/** Single shell invocation: skip if already bootstrapped, else run + mark done. */
const FACTORY_BOOTSTRAP_GUARDED_COMMAND = [
  'if [ -f .factory-bootstrapped ]; then',
  '  echo "factory-bootstrap already done"',
  'else',
  '  sh factory-bootstrap.sh && touch .factory-bootstrapped',
  'fi',
].join('\n')

function decodeMaybe(value: Uint8Array | string | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
}

/**
 * Wraps a sandbox handle so its first `exec()` call runs the guarded
 * `factory-bootstrap.sh` invocation before the caller's own command. Only
 * one bootstrap attempt is made per wrapped handle (matching "the FIRST exec
 * on it"); if that attempt fails, every exec on this handle short-circuits
 * with a clear, non-zero-exit result instead of ever reaching the sandbox
 * again with the caller's command.
 */
function wrapExecWithFetchBootstrap(sandbox: SandboxHandle, sha: string): SandboxHandle {
  let bootstrap: Promise<SandboxExecResult> | undefined

  function ensureBootstrapped(): Promise<SandboxExecResult> {
    if (!bootstrap) {
      bootstrap = sandbox.exec(FACTORY_BOOTSTRAP_GUARDED_COMMAND)
    }
    return bootstrap
  }

  function bootstrapFailureResult(result: SandboxExecResult): SandboxExecResult {
    const failureLine = `factory-bootstrap failed: push the epic branch so ${sha} is reachable on origin`
    const stderr = `${decodeMaybe(result.stderr)}\n${failureLine}\n`
    return {
      ...result,
      exitCode: result.exitCode !== 0 ? result.exitCode : 1,
      stderr: new TextEncoder().encode(stderr),
      stderrEncoding: 'utf-8',
    }
  }

  return {
    ...sandbox,
    async exec(cmd: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
      const bootstrapResult = await ensureBootstrapped()
      if (bootstrapResult.exitCode !== 0) {
        return bootstrapFailureResult(bootstrapResult)
      }
      return await sandbox.exec(cmd, opts)
    },
  }
}

/**
 * Wraps a disposable sandbox provider so every `create` first exports the
 * exact tracked tree at `sourceRoot`'s committed HEAD into a fresh directory
 * under `scratchRoot` and passes it to `inner.create` as `templatePath`.
 *
 * Two source modes (see `ExactShaTemplateProviderOptions.source`):
 *
 * - `'archive'`: the export is a full `git archive <sha> | tar -x` of the
 *   tracked tree (no `.git`, no untracked files such as `node_modules`),
 *   plus `.factory-sha` (and `.factory-branch` when resolvable). Correct
 *   for any repo, but uploading/seeding the whole tree into the sandbox can
 *   take minutes at real repo sizes when the provider's fast tarball-upload
 *   path is unavailable.
 * - `'fetch'`: the export contains only `.factory-sha`, `.factory-branch`,
 *   `.factory-remote` (the origin URL, rewritten to plain https with no
 *   embedded credentials), and `factory-bootstrap.sh`. The sandbox pair's
 *   first `exec()` call runs that script (via a `.factory-bootstrapped`
 *   idempotency guard) to `git fetch --depth 1` the exact SHA from origin
 *   before running the caller's command — seconds instead of minutes, but
 *   only works when that SHA is reachable on origin.
 *
 * If `inner.create` rejects, the export is removed immediately. If it
 * resolves, the export is kept until the returned pair is `dispose`d rather
 * than removed right away: disposable providers (verified live against
 * `createVercelSandboxProvider`) can defer template packaging/seeding to a
 * background readiness promise that is only awaited by the pair's first
 * `checkHealth()`/exec call, which happens after `create()` returns. Deleting
 * the export on `create()` resolution races that background read. Either
 * way, the export never survives past the pair's lifetime, so it never
 * accumulates on the local machine — only the remote provider retains the
 * tree beyond that.
 */
export function createExactShaTemplateProvider(
  options: ExactShaTemplateProviderOptions,
): DisposableSandboxProviderV1 {
  const { inner, sourceRoot, scratchRoot } = options

  async function gitRevParseHead(): Promise<string> {
    return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).stdout.trim()
  }

  async function resolveSource(): Promise<ExactShaTemplateSource> {
    if (options.source) return options.source
    try {
      const url = (await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: sourceRoot })).stdout.trim()
      return url ? 'fetch' : 'archive'
    } catch {
      return 'archive'
    }
  }

  async function exportArchiveTemplate(): Promise<{ exportPath: string; sha: string }> {
    const sha = await gitRevParseHead()
    const exportPath = resolve(scratchRoot, randomUUID())
    await mkdir(exportPath, { recursive: true })
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const archive = spawn('git', ['archive', sha], { cwd: sourceRoot, stdio: ['ignore', 'pipe', 'pipe'] })
        const extract = spawn('tar', ['-x', '-C', exportPath], { stdio: ['pipe', 'ignore', 'pipe'] })
        let archiveStderr = ''
        let extractStderr = ''
        let settled = false
        const fail = (error: Error) => {
          if (settled) return
          settled = true
          reject(error)
        }
        archive.stderr.on('data', (chunk: Buffer) => { archiveStderr += chunk.toString('utf8') })
        extract.stderr.on('data', (chunk: Buffer) => { extractStderr += chunk.toString('utf8') })
        archive.on('error', fail)
        extract.on('error', fail)
        archive.stdout.pipe(extract.stdin)
        archive.on('exit', (code) => {
          if (code !== 0 && code !== null) fail(new Error(`git archive failed (${code}): ${archiveStderr}`))
        })
        extract.on('exit', (code) => {
          if (settled) return
          if (code === 0) {
            settled = true
            resolvePromise()
          } else {
            fail(new Error(`tar extraction failed (${code}): ${extractStderr}`))
          }
        })
      })
      await writeFile(resolve(exportPath, '.factory-sha'), sha)
      const branch = await resolveBranchBestEffort(sourceRoot)
      if (branch) await writeFile(resolve(exportPath, '.factory-branch'), branch)
    } catch (error) {
      await rm(exportPath, { recursive: true, force: true })
      throw error
    }
    return { exportPath, sha }
  }

  async function exportFetchTemplate(): Promise<{ exportPath: string; sha: string }> {
    const sha = await gitRevParseHead()
    const exportPath = resolve(scratchRoot, randomUUID())
    await mkdir(exportPath, { recursive: true })
    try {
      const files = await buildFetchBootstrapFiles(sourceRoot, sha)
      await Promise.all(files.map((file) => writeFile(resolve(exportPath, file.path), file.content)))
    } catch (error) {
      await rm(exportPath, { recursive: true, force: true })
      throw error
    }
    return { exportPath, sha }
  }

  return {
    ...inner,
    async create(context: SandboxProviderCreateContextV1) {
      const source = await resolveSource()
      const { exportPath, sha } = source === 'fetch'
        ? await exportFetchTemplate()
        : await exportArchiveTemplate()
      let pair
      try {
        pair = await inner.create({ ...context, templatePath: exportPath })
      } catch (error) {
        // inner.create rejected before accepting responsibility for the
        // export: nothing else will ever read it, so remove it now.
        await rm(exportPath, { recursive: true, force: true })
        throw error
      }
      // inner.create() resolving does NOT mean the export has been fully
      // consumed: disposable providers (observed live against
      // createVercelSandboxProvider) defer template packaging/seeding to a
      // background readiness promise that is only awaited by the pair's
      // first `checkHealth()`/exec call, which can happen well after
      // `create()` returns. Removing the export directory here raced that
      // background read and produced ENOENT during template seeding. The
      // export is only safe to remove once the pair itself is disposed.
      let exportRemoved = false
      const removeExport = async () => {
        if (exportRemoved) return
        exportRemoved = true
        await rm(exportPath, { recursive: true, force: true })
      }
      return {
        ...pair,
        sandbox: source === 'fetch' ? wrapExecWithFetchBootstrap(pair.sandbox, sha) : pair.sandbox,
        async dispose() {
          try {
            await pair.dispose()
          } finally {
            await removeExport()
          }
        },
      }
    },
    disposableProfile: {
      ...inner.disposableProfile,
      providerConfigDigest: digest(
        `exact-sha-template:${inner.disposableProfile.providerConfigDigest}:${sourceRoot}`,
      ),
    },
  }
}
