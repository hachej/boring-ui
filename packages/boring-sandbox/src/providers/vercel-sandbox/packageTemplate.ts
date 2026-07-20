import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createGzip } from 'node:zlib'

import { put } from '@vercel/blob'

export interface TemplatePackageResult {
  url: string
  hash: string
}

export interface TemplateFile {
  rel: string
  content: Buffer
}

export interface PackageTemplateOptions {
  blobToken?: string
  uploadFn?: (hash: string, tarball: Buffer) => Promise<string>
}

const urlCache = new Map<string, string>()

const LOG_PREFIX = '[template-tarball]'

function log(msg: string, meta: Record<string, unknown> = {}): void {
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
  process.stderr.write(`${LOG_PREFIX} ${msg}${metaStr}\n`)
}

export async function collectFiles(
  dir: string,
  base = '',
): Promise<TemplateFile[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: TemplateFile[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relPath = base ? `${base}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, relPath)))
    } else if (entry.isFile()) {
      files.push({ rel: relPath, content: await readFile(fullPath) })
    }
  }

  return files.sort((a, b) => a.rel.localeCompare(b.rel))
}

export function computeTemplateHash(files: TemplateFile[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.rel)
    hash.update('\0')
    hash.update(file.content)
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

// Minimal tar implementation — avoids tar-stream dependency.
// Each file: 512-byte header + content padded to 512-byte blocks.
// Archive terminated by two 512-byte zero blocks.
function writeTarHeader(
  name: string,
  size: number,
): Buffer {
  const header = Buffer.alloc(512)

  // name (0, 100)
  header.write(name.slice(0, 100), 0, 100, 'utf8')
  // mode (100, 8)
  header.write('0000644\0', 100, 8, 'utf8')
  // uid (108, 8)
  header.write('0000000\0', 108, 8, 'utf8')
  // gid (116, 8)
  header.write('0000000\0', 116, 8, 'utf8')
  // size (124, 12) — octal, null-terminated
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8')
  // mtime (136, 12)
  const mtime = Math.floor(Date.now() / 1000)
  header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'utf8')
  // typeflag (156, 1) — '0' = regular file
  header.write('0', 156, 1, 'utf8')
  // magic (257, 6) + version (263, 2)
  header.write('ustar\0', 257, 6, 'utf8')
  header.write('00', 263, 2, 'utf8')

  // checksum placeholder (148, 8) — spaces
  header.write('        ', 148, 8, 'utf8')
  let checksum = 0
  for (let i = 0; i < 512; i++) {
    checksum += header[i]!
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8')

  return header
}

export async function buildTarGz(files: TemplateFile[]): Promise<Buffer> {
  const chunks: Buffer[] = []

  for (const file of files) {
    chunks.push(writeTarHeader(file.rel, file.content.length))
    chunks.push(file.content)
    const padding = 512 - (file.content.length % 512)
    if (padding < 512) {
      chunks.push(Buffer.alloc(padding))
    }
  }

  // Two zero blocks = end of archive
  chunks.push(Buffer.alloc(1024))
  const tarBuffer = Buffer.concat(chunks)

  return new Promise<Buffer>((resolve, reject) => {
    const gzip = createGzip({ level: 6 })
    const gzChunks: Buffer[] = []
    gzip.on('data', (chunk: Buffer) => gzChunks.push(chunk))
    gzip.on('end', () => resolve(Buffer.concat(gzChunks)))
    gzip.on('error', reject)
    Readable.from(tarBuffer).pipe(gzip)
  })
}

async function defaultUpload(hash: string, tarball: Buffer): Promise<string> {
  const blob = await put(`boring-templates/${hash}.tar.gz`, tarball, {
    access: 'public',
    addRandomSuffix: false,
  })
  return blob.url
}

export async function packageTemplate(
  templatePath: string,
  opts: PackageTemplateOptions = {},
): Promise<TemplatePackageResult> {
  const startMs = Date.now()
  const files = await collectFiles(templatePath)
  const hash = computeTemplateHash(files)

  const cached = urlCache.get(hash)
  if (cached) {
    log('cache hit', { hash, fileCount: files.length })
    return { url: cached, hash }
  }

  const tarball = await buildTarGz(files)
  log('tarball built', {
    hash,
    fileCount: files.length,
    sizeBytes: tarball.length,
    buildMs: Date.now() - startMs,
  })

  const upload = opts.uploadFn ?? defaultUpload
  const url = await upload(hash, tarball)
  urlCache.set(hash, url)

  log('uploaded', { hash, url, totalMs: Date.now() - startMs })
  return { url, hash }
}

export function clearTemplateCacheForTests(): void {
  urlCache.clear()
}
