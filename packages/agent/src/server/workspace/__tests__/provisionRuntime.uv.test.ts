import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

function mockSuccessfulExecFile(): void {
  execFileMock.mockImplementation((_cmd: string, _args: string[], optsOrCb: unknown, maybeCb?: unknown) => {
    const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb
    if (typeof cb !== 'function') throw new Error('expected execFile callback')
    cb(null, '', '')
  })
}

test('uv venv provisioning allows pre-created owned .boring-agent/venv layout dir', async () => {
  mockSuccessfulExecFile()

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

test('provisioning env converts file URLs and preserves HTTP URLs', async () => {
  mockSuccessfulExecFile()

  const { provisionRuntimeWorkspace } = await import('../provisionRuntime')
  const { getBoringAgentRuntimePaths } = await import('../runtimeLayout')

  const workspaceRoot = await makeTempDir('boring-runtime-url-env-')
  const packageRoot = join(workspaceRoot, 'python-package')
  const projectFile = join(packageRoot, 'pyproject.toml')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(projectFile, '[project]\nname = "boring-runtime-url-env-test"\nversion = "0.0.0"\n', 'utf8')

  const result = await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [
      {
        id: 'python-test',
        provisioning: {
          python: [
            {
              id: 'python-test',
              projectFile,
              env: {
                BORING_MACRO_API_URL: new URL('https://api.example.test/workspace'),
                EXAMPLE_ROOT: new URL(`file://${packageRoot}/`),
                PATH: '/plugin/bin',
              },
            },
          ],
        },
      },
    ],
  })

  expect(result.env.BORING_MACRO_API_URL).toBe('https://api.example.test/workspace')
  expect(result.env.EXAMPLE_ROOT).toBe(`${packageRoot}/`)
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const pythonShim = await readFile(join(paths.bin, 'python'), 'utf8')
  expect(pythonShim).toContain('export PATH="$WORKSPACE_ROOT/.boring-agent/bin:$VENV_BIN:$PLUGIN_PATH')
  expect(pythonShim).toContain("PLUGIN_PATH='/plugin/bin'")
})
