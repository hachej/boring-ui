import { execFile, execFileSync, spawn } from 'node:child_process'
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
  /**
   * Optional git access token used to authenticate the sandbox's own `git
   * fetch` of `sourceRoot`'s origin in `'fetch'` mode (private repos). Passed
   * to the sandbox only as an exec-scoped env var, never written to a file
   * or embedded in a script's literal text. Ignored in `'archive'` mode
   * (nothing is fetched by the sandbox there).
   */
  gitToken?: string
}

/**
 * Fixed path a warm snapshot (built by `scripts/vercel-snapshot.mts`) clones
 * the monorepo into. Chosen instead of `VERCEL_SANDBOX_WORKSPACE_ROOT`
 * (`/workspace`) because the warm snapshot is baked with the raw
 * `@vercel/sandbox` SDK (`Sandbox.create()` + `runCommand()`), whose default
 * cwd/homeDir is `/vercel/sandbox` — the same default `demoPlugin` uses for
 * its own (unwrapped) sandbox handle. Keeping the warm clone at a location
 * both the raw SDK default and `createVercelSandboxExec`'s `/workspace`
 * default can reach (the bootstrap script symlinks `/workspace` to this path
 * once warm) means one bootstrap script serves both call sites.
 */
export const FACTORY_WARM_REPO_ROOT = '/vercel/sandbox/repo'

/**
 * Corepack's cache location, pinned outside the warm repo (so git operations
 * on it never see or touch this directory). Verified live: without pinning
 * this, a lease sandbox booted from the warm snapshot re-triggered corepack's
 * network fetch of pnpm on its very first invocation, even though the seed
 * sandbox had already `corepack prepare --activate`d the same version —
 * corepack's default cache location isn't part of what survives from seed to
 * lease. Both `scripts/vercel-snapshot.mts` (at bake time) and the warm
 * branch of `FACTORY_BOOTSTRAP_SCRIPT` (at lease time) point `COREPACK_HOME`
 * here, so the cache baked into the snapshot is reused offline.
 */
export const FACTORY_COREPACK_HOME = '/vercel/sandbox/.corepack-home'

/** Bootstrap step's exec timeout: warm install/build can take minutes, far past the 30s exec default. */
export const FACTORY_BOOTSTRAP_TIMEOUT_MS = 15 * 60 * 1000

/**
 * Env var name a bootstrap/seed shell script reads an optional git access
 * token from. Never interpolated into a script's literal text (which would
 * leak it into `ps` output inside the sandbox); scripts reference it only as
 * a shell variable expansion, and callers pass the value via `exec`'s `env`
 * option, never via `cwd`-relative files or command-line args.
 */
export const FACTORY_GIT_TOKEN_ENV_VAR = 'FACTORY_GIT_TOKEN'

/**
 * Shell fragment computing a git Basic-auth header from `$FACTORY_GIT_TOKEN`
 * (GitHub App / PAT convention: username `x-access-token`, password the
 * token). Assign to a variable and pass to git via `-c
 * http.extraheader="$var"` — never write the token to a file or echo it.
 */
export function gitAuthHeaderShellExpr(): string {
  return `AUTHORIZATION: basic $(printf '%s' "x-access-token:$${FACTORY_GIT_TOKEN_ENV_VAR}" | base64 | tr -d '\\n')`
}

/**
 * Shell lines defining a `git_fetch` function: when `$FACTORY_GIT_TOKEN` is
 * set, every invocation carries a per-call `http.extraheader` Basic-auth
 * header (never written to git config, never echoed); otherwise it's a
 * plain `git fetch`. Callers use `git_fetch <args...>` wherever the original
 * script called `git fetch` directly.
 */
export function gitFetchAuthShellSetup(): string {
  return [
    `if [ -n "\${${FACTORY_GIT_TOKEN_ENV_VAR}:-}" ]; then`,
    `  factory_auth_header="${gitAuthHeaderShellExpr()}"`,
    '  git_fetch() { git -c http.extraheader="$factory_auth_header" fetch "$@"; }',
    'else',
    '  git_fetch() { git fetch "$@"; }',
    'fi',
  ].join('\n')
}

/**
 * Resolves the git token used to authenticate clones/fetches against a
 * private origin in the Vercel sandbox path: `BORING_FACTORY_GIT_TOKEN` when
 * set, else the output of `gh auth token` when the `gh` CLI is available and
 * authenticated. Returns `undefined` (not an error) when neither is
 * available — callers fall back to unauthenticated git, which still works
 * for public repos. Never logs the resolved value.
 */
