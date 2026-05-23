import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { AgentTool } from '../../../shared/tool'
import { getRuntimeBundleStorageRoot, type RuntimeBundle } from '../../runtime/mode'

const DEFAULT_UPLOAD_DIR = 'assets/images'
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

function contentTypeFromExt(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.svg': return 'image/svg+xml'
    case '.avif': return 'image/avif'
    default: return 'application/octet-stream'
  }
}

function extForUpload(filename: string, contentType: string): string {
  const fromName = extname(filename).toLowerCase().replace(/^\./, '')
  if (/^[a-z0-9]{1,12}$/.test(fromName)) return fromName
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/gif') return 'gif'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'image/svg+xml') return 'svg'
  return 'bin'
}

function basenameForUpload(filename: string): string {
  const base = filename.split('/').pop()?.split('\\').pop() ?? 'image'
  const withoutExt = base.replace(/\.[^.]*$/, '')
  const safe = withoutExt
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return safe || 'image'
}

export function buildUploadAgentTools(bundle: RuntimeBundle): AgentTool[] {
  const { workspace } = bundle
  const storageRoot = getRuntimeBundleStorageRoot(bundle)

  return [
    {
      name: 'upload_file',
      readinessRequirements: ['workspace-fs'],
      description:
        'Copy a workspace file into artifact storage (assets/images by default) and return its workspace-relative path. ' +
        'Use this when you want to embed an image in markdown or make a generated file accessible as a stable artifact. ' +
        'The returned path can be used directly in markdown image syntax: ![](returned-path)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative path of the source file (e.g. "chart.png" or "output/plot.png")',
          },
          directory: {
            type: 'string',
            description: `Destination directory inside the workspace. Defaults to "${DEFAULT_UPLOAD_DIR}".`,
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      async execute(input) {
        const filePath = typeof input.path === 'string' ? input.path.trim() : ''
        if (
          !filePath ||
          filePath.includes('\0') ||
          filePath.startsWith('/') ||
          filePath.split('/').includes('..')
        ) {
          return { content: [{ type: 'text', text: 'invalid path' }], isError: true }
        }

        const rawDir = typeof input.directory === 'string' ? input.directory.trim() : ''
        const dir = rawDir
          ? rawDir.replace(/^\.\/+/, '').replace(/\/+$/, '')
          : DEFAULT_UPLOAD_DIR

        try {
          const bytes = workspace.readBinaryFile
            ? Buffer.from(await workspace.readBinaryFile(filePath))
            : await readFile(join(storageRoot, filePath))
          if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
            return {
              content: [{ type: 'text', text: `file must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes` }],
              isError: true,
            }
          }

          const contentType = contentTypeFromExt(filePath)
          const ext = extForUpload(filePath, contentType)
          const base = basenameForUpload(filePath)
          const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          const destPath = `${dir}/${base}-${unique}.${ext}`

          await workspace.mkdir(dir, { recursive: true })
          if (workspace.writeBinaryFile) {
            await workspace.writeBinaryFile(destPath, bytes)
          } else {
            return {
              content: [{ type: 'text', text: 'workspace does not support binary file writes' }],
              isError: true,
            }
          }

          return {
            content: [{ type: 'text', text: `Uploaded to ${destPath}` }],
            isError: false,
            details: { path: destPath },
          }
        } catch (err) {
          return {
            content: [{ type: 'text', text: err instanceof Error ? err.message : 'upload failed' }],
            isError: true,
          }
        }
      },
    },
  ]
}
