import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { Writable } from 'node:stream'

import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

const VERCEL_SANDBOX_ROOT = '/workspace'
const VERCEL_LEGACY_SANDBOX_ROOT = '/vercel/sandbox'

interface WriteInput {
  path: string
  content: Buffer | Uint8Array | string
}

export interface MockVercelSandboxHarness {
  sandbox: VercelSandbox
  cleanup(): Promise<void>
  hostRoot: string
  lastWriteFiles: Array<{ path: string; content: Uint8Array }>
}

function toSandboxAbsolutePath(pathInput: string): string {
  if (pathInput.startsWith('/')) {
    return pathInput
  }
  return `${VERCEL_SANDBOX_ROOT}/${pathInput}`
}

function toHostPath(hostRoot: string, sandboxPath: string): string {
  const absoluteSandboxPath = toSandboxAbsolutePath(sandboxPath)
  const canonicalPath = absoluteSandboxPath === VERCEL_LEGACY_SANDBOX_ROOT
    ? VERCEL_SANDBOX_ROOT
    : absoluteSandboxPath.startsWith(`${VERCEL_LEGACY_SANDBOX_ROOT}/`)
      ? `${VERCEL_SANDBOX_ROOT}${absoluteSandboxPath.slice(VERCEL_LEGACY_SANDBOX_ROOT.length)}`
      : absoluteSandboxPath
  const relPath = relative(VERCEL_SANDBOX_ROOT, canonicalPath)
  if (relPath === '') return hostRoot
  if (relPath === '..' || relPath.startsWith('../')) {
    throw new Error(`Sandbox path escaped root: ${sandboxPath}`)
  }
  return join(hostRoot, relPath)
}

