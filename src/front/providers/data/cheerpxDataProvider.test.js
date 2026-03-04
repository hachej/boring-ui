import { describe, expect, it, vi } from 'vitest'
import { createCheerpXDataProvider } from './cheerpxDataProvider'

const createRuntimeMock = () => ({
  workspaceRoot: '/workspace',
  listFiles: vi.fn(async () => ({
    path: '/workspace',
    entries: [{ name: 'README.md', path: '/workspace/README.md', is_dir: false, size: 12, mtime: 1 }],
  })),
  readFile: vi.fn(async () => 'hello'),
  writeFile: vi.fn(async () => undefined),
  deletePath: vi.fn(async () => undefined),
  exec: vi.fn(async (command) => {
    if (command.includes('status --porcelain')) {
      return { status: 0, output: ' M README.md\n?? src/new.py\n' }
    }
    if (command.includes('test -d')) {
      return { status: 0, output: '' }
    }
    if (command.includes('git -C') && command.includes(' diff -- ')) {
      return { status: 0, output: 'diff --git a/README.md b/README.md' }
    }
    if (command.includes('git -C') && command.includes(' show ')) {
      return { status: 0, output: 'old' }
    }
    return { status: 0, output: 'ok' }
  }),
})

describe('createCheerpXDataProvider', () => {
  it('implements files api through runtime', async () => {
    const runtime = createRuntimeMock()
    const provider = createCheerpXDataProvider({ runtime })

    const listed = await provider.files.list('.')
    const content = await provider.files.read('README.md')
    await provider.files.write('docs/note.txt', 'note')
    await provider.files.delete('docs/note.txt')

    expect(listed).toEqual([
      {
        name: 'README.md',
        path: 'README.md',
        is_dir: false,
        size: 12,
        mtime: 1,
      },
    ])
    expect(content).toBe('hello')
    expect(runtime.writeFile).toHaveBeenCalledWith('docs/note.txt', 'note')
    expect(runtime.deletePath).toHaveBeenCalledWith('docs/note.txt')
  })

  it('implements git api and command runner', async () => {
    const runtime = createRuntimeMock()
    const provider = createCheerpXDataProvider({ runtime })

    const status = await provider.git.status()
    const diff = await provider.git.diff('README.md')
    const shown = await provider.git.show('README.md')
    const command = await provider.runCommand('ls -la', { cwd: 'src' })

    expect(status.files).toEqual([
      { path: 'README.md', status: 'M' },
      { path: 'src/new.py', status: 'U' },
    ])
    expect(diff).toContain('diff --git')
    expect(shown).toBe('old')
    expect(command).toEqual({
      exitCode: 0,
      status: 0,
      stdout: 'ok',
      stderr: '',
      output: 'ok',
      success: true,
    })
    expect(provider.pi).toEqual({ bashOnly: true })
  })
})

