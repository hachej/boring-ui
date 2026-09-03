import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { DisposableSandboxProviderV1, SandboxProviderCreateContextV1 } from '@hachej/boring-sandbox/shared'

const execFileAsync = promisify(execFile)

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export interface ExactShaTemplateProviderOptions {
  /** Underlying disposable provider whose `create` receives a `templatePath` pointing at the exported tree. */
  inner: DisposableSandboxProviderV1
  /** Git working tree whose tracked, committed HEAD is exported for every sandbox creation. */
  sourceRoot: string
  /** Scratch directory under which one randomly-named export is created and removed per `create` call. */
  scratchRoot: string
}

/**
 * Wraps a disposable sandbox provider so every `create` first exports the exact
 * tracked tree at `sourceRoot`'s committed HEAD (via `git archive`, no `.git`,
 * no untracked files such as `node_modules`) into a fresh directory under
 * `scratchRoot`, writes `.factory-sha` (and `.factory-branch` when resolvable)
 * into that export, and passes it to `inner.create` as `templatePath`.
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

  async function exportExactShaTree(): Promise<{ exportPath: string; sha: string }> {
    const sha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).stdout.trim()
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
      try {
        const branch = (
          await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: sourceRoot })
        ).stdout.trim()
        if (branch) await writeFile(resolve(exportPath, '.factory-branch'), branch)
      } catch {
        // Detached HEAD or an unresolvable branch name: `.factory-branch` is best-effort only.
      }
    } catch (error) {
      await rm(exportPath, { recursive: true, force: true })
      throw error
    }
    return { exportPath, sha }
  }

  return {
    ...inner,
    async create(context: SandboxProviderCreateContextV1) {
      const { exportPath } = await exportExactShaTree()
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
