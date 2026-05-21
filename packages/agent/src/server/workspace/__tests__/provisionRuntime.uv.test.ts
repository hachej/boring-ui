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

test('python provisioning stages venv creation then installs with uv into .boring-agent/venv', async () => {
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
    'python3',
    ['-m', 'venv', '--copies', expect.stringContaining(`${join('.boring-agent', 'tmp', 'venv-')}`)],
    expect.objectContaining({ cwd: workspaceRoot }),
    expect.any(Function),
  )
  expect(execFileMock).toHaveBeenCalledWith(
    'uv',
    ['pip', 'install', '--python', paths.venvPython, packageRoot],
    expect.objectContaining({
      cwd: workspaceRoot,
      env: expect.objectContaining({
        UV_CACHE_DIR: join(paths.cache, 'python'),
        PIP_CACHE_DIR: join(paths.cache, 'python'),
      }),
    }),
    expect.any(Function),
  )
  for (const cmd of ['python', 'python3', 'pip', 'pip3']) {
    expect(execFileMock).toHaveBeenCalledWith(
      cmd,
      ['--version'],
      expect.objectContaining({ env: expect.objectContaining({ PATH: expect.stringContaining(paths.bin) }) }),
      expect.any(Function),
    )
  }
})

test('matching marker with broken .boring-agent/venv is rebuilt', async () => {
  let failNextExistingPythonSmoke = false
  mockSuccessfulExecFile()

  const { provisionRuntimeWorkspace } = await import('../provisionRuntime')
  const { getBoringAgentRuntimePaths } = await import('../runtimeLayout')

  const workspaceRoot = await makeTempDir('boring-runtime-broken-venv-')
  const packageRoot = join(workspaceRoot, 'python-package')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'pyproject.toml'),
    '[project]\nname = "boring-runtime-broken-venv-test"\nversion = "0.0.0"\n',
    'utf8',
  )
  const contribution = {
    id: 'python-test',
    provisioning: {
      python: [
        {
          id: 'python-test',
          projectFile: join(packageRoot, 'pyproject.toml'),
        },
      ],
    },
  }

  await provisionRuntimeWorkspace({ workspaceRoot, contributions: [contribution] })

  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  await mkdir(paths.venvBin, { recursive: true })
  await writeFile(paths.venvPython, '#!/broken/python\n', 'utf8')

  execFileMock.mockImplementation((cmd: string, args: string[], optsOrCb: unknown, maybeCb?: unknown) => {
    const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb
    if (typeof cb !== 'function') throw new Error('expected execFile callback')
    if (failNextExistingPythonSmoke && cmd === paths.venvPython && args[0] === '-c') {
      failNextExistingPythonSmoke = false
      cb(new Error('broken venv'), '', 'broken venv')
      return
    }
    cb(null, '', '')
  })
  failNextExistingPythonSmoke = true
  vi.clearAllMocks()

  const result = await provisionRuntimeWorkspace({ workspaceRoot, contributions: [contribution] })

  expect(result.changed).toBe(true)
  expect(execFileMock.mock.calls.filter(([cmd, args]) => (
    cmd === 'python3' && Array.isArray(args) && args[0] === '-m' && args[1] === 'venv' && args[2] === '--copies'
  ))).toHaveLength(1)
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
