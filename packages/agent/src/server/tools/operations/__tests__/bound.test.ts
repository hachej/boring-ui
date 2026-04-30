import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { boundFs } from '../bound'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'boundfs-test-'))
  await writeFile(join(workspaceRoot, 'hello.txt'), 'hello world')
  await mkdir(join(workspaceRoot, 'sub'))
  await writeFile(join(workspaceRoot, 'sub', 'nested.txt'), 'nested')
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('read', () => {
  test('reads file within workspace', async () => {
    const ops = boundFs(workspaceRoot)
    const buf = await ops.read.readFile(join(workspaceRoot, 'hello.txt'))
    expect(buf.toString()).toBe('hello world')
  })

  test('rejects absolute path outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.read.readFile('/etc/passwd')).rejects.toThrow(
      'is outside workspace',
    )
  })

  test('rejects symlink that escapes workspace', async () => {
    const linkPath = join(workspaceRoot, 'evil-link')
    await symlink('/etc/passwd', linkPath)

    const ops = boundFs(workspaceRoot)
    await expect(ops.read.readFile(linkPath)).rejects.toThrow(
      'is outside workspace',
    )
  })

  test('access succeeds for readable file', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(
      ops.read.access(join(workspaceRoot, 'hello.txt')),
    ).resolves.toBeUndefined()
  })

  test('access rejects path outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.read.access('/etc/passwd')).rejects.toThrow(
      'is outside workspace',
    )
  })
})

describe('write', () => {
  test('writes file within workspace', async () => {
    const ops = boundFs(workspaceRoot)
    const target = join(workspaceRoot, 'new.txt')
    await ops.write.writeFile(target, 'created')

    const buf = await ops.read.readFile(target)
    expect(buf.toString()).toBe('created')
  })

  test('creates intermediate directories', async () => {
    const ops = boundFs(workspaceRoot)
    const target = join(workspaceRoot, 'a', 'b', 'c.txt')
    await ops.write.writeFile(target, 'deep')

    const buf = await ops.read.readFile(target)
    expect(buf.toString()).toBe('deep')
  })

  test('rejects write outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.write.writeFile('/tmp/escape.txt', 'bad')).rejects.toThrow(
      'is outside workspace',
    )
  })

  test('mkdir succeeds within workspace', async () => {
    const ops = boundFs(workspaceRoot)
    const dir = join(workspaceRoot, 'newdir')
    await ops.write.mkdir(dir)

    const s = await ops.ls.stat(dir)
    expect(s.isDirectory()).toBe(true)
  })

  test('mkdir rejects outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.write.mkdir('/tmp/escape-dir')).rejects.toThrow(
      'is outside workspace',
    )
  })
})

describe('edit', () => {
  test('reads and writes within workspace', async () => {
    const ops = boundFs(workspaceRoot)
    const filePath = join(workspaceRoot, 'hello.txt')

    const buf = await ops.edit.readFile(filePath)
    expect(buf.toString()).toBe('hello world')

    await ops.edit.writeFile(filePath, 'updated')
    const updated = await ops.edit.readFile(filePath)
    expect(updated.toString()).toBe('updated')
  })

  test('access checks read+write', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(
      ops.edit.access(join(workspaceRoot, 'hello.txt')),
    ).resolves.toBeUndefined()
  })

  test('rejects symlink escape on write', async () => {
    const linkPath = join(workspaceRoot, 'write-link')
    await symlink('/tmp/boundfs-escape-target', linkPath)

    const ops = boundFs(workspaceRoot)
    await expect(ops.edit.writeFile(linkPath, 'bad')).rejects.toThrow(
      'is outside workspace',
    )
  })
})

