import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

const tempDirs: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

test('uv venv provisioning allows pre-created owned .boring-agent/venv layout dir', async () => {
  execFileMock.mockImplementation((_cmd: string, _args: string[], optsOrCb: unknown, maybeCb?: unknown) => {
    const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb
    if (typeof cb !== 'function') throw new Error('expected execFile callback')
    cb(null, '', '')
  })

  const { provisionRuntimeWorkspace } = await import('../provisionRuntime')
  const { getBoringAgentRuntimePaths } = await import('../runtimeLayout')

  const workspaceRoot = await makeTempDir('boring-runtime-uv-')
  const packageRoot = join(workspaceRoot, 'python-package')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'pyproject.toml'),
    '[project]\nname = "boring-runtime-uv-test"\nversion = "0.0.0"\n',
    'utf8',
  )

  await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [
      {
        id: 'python-test',
        provisioning: {
          python: [
            {
              id: 'python-test',
              projectFile: join(packageRoot, 'pyproject.toml'),
            },
          ],
        },
      },
    ],
  })

  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  expect(execFileMock).toHaveBeenCalledWith(
    'uv',
    ['venv', '--allow-existing', paths.venv],
    expect.objectContaining({ cwd: workspaceRoot }),
    expect.any(Function),
  )
})