export function resolveFactoryGitToken(
  env: NodeJS.ProcessEnv,
  ghAuthToken: () => string | undefined = () => {
    try {
      return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() || undefined
    } catch {
      return undefined
    }
  },
): string | undefined {
  const fromEnv = env.BORING_FACTORY_GIT_TOKEN?.trim()
  if (fromEnv) return fromEnv
  return ghAuthToken()
}

/**
 * Bootstrap script written into the sandbox in `'fetch'` mode. Reads the
 * exact SHA and origin URL from the sibling marker files this provider also
 * writes, then takes one of two paths:
 *
 * - **Warm** (`FACTORY_WARM_REPO_ROOT/.factory-snapshot.json` exists — the
 *   base snapshot was built by `scripts/vercel-snapshot.mts` in its default,
 *   non-`--bare` mode): `cd` into the already-cloned, already-built repo,
 *   `git fetch`/`checkout --detach` the exact SHA, reinstall only if
 *   `pnpm-lock.yaml`'s hash moved since the snapshot was baked, then rebuild
 *   only the packages that changed since the snapshot's `baseSha` via pnpm's
 *   changed-since filter. Finally, since `createVercelSandboxExec` always
 *   runs later commands with cwd `/workspace`, `/workspace` is replaced with
 *   a symlink to the warm repo so the caller's own exec (e.g. `pnpm --filter
 *   factory-playground test`) finds it without needing to know the warm
 *   path.
 * - **Cold** (no warm snapshot; the original, still-default path): git-init
 *   in place if needed, fetch that one commit (shallow first, falling back
 *   to a full fetch if the remote/host doesn't support shallow fetch of an
 *   arbitrary SHA), and verify the checkout landed on the exact SHA. No
 *   install/build — callers install/build themselves.
 *
 * Both paths end by verifying `git rev-parse HEAD` matches the requested SHA.
 *
 * `warmRepoRoot`/`workspaceRoot` default to the real, hardcoded production
 * paths (`FACTORY_WARM_REPO_ROOT` / `/workspace`); tests override both to
 * point at temp directories so the real script can be exercised end to end
 * against a fake `sh`-executed sandbox without touching `/vercel` or
 * `/workspace`.
 */