describe('find', () => {
  test('glob returns matching files within workspace', async () => {
    const ops = boundFs(workspaceRoot)
    const results = await ops.find.glob('*.txt', workspaceRoot, {
      ignore: ['**/node_modules/**', '**/.git/**'],
      limit: 10,
    })

    expect(results).toContain(join(workspaceRoot, 'hello.txt'))
    expect(results).toContain(join(workspaceRoot, 'sub', 'nested.txt'))
  })

  test('glob supports path-containing patterns', async () => {
    const ops = boundFs(workspaceRoot)
    const results = await ops.find.glob('sub/*.txt', workspaceRoot, {
      ignore: [],
      limit: 10,
    })

    expect(results).toEqual([join(workspaceRoot, 'sub', 'nested.txt')])
  })

  test('glob ignore patterns only skip matching subtrees', async () => {
    await mkdir(join(workspaceRoot, 'src'))
    await mkdir(join(workspaceRoot, 'src', 'foo'))
    await mkdir(join(workspaceRoot, 'src', 'bar'))
    await writeFile(join(workspaceRoot, 'src', 'foo', 'ignored.txt'), 'ignored')
    await writeFile(join(workspaceRoot, 'src', 'bar', 'kept.txt'), 'kept')

    const ops = boundFs(workspaceRoot)
    const results = await ops.find.glob('*.txt', workspaceRoot, {
      ignore: ['src/foo/**'],
      limit: 10,
    })

    expect(results).toContain(join(workspaceRoot, 'src', 'bar', 'kept.txt'))
    expect(results).not.toContain(join(workspaceRoot, 'src', 'foo', 'ignored.txt'))
  })

  test('glob rejects cwd outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.find.glob('*', '/etc', { ignore: [], limit: 10 })).rejects.toThrow(
      'is outside workspace',
    )
  })

  test('exists rejects path outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.find.exists('/etc/passwd')).rejects.toThrow('is outside workspace')
  })

  test('exists rejects symlink escape', async () => {
    const linkPath = join(workspaceRoot, 'find-link')
    await symlink('/etc/passwd', linkPath)

    const ops = boundFs(workspaceRoot)
    await expect(ops.find.exists(linkPath)).rejects.toThrow('is outside workspace')
  })
})

describe('grep', () => {
  test('isDirectory checks workspace paths', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.grep.isDirectory(join(workspaceRoot, 'sub'))).resolves.toBe(true)
    await expect(ops.grep.isDirectory(join(workspaceRoot, 'hello.txt'))).resolves.toBe(false)
  })

  test('readFile reads only within workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.grep.readFile(join(workspaceRoot, 'hello.txt'))).resolves.toBe('hello world')
  })

  test('grep operations reject paths outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.grep.isDirectory('/etc')).rejects.toThrow('is outside workspace')
    await expect(ops.grep.readFile('/etc/passwd')).rejects.toThrow('is outside workspace')
  })

  test('grep read rejects symlink escape', async () => {
    const linkPath = join(workspaceRoot, 'grep-link')
    await symlink('/etc/passwd', linkPath)

    const ops = boundFs(workspaceRoot)
    await expect(ops.grep.readFile(linkPath)).rejects.toThrow('is outside workspace')
  })
})

describe('ls', () => {
  test('exists returns true for workspace file', async () => {
    const ops = boundFs(workspaceRoot)
    expect(await ops.ls.exists(join(workspaceRoot, 'hello.txt'))).toBe(true)
  })

  test('exists returns false for missing file', async () => {
    const ops = boundFs(workspaceRoot)
    expect(await ops.ls.exists(join(workspaceRoot, 'nope.txt'))).toBe(false)
  })

  test('exists returns false for path outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    expect(await ops.ls.exists('/etc/passwd')).toBe(false)
  })

  test('stat returns directory info', async () => {
    const ops = boundFs(workspaceRoot)
    const s = await ops.ls.stat(join(workspaceRoot, 'sub'))
    expect(s.isDirectory()).toBe(true)
  })

  test('stat rejects outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.ls.stat('/etc')).rejects.toThrow('is outside workspace')
  })

  test('readdir lists entries', async () => {
    const ops = boundFs(workspaceRoot)
    const entries = await ops.ls.readdir(workspaceRoot)
    expect(entries).toContain('hello.txt')
    expect(entries).toContain('sub')
  })

  test('readdir rejects outside workspace', async () => {
    const ops = boundFs(workspaceRoot)
    await expect(ops.ls.readdir('/etc')).rejects.toThrow(
      'is outside workspace',
    )
  })
})
