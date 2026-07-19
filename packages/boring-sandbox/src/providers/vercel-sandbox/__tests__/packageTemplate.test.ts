import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createGunzip } from 'node:zlib'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  buildTarGz,
  clearTemplateCacheForTests,
  collectFiles,
  computeTemplateHash,
  packageTemplate,
  type TemplateFile,
} from '../packageTemplate'

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}))

let fixtureDir: string

beforeEach(async () => {
  clearTemplateCacheForTests()
  fixtureDir = path.join(
    tmpdir(),
    `template-test-${process.pid}-${Date.now()}`,
  )
  await mkdir(fixtureDir, { recursive: true })
})

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
})

async function seedFiles(
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const fullPath = path.join(fixtureDir, rel)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }
}

describe('collectFiles', () => {
  test('collects files recursively and sorts them', async () => {
    await seedFiles({
      'b.txt': 'B',
      'a.txt': 'A',
      'sub/c.txt': 'C',
    })

    const files = await collectFiles(fixtureDir)

    expect(files.map((f) => f.rel)).toEqual(['a.txt', 'b.txt', 'sub/c.txt'])
    expect(files[0]!.content.toString()).toBe('A')
    expect(files[2]!.content.toString()).toBe('C')
  })

  test('returns empty array for empty directory', async () => {
    const files = await collectFiles(fixtureDir)
    expect(files).toEqual([])
  })
})

describe('computeTemplateHash', () => {
  test('produces consistent hash for same content', () => {
    const files: TemplateFile[] = [
      { rel: 'a.txt', content: Buffer.from('hello') },
    ]
    const h1 = computeTemplateHash(files)
    const h2 = computeTemplateHash(files)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  test('different content produces different hash', () => {
    const h1 = computeTemplateHash([
      { rel: 'a.txt', content: Buffer.from('hello') },
    ])
    const h2 = computeTemplateHash([
      { rel: 'a.txt', content: Buffer.from('world') },
    ])
    expect(h1).not.toBe(h2)
  })

  test('different paths produce different hash', () => {
    const content = Buffer.from('same')
    const h1 = computeTemplateHash([{ rel: 'a.txt', content }])
    const h2 = computeTemplateHash([{ rel: 'b.txt', content }])
    expect(h1).not.toBe(h2)
  })
})

describe('buildTarGz', () => {
  test('produces valid gzipped tarball', async () => {
    const files: TemplateFile[] = [
      { rel: 'hello.txt', content: Buffer.from('hello world') },
      { rel: 'dir/nested.txt', content: Buffer.from('nested content') },
    ]

    const tarGz = await buildTarGz(files)

    expect(tarGz.length).toBeGreaterThan(0)
    // Verify gzip magic bytes
    expect(tarGz[0]).toBe(0x1f)
    expect(tarGz[1]).toBe(0x8b)
  })

  test('decompressed tarball contains correct headers', async () => {
    const files: TemplateFile[] = [
      { rel: 'test.txt', content: Buffer.from('test content') },
    ]

    const tarGz = await buildTarGz(files)

    // Decompress to raw tar
    const rawTar = await new Promise<Buffer>((resolve, reject) => {
      const gunzip = createGunzip()
      const chunks: Buffer[] = []
      gunzip.on('data', (chunk: Buffer) => chunks.push(chunk))
      gunzip.on('end', () => resolve(Buffer.concat(chunks)))
      gunzip.on('error', reject)
      gunzip.end(tarGz)
    })

    // First 100 bytes of tar = filename
    const name = rawTar.subarray(0, 100).toString('utf8').replace(/\0+$/u, '')
    expect(name).toBe('test.txt')

    // ustar magic at offset 257
    const magic = rawTar.subarray(257, 263).toString('utf8').replace(/\0+$/u, '')
    expect(magic).toBe('ustar')
  })

  test('handles empty file list', async () => {
    const tarGz = await buildTarGz([])
    expect(tarGz.length).toBeGreaterThan(0)
  })

  test('large template completes in under 2s', async () => {
    const files: TemplateFile[] = []
    for (let i = 0; i < 500; i++) {
      files.push({
        rel: `dir${Math.floor(i / 50)}/file${i}.txt`,
        content: Buffer.alloc(10_000, `content-${i}`),
      })
    }

    const start = Date.now()
    const tarGz = await buildTarGz(files)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(2_000)
    expect(tarGz.length).toBeGreaterThan(0)
  })
})

describe('packageTemplate', () => {
  test('packages template and calls upload', async () => {
    await seedFiles({ 'skill.md': '# My Skill' })

    const uploadFn = vi.fn().mockResolvedValue('https://blob.example.com/abc.tar.gz')

    const result = await packageTemplate(fixtureDir, { uploadFn })

    expect(result.url).toBe('https://blob.example.com/abc.tar.gz')
    expect(result.hash).toHaveLength(16)
    expect(uploadFn).toHaveBeenCalledOnce()
    expect(uploadFn).toHaveBeenCalledWith(result.hash, expect.any(Buffer))
  })

  test('returns cached URL on second call with same content', async () => {
    await seedFiles({ 'a.txt': 'content' })

    const uploadFn = vi.fn().mockResolvedValue('https://blob.example.com/cached.tar.gz')

    const first = await packageTemplate(fixtureDir, { uploadFn })
    const second = await packageTemplate(fixtureDir, { uploadFn })

    expect(first.url).toBe(second.url)
    expect(first.hash).toBe(second.hash)
    expect(uploadFn).toHaveBeenCalledOnce()
  })

  test('re-uploads when content changes', async () => {
    await seedFiles({ 'a.txt': 'v1' })
    const uploadFn = vi.fn()
      .mockResolvedValueOnce('https://blob.example.com/v1.tar.gz')
      .mockResolvedValueOnce('https://blob.example.com/v2.tar.gz')

    const first = await packageTemplate(fixtureDir, { uploadFn })

    clearTemplateCacheForTests()
    await writeFile(path.join(fixtureDir, 'a.txt'), 'v2', 'utf8')

    const second = await packageTemplate(fixtureDir, { uploadFn })

    expect(first.hash).not.toBe(second.hash)
    expect(first.url).not.toBe(second.url)
    expect(uploadFn).toHaveBeenCalledTimes(2)
  })

  test('propagates upload errors', async () => {
    await seedFiles({ 'a.txt': 'content' })
    const uploadFn = vi.fn().mockRejectedValue(new Error('blob unavailable'))

    await expect(
      packageTemplate(fixtureDir, { uploadFn }),
    ).rejects.toThrow('blob unavailable')
  })
})
