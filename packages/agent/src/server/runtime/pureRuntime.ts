import { chmod, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PURE_RUNTIME_CWD_NAME = '.runtime-none'
let defaultPureRuntimeCwd: Promise<string> | undefined

export async function createPureRuntimeCwd(sessionRoot: string | undefined): Promise<string> {
  const explicitRoot = sessionRoot?.trim()
  if (!explicitRoot) {
    defaultPureRuntimeCwd ??= createDefaultPureRuntimeCwd()
    return defaultPureRuntimeCwd
  }

  const cwd = join(resolve(explicitRoot), PURE_RUNTIME_CWD_NAME)
  await mkdir(cwd, { recursive: true, mode: 0o700 })
  await chmod(cwd, 0o700)
  return cwd
}

async function createDefaultPureRuntimeCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'boring-agent-pure-'))
  await chmod(cwd, 0o700)
  return cwd
}