export async function createMockVercelSandboxHarness(): Promise<MockVercelSandboxHarness> {
  const hostRoot = await mkdtemp(join(tmpdir(), 'boring-ui-vercel-sandbox-mock-'))
  const lastWriteFiles: Array<{ path: string; content: Uint8Array }> = []

  const sandbox = {
    fs: {
      async readFile(pathInput: string, encoding?: BufferEncoding) {
        const hostPath = toHostPath(hostRoot, pathInput)
        if (encoding) {
          return await readFile(hostPath, encoding)
        }
        return await readFile(hostPath)
      },
      async readdir(pathInput: string, opts: { withFileTypes: true }) {
        return await readdir(toHostPath(hostRoot, pathInput), opts)
      },
      async writeFile(pathInput: string, data: Buffer | Uint8Array | string) {
        const hostPath = toHostPath(hostRoot, pathInput)
        await mkdir(dirname(hostPath), { recursive: true })
        await writeFile(hostPath, data)
      },
      async stat(pathInput: string) {
        return await stat(toHostPath(hostRoot, pathInput))
      },
      async lstat(pathInput: string) {
        return await lstat(toHostPath(hostRoot, pathInput))
      },
      async mkdir(pathInput: string, opts?: { recursive?: boolean }) {
        return await mkdir(toHostPath(hostRoot, pathInput), opts)
      },
      async rename(fromPathInput: string, toPathInput: string) {
        await rename(
          toHostPath(hostRoot, fromPathInput),
          toHostPath(hostRoot, toPathInput),
        )
      },
      async rm(
        pathInput: string,
        opts?: { recursive?: boolean; force?: boolean },
      ) {
        await rm(toHostPath(hostRoot, pathInput), opts)
      },
      async rmdir(pathInput: string) {
        await rmdir(toHostPath(hostRoot, pathInput))
      },
    },
    async writeFiles(files: WriteInput[]) {
      lastWriteFiles.length = 0
      for (const file of files) {
        const absoluteSandboxPath = toSandboxAbsolutePath(file.path)
        const hostPath = toHostPath(hostRoot, absoluteSandboxPath)
        await mkdir(dirname(hostPath), { recursive: true })

        const content = typeof file.content === 'string'
          ? Buffer.from(file.content, 'utf-8')
          : Buffer.from(file.content)
        await writeFile(hostPath, content)

        lastWriteFiles.push({
          path: absoluteSandboxPath,
          content: new Uint8Array(content),
        })
      }
    },
    async runCommand(
      commandOrParams: string | { cmd: string; args?: string[]; signal?: AbortSignal; stdout?: Writable; stderr?: Writable },
      args: string[] = [],
      opts?: { signal?: AbortSignal },
    ) {
      const command = typeof commandOrParams === 'string'
        ? commandOrParams
        : commandOrParams.cmd
      const commandArgs = typeof commandOrParams === 'string'
        ? args
        : (commandOrParams.args ?? [])
      const signal = typeof commandOrParams === 'string'
        ? opts?.signal
        : commandOrParams.signal
      const stdoutWritable = typeof commandOrParams === 'object' ? commandOrParams.stdout : undefined
      const stderrWritable = typeof commandOrParams === 'object' ? commandOrParams.stderr : undefined

      if (signal?.aborted) {
        throw new Error('mock command aborted')
      }

      const script = command === 'sh' && commandArgs[0] === '-c'
        ? (commandArgs[1] ?? '')
        : [command, ...commandArgs].join(' ').trim()

      function emitResult(exitCode: number, stdoutText: string, stderrText: string) {
        if (stdoutWritable) {
          if (stdoutText) stdoutWritable.write(Buffer.from(stdoutText, 'utf-8'))
          stdoutWritable.end()
        }
        if (stderrWritable) {
          if (stderrText) stderrWritable.write(Buffer.from(stderrText, 'utf-8'))
          stderrWritable.end()
        }
        return {
          exitCode,
          stdout: async () => stdoutText,
          stderr: async () => stderrText,
        }
      }

      if ((script.includes('install -d') || script.includes('mkdir -p')) && script.includes('/workspace')) {
        return emitResult(0, '', '')
      }

      if (command === 'find' && commandArgs[1] === '-maxdepth' && commandArgs[5] === '-printf') {
        const pathArg = commandArgs[0]
        if (!pathArg) return emitResult(127, '', `unsupported mock command: ${script}`)

        try {
          const hostPath = toHostPath(hostRoot, pathArg)
          const entries = (await readdir(hostPath, { withFileTypes: true }))
            .map((entry) => `${entry.name}\0${entry.isDirectory() ? 'd' : 'f'}\0`)
            .join('')
          return emitResult(0, entries, '')
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          return emitResult(1, '', message)
        }
      }

      const normalizedScript = script.replace(/^'([^']+)'\s+/, '$1 ')

      if (normalizedScript.startsWith('cat ')) {
        const targetPath = normalizedScript.slice(4).trim().replace(/^'(.*)'$/, '$1')
        try {
          const stdout = await readFile(toHostPath(hostRoot, targetPath), 'utf-8')
          return emitResult(0, stdout, '')
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          return emitResult(1, '', message)
        }
      }

      if (normalizedScript.startsWith('echo ')) {
        return emitResult(0, `${normalizedScript.slice(5)}\n`, '')
      }

      if (script.startsWith('node -e ')) {
        const writeMatch = script.match(/\s'((?:\/workspace|\/vercel\/sandbox)[^']*)'\s'([^']*)'$/)
        const readOrStatMatch = script.match(/\s'((?:\/workspace|\/vercel\/sandbox)[^']*)'$/)
        const pathArg = writeMatch?.[1] ?? readOrStatMatch?.[1]
        const dataArg = writeMatch?.[2]
        if (!pathArg) return emitResult(127, '', `unsupported mock command: ${script}`)

        try {
          const hostPath = toHostPath(hostRoot, pathArg)
          if (script.includes('lstatSync')) {
            return emitResult(0, JSON.stringify((await lstat(hostPath)).isSymbolicLink()), '')
          }
          if (script.includes('realpathSync')) {
            const targetMatch = script.match(/\s'(\/vercel\/sandbox[^']*)'\s'(\/vercel\/sandbox[^']*)'$/)
            const rootPath = await realpath(toHostPath(hostRoot, targetMatch?.[1] ?? VERCEL_SANDBOX_ROOT))
            const targetPath = await realpath(toHostPath(hostRoot, targetMatch?.[2] ?? pathArg))
            const rel = relative(rootPath, targetPath)
            return emitResult(0, JSON.stringify(rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))), '')
          }
          if (script.includes('fs.writeFileSync')) {
            await mkdir(dirname(hostPath), { recursive: true })
            await writeFile(hostPath, Buffer.from(dataArg ?? '', 'base64'))
          }
          const fileStat = await stat(hostPath)
          const payload: Record<string, unknown> = {
            size: fileStat.size,
            mtimeMs: fileStat.mtimeMs,
            kind: fileStat.isDirectory() ? 'dir' : 'file',
          }
          if (script.includes('fs.readFileSync')) {
            return emitResult(0, JSON.stringify({
              content: await readFile(hostPath, 'utf-8'),
              stat: payload,
            }), '')
          }
          return emitResult(0, JSON.stringify(payload), '')
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          return emitResult(1, '', message)
        }
      }

      return emitResult(127, '', `unsupported mock command: ${script}`)
    },
  } as unknown as VercelSandbox

  return {
    sandbox,
    hostRoot,
    lastWriteFiles,
    async cleanup() {
      await rm(hostRoot, { recursive: true, force: true })
    },
  }
}