export function buildFactoryBootstrapScript(
  warmRepoRoot: string = FACTORY_WARM_REPO_ROOT,
  workspaceRoot = '/workspace',
): string {
  return [
  'set -e',
  'sha=$(cat .factory-sha)',
  'remote=$(cat .factory-remote)',
  `warm_root=${warmRepoRoot}`,
  `workspace_root=${workspaceRoot}`,
  'phase_start=$(date +%s%N)',
  'phase() {',
  '  now=$(date +%s%N)',
  '  echo "factory-bootstrap-phase $1 $(( (now - phase_start) / 1000000 ))ms"',
  '  phase_start=$now',
  '}',
  gitFetchAuthShellSetup(),
  'if [ -f "$warm_root/.factory-snapshot.json" ]; then',
  '  cd "$warm_root"',
  `  export COREPACK_HOME=${FACTORY_COREPACK_HOME}`,
  '  git_fetch -q origin "$sha"',
  '  git checkout -q --detach FETCH_HEAD',
  '  test "$(git rev-parse HEAD)" = "$sha"',
  '  phase fetch',
  '  base_sha=$(node -e "process.stdout.write(require(\'./.factory-snapshot.json\').baseSha)")',
  '  expected_lock=$(node -e "process.stdout.write(require(\'./.factory-snapshot.json\').lockfileSha256)")',
  '  current_lock="sha256:$(sha256sum pnpm-lock.yaml | cut -d\' \' -f1)"',
  '  if [ "$current_lock" != "$expected_lock" ]; then',
  // CI=1: a lockfile diff that adds/removes deps makes pnpm want to purge
  // node_modules, which it refuses to do non-interactively without this —
  // verified live as `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` otherwise.
  // The final `--no-frozen-lockfile` fallback covers a branch whose
  // `pnpm-lock.yaml` has genuinely drifted from `package.json` (verified
  // live against a real epic branch with an uncommitted-lockfile-update
  // bug) — installing what package.json actually asks for beats refusing
  // to test the SHA at all; `--frozen-lockfile` is still tried first so the
  // common case (an honestly updated lockfile) never silently skips
  // verification.
  '    CI=1 pnpm install --frozen-lockfile --offline \\',
  '      || CI=1 pnpm install --frozen-lockfile \\',
  '      || CI=1 pnpm install --no-frozen-lockfile',
  '    phase install',
  '  else',
  '    phase install-skipped',
  '  fi',
  // Bootstrap safety cap: a warm snapshot whose baseSha has drifted far from
  // the epic branch's HEAD (e.g. it was taken from `main` while the epic
  // diverges across most packages) makes this changed-since selector match
  // nearly the whole monorepo — verified live as a rebuild that blows past
  // the lease's timeout. Count the matched packages before ever starting a
  // build; if it exceeds `BORING_FACTORY_MAX_INCREMENTAL_PACKAGES` (default
  // 12), fail fast with a clear, greppable message instead of rebuilding
  // serially. The host-side provider wrapper (`sandboxComposition.ts`)
  // recognizes this exact failure, refreshes the epic's snapshot from HEAD,
  // and retries the lease once.
  '  changed_count=$(pnpm -r --filter "...[$base_sha]" --filter \'!.\' exec pwd 2>/dev/null | wc -l | tr -d \' \')',
  '  max_packages=${BORING_FACTORY_MAX_INCREMENTAL_PACKAGES:-12}',
  '  if [ "$changed_count" -gt "$max_packages" ]; then',
  '    echo "factory-bootstrap: $changed_count packages changed since $base_sha; refresh the epic snapshot" >&2',
  '    exit 1',
  '  fi',
  '  phase changed-count',
  // `--filter '!.'` excludes the root workspace package: without it, a diff
  // that touches root-level files (pnpm-lock.yaml, root package.json) makes
  // the changed-since selector match the root package too, which recursively
  // re-invokes the *root's own* `"build": "pnpm -r --workspace-concurrency=4
  // run build"` script — verified live as an accidental full-monorepo
  // rebuild instead of the intended incremental one. `--workspace-concurrency=2`
  // matches the seed snapshot build for the same OOM-avoidance reason.
  // NODE_OPTIONS: verified live that a disposable lease sandbox (default
  // resources, no `resources.vcpus` bump — only the seed/snapshot-bake
  // sandbox gets one) OOMs on `packages/agent`'s tsup DTS worker at the
  // Node default heap size; raising it here fixes leases exactly the way
  // `scripts/vercel-snapshot.mts` fixes the seed sandbox's own build. Verified
  // live this alone is not enough: a default-resource lease (no `resources.vcpus`
  // bump available on the disposable path today) can still OOM specifically on
  // `packages/agent`'s tsup DTS worker even at --max-old-space-size=6144 with
  // concurrency 1 — the seed sandbox's fix worked because it also had more
  // actual machine memory (`resources: { vcpus: 4 }`), not just a bigger heap
  // flag. Retry once excluding `@hachej/boring-agent` as a documented,
  // degraded fallback (its dist stays at the snapshot's baseSha rather than
  // the lease's exact SHA) rather than failing every lease whose diff happens
  // to touch it; a real fix is a `resources`/`vcpus` passthrough on
  // `createVercelSandboxProviderOptions` (tracked as a follow-up, out of
  // scope here — that is a different package's public API).
  '  NODE_OPTIONS=--max-old-space-size=6144 pnpm -r --filter "...[$base_sha]" --filter \'!.\' --workspace-concurrency=1 build \\',
  '    || { echo "factory-bootstrap: incremental build failed (likely OOM on a memory-heavy package under default lease resources); retrying excluding @hachej/boring-agent" >&2; \\',
  '         NODE_OPTIONS=--max-old-space-size=6144 pnpm -r --filter "...[$base_sha]" --filter \'!.\' --filter \'!@hachej/boring-agent\' --workspace-concurrency=1 build; }',
  '  phase build',
  '  echo "$sha" > .factory-sha',
  '  echo "$remote" > .factory-remote',
  '  if [ -e "$workspace_root" ] || [ -L "$workspace_root" ]; then rm -rf "$workspace_root"; fi',
  '  ln -sfn "$warm_root" "$workspace_root"',
  '  echo "factory-bootstrap ok $sha (warm)"',
  'else',
  '  if [ ! -d .git ]; then git init -q .; git remote add origin "$remote"; fi',
  '  git_fetch -q --depth 1 origin "$sha" || git_fetch -q origin "$sha"',
  '  git checkout -q --detach FETCH_HEAD',
  '  test "$(git rev-parse HEAD)" = "$sha"',
  '  phase fetch',
  '  echo "factory-bootstrap ok $sha"',
  'fi',
  ].join('\n') + '\n'
}

/** Production bootstrap script (real `FACTORY_WARM_REPO_ROOT` / `/workspace`); this is what's written into every sandbox's `factory-bootstrap.sh`. */
export const FACTORY_BOOTSTRAP_SCRIPT = buildFactoryBootstrapScript()

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

