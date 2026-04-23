import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

const VERCEL_SANDBOX_ROOT = '/vercel/sandbox'

interface WriteInput {
  path: string
  content: Buffer | Uint8Array | string
}

export interface MockVercelSandboxHarness {
  sandbox: VercelSandbox
  cleanup(): Promise<void>
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
  const relPath = relative(VERCEL_SANDBOX_ROOT, absoluteSandboxPath)
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
      async stat(pathInput: string) {
        return await stat(toHostPath(hostRoot, pathInput))
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
    async runCommand(command: string, args: string[] = []) {
      const script = command === 'sh' && args[0] === '-c'
        ? (args[1] ?? '')
        : [command, ...args].join(' ').trim()

      if (script.startsWith('cat ')) {
        const targetPath = script.slice(4).trim()
        try {
          const stdout = await readFile(toHostPath(hostRoot, targetPath), 'utf-8')
          return {
            exitCode: 0,
            stdout: async () => stdout,
            stderr: async () => '',
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            exitCode: 1,
            stdout: async () => '',
            stderr: async () => message,
          }
        }
      }

      return {
        exitCode: 127,
        stdout: async () => '',
        stderr: async () => `unsupported mock command: ${script}`,
      }
    },
  } as unknown as VercelSandbox

  return {
    sandbox,
    lastWriteFiles,
    async cleanup() {
      await rm(hostRoot, { recursive: true, force: true })
    },
  }
}