/**
 * Single shell invocation: skip if already bootstrapped, else run + mark
 * done. Verified live: on the warm path, `factory-bootstrap.sh` `rm -rf`s
 * `/workspace` and replaces it with a symlink to the warm repo — but this
 * guarded command's own shell process was started with cwd `/workspace`
 * (`createVercelSandboxExec`'s default), so removing that directory out from
 * under a running process leaves its cwd pointing at nothing: a later
 * relative `touch .factory-bootstrapped` in the *same* shell then fails with
 * `ENOENT` even though `/workspace` now resolves fine again for any *new*
 * process. `cd /` re-anchors this shell to a path that was never touched,
 * and the trailing marker touch uses `/workspace/...` (absolute) rather than
 * relying on a cwd that may have just been swapped out.
 */
const FACTORY_BOOTSTRAP_GUARDED_COMMAND = [
  'if [ -f /workspace/.factory-bootstrapped ]; then',
  '  echo "factory-bootstrap already done"',
  'else',
  '  sh factory-bootstrap.sh && cd / && touch /workspace/.factory-bootstrapped',
  'fi',
].join('\n')

function decodeMaybe(value: Uint8Array | string | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
}

/**
 * Decoded stdout of the guarded bootstrap invocation (including the
 * `factory-bootstrap-phase <name> <ms>ms` lines `FACTORY_BOOTSTRAP_SCRIPT`
 * emits), keyed by the wrapped sandbox handle it ran on. Bootstrap output is
 * otherwise swallowed — the wrapper's `exec()` only returns the caller's own
 * command result — so callers that want a phase breakdown (e.g.
 * `vercel-lease-smoke.mts`) read it here after their first `exec()` call
 * resolves.
 */
const bootstrapLogs = new WeakMap<SandboxHandle, string>()

/** Reads back the bootstrap phase log recorded for a handle returned by `wrapExecWithFetchBootstrap`. `undefined` before bootstrap has run (or for a handle never wrapped). */
export function getFactoryBootstrapLog(sandbox: SandboxHandle): string | undefined {
  return bootstrapLogs.get(sandbox)
}

/** Matches the bootstrap script's `changed_count` guard failure line (`buildFactoryBootstrapScript`). A provider wrapper that sees this in a failed bootstrap's stdout/stderr should refresh the epic's warm snapshot and retry once, rather than treat it as an ordinary lease failure. */
const BOOTSTRAP_REFRESH_NEEDED_RE = /factory-bootstrap: \d+ packages changed since \S+; refresh the epic snapshot/

/** `true` when `output` (stdout+stderr of a failed bootstrap) is the "too many packages changed since baseSha" guard failure — i.e. the epic snapshot should be refreshed and the lease retried, rather than treated as an ordinary failure. */
export function isBootstrapRefreshNeeded(output: string): boolean {
  return BOOTSTRAP_REFRESH_NEEDED_RE.test(output)
}

/**
 * Wraps a sandbox handle so its first `exec()` call runs the guarded
 * `factory-bootstrap.sh` invocation before the caller's own command. Only
 * one bootstrap attempt is made per wrapped handle (matching "the FIRST exec
 * on it"); if that attempt fails, every exec on this handle short-circuits
 * with a clear, non-zero-exit result instead of ever reaching the sandbox
 * again with the caller's command.
 */
function wrapExecWithFetchBootstrap(sandbox: SandboxHandle, sha: string, gitToken?: string): SandboxHandle {
  let bootstrap: Promise<SandboxExecResult> | undefined

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

  const wrapped: SandboxHandle = {
    ...sandbox,
    async exec(cmd: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
      const bootstrapResult = await ensureBootstrapped()
      if (bootstrapResult.exitCode !== 0) {
        return bootstrapFailureResult(bootstrapResult)
      }
      return await sandbox.exec(cmd, opts)
    },
  }

  function ensureBootstrapped(): Promise<SandboxExecResult> {
    if (!bootstrap) {
      bootstrap = sandbox
        .exec(FACTORY_BOOTSTRAP_GUARDED_COMMAND, {
          timeoutMs: FACTORY_BOOTSTRAP_TIMEOUT_MS,
          ...(gitToken ? { env: { [FACTORY_GIT_TOKEN_ENV_VAR]: gitToken } } : {}),
        } as SandboxExecOptions)
        .then((result: SandboxExecResult) => {
          bootstrapLogs.set(wrapped, `${decodeMaybe(result.stdout)}\n${decodeMaybe(result.stderr)}`)
          return result
        })
    }
    return bootstrap
  }

  return wrapped
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
        sandbox: source === 'fetch' ? wrapExecWithFetchBootstrap(pair.sandbox, sha, options.gitToken) : pair.sandbox,
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
