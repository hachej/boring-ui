import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { dirname, extname, posix } from 'node:path'
import type { Workspace } from '../../../shared/workspace'

export const MARKDOWN_REVIEW_SHARE_KIND = 'markdown-review'

export type PublicShareKind = string

export interface PublicShareDownloadLink {
  href: string
  contentType?: string
  label?: string
}

export interface PublicShareCapabilities {
  readFiles: string[]
  /** Workspace-relative files that may be written through this share. */
  writeFiles?: string[]
  /** Back-compat shorthand for allowing writes to entryPath. */
  writeEntry?: true
  /** Back-compat marker for the current Markdown review renderer. */
  renderMarkdown?: true
  downloads?: Record<string, PublicShareDownloadLink>
}

export interface PublicShareRecord {
  token: string
  kind: PublicShareKind
  /** Public app/viewer id used by front-end dispatchers. Defaults to kind. */
  appId?: string
  entryPath: string
  /** Content type of the entry file; downloads/assets may have their own type. */
  contentType?: string
  capabilities: PublicShareCapabilities
  createdAt?: string
  expiresAt?: string
  title?: string
}

export interface PublicShareResponse {
  body: string | Uint8Array | Buffer
  contentType: string
  headers?: Record<string, string>
  statusCode?: number
}

export interface PublicShareHandlerContext {
  share: PublicShareRecord
  workspace: Workspace
  request: FastifyRequest
}

export interface PublicShareHandler {
  kind: string
  canHandle?: (share: PublicShareRecord) => boolean
  meta: (context: Omit<PublicShareHandlerContext, 'workspace' | 'request'>) => Record<string, unknown>
  renderIndex?: (context: PublicShareHandlerContext) => Promise<PublicShareResponse> | PublicShareResponse
  readRaw?: (context: PublicShareHandlerContext) => Promise<PublicShareResponse> | PublicShareResponse
  writeRaw?: (context: PublicShareHandlerContext, content: string) => Promise<void> | void
  downloads?: Record<string, (context: PublicShareHandlerContext) => Promise<PublicShareResponse> | PublicShareResponse>
}

export interface PublicShareRoutesOptions {
  getShare: (token: string) => PublicShareRecord | undefined | Promise<PublicShareRecord | undefined>
  getWorkspace: (share: PublicShareRecord) => Workspace | Promise<Workspace>
  handlers?: PublicShareHandler[]
}

const LOCAL_MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
const MARKDOWN_LINK_RE = /(!?)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.avif': return 'image/avif'
    case '.gif': return 'image/gif'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.svg': return 'image/svg+xml'
    case '.webp': return 'image/webp'
    case '.css': return 'text/css; charset=utf-8'
    case '.csv': return 'text/csv; charset=utf-8'
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'application/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.md': return 'text/markdown; charset=utf-8'
    case '.pdf': return 'application/pdf'
    case '.txt': return 'text/plain; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isExternalOrUnsafeUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value) || value.includes('\0')
}

function normalizeWorkspacePath(path: string): string | null {
  if (!path || path.includes('\0') || path.startsWith('/')) return null
  const normalized = posix.normalize(path.replace(/\\/g, '/'))
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return null
  return normalized
}

function resolveRelativePath(fromPath: string, target: string): string | null {
  if (isExternalOrUnsafeUrl(target)) return null
  const [pathPart, suffix = ''] = target.split(/([?#].*)/, 2)
  const base = dirname(fromPath) === '.' ? '' : dirname(fromPath)
  const normalized = normalizeWorkspacePath(posix.join(base, pathPart))
  return normalized ? `${normalized}${suffix}` : null
}

function stripUrlSuffix(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path
}

export function collectMarkdownAssetPaths(markdown: string, entryPath: string): string[] {
  const assets = new Set<string>()
  for (const match of markdown.matchAll(LOCAL_MARKDOWN_IMAGE_RE)) {
    const raw = match[1] ?? match[2]
    if (!raw) continue
    const resolved = resolveRelativePath(entryPath, raw)
    if (resolved) assets.add(stripUrlSuffix(resolved))
  }
  return [...assets].sort()
}

export function createMarkdownReviewShare(args: {
  token: string
  entryPath: string
  markdown: string
  includeAssets?: boolean
  allowEdit?: boolean
  expiresAt?: string
  title?: string
}): PublicShareRecord {
  const entryPath = normalizeWorkspacePath(args.entryPath)
  if (!entryPath) throw new Error('entryPath must be a workspace-relative file path')
  const readFiles = new Set<string>([entryPath])
  if (args.includeAssets) {
    for (const asset of collectMarkdownAssetPaths(args.markdown, entryPath)) readFiles.add(asset)
  }
  return {
    token: args.token,
    kind: MARKDOWN_REVIEW_SHARE_KIND,
    appId: MARKDOWN_REVIEW_SHARE_KIND,
    entryPath,
    contentType: 'text/markdown; charset=utf-8',
    capabilities: {
      readFiles: [...readFiles].sort(),
      renderMarkdown: true,
      ...(args.allowEdit ? { writeEntry: true as const, writeFiles: [entryPath] } : {}),
      downloads: {
        portableMarkdown: { href: `/share/${encodeURIComponent(args.token)}/portable.md`, contentType: 'text/markdown; charset=utf-8', label: 'Portable Markdown' },
        bundleZip: { href: `/share/${encodeURIComponent(args.token)}/bundle.zip`, contentType: 'application/zip', label: 'Bundle ZIP' },
      },
    },
    ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
    ...(args.title ? { title: args.title } : {}),
  }
}

function sharePathAllowed(share: PublicShareRecord, requestedPath: string): boolean {
  const normalized = normalizeWorkspacePath(stripUrlSuffix(requestedPath))
  return normalized !== null && share.capabilities.readFiles.includes(normalized)
}

function rewriteMarkdownLinks(markdown: string, share: PublicShareRecord): string {
  return markdown.replace(MARKDOWN_LINK_RE, (full, bang: string, label: string, rawUrl: string) => {
    if (!bang) return full
    const resolved = resolveRelativePath(share.entryPath, rawUrl)
    if (!resolved || !sharePathAllowed(share, resolved)) return full
    const suffix = rawUrl.match(/[?#].*$/)?.[0] ?? ''
    const assetPath = stripUrlSuffix(resolved)
    const url = `/share/${encodeURIComponent(share.token)}/assets/${assetPath.split('/').map(encodeURIComponent).join('/')}${suffix}`
    return `![${label}](${url})`
  })
}

function renderInlineMarkdown(value: string): string {
  let html = escapeHtml(value)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" rel="noreferrer noopener" target="_blank">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return html
}

function renderHtmlImageLine(line: string, share: PublicShareRecord): string | null {
  const src = line.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i)?.[1]
  if (!src) return null
  const resolved = resolveRelativePath(share.entryPath, src)
  if (!resolved || !sharePathAllowed(share, resolved)) return null
  const suffix = src.match(/[?#].*$/)?.[0] ?? ''
  const assetPath = stripUrlSuffix(resolved)
  const url = `/share/${encodeURIComponent(share.token)}/assets/${assetPath.split('/').map(encodeURIComponent).join('/')}${suffix}`
  const alt = line.match(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/i)?.[1] ?? ''
  return `<p><img alt="${escapeHtml(alt)}" src="${url}"></p>`
}

function renderMarkdownDocument(markdown: string, share: PublicShareRecord): string {
  const rewritten = rewriteMarkdownLinks(markdown, share)
  const lines = rewritten.split(/\r?\n/)
  const out: string[] = []
  let inCode = false
  let code: string[] = []
  let inList = false

  const closeList = () => {
    if (inList) out.push('</ul>')
    inList = false
  }
  const closeCode = () => {
    if (!inCode) return
    out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
    code = []
    inCode = false
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) closeCode()
      else {
        closeList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }
    if (!line.trim()) {
      closeList()
      continue
    }
    const htmlImage = renderHtmlImageLine(line.trim(), share)
    if (htmlImage) {
      closeList()
      out.push(htmlImage)
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    const item = line.match(/^[-*]\s+(.+)$/)
    if (item) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${renderInlineMarkdown(line)}</p>`)
  }
  closeCode()
  closeList()
  const title = escapeHtml(share.title ?? share.entryPath)
  const editable = share.capabilities.writeEntry === true
  const editPanel = editable ? `<details class="edit"><summary>Edit Markdown</summary><form method="post" action="/share/${encodeURIComponent(share.token)}/raw"><textarea name="content" spellcheck="false">${escapeHtml(markdown)}</textarea><div><button type="submit">Save changes</button><span>Anyone with this link can edit this document.</span></div></form></details>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}body{margin:0;background:#fafafa;color:#171717}.page{max-width:820px;margin:0 auto;padding:48px 24px 72px}.meta{display:flex;justify-content:space-between;gap:16px;margin-bottom:32px;color:#737373;font-size:13px}.meta a{color:inherit}article,.edit{background:white;border:1px solid #e5e5e5;border-radius:18px;padding:32px;box-shadow:0 18px 60px rgba(0,0,0,.06)}.edit{margin-top:18px}.edit summary{cursor:pointer;font-weight:700}.edit textarea{box-sizing:border-box;width:100%;min-height:420px;margin-top:18px;padding:14px;border:1px solid #d4d4d4;border-radius:12px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}.edit button{margin-top:12px;border:0;border-radius:999px;background:#171717;color:white;padding:9px 15px;font-weight:700;cursor:pointer}.edit span{margin-left:12px;color:#737373;font-size:12px}h1,h2,h3{line-height:1.2;margin:1.4em 0 .55em}h1:first-child,h2:first-child,h3:first-child{margin-top:0}p,ul,pre{margin:0 0 1em}img{max-width:100%;height:auto;border-radius:12px;border:1px solid #e5e5e5}pre{overflow:auto;padding:16px;border-radius:12px;background:#171717;color:#fafafa}code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:.9em}p code,li code{background:#f5f5f5;border:1px solid #e5e5e5;border-radius:5px;padding:1px 4px;color:#171717}a{color:#2563eb}@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}article,.edit{background:#111;border-color:#262626}.meta{color:#a3a3a3}.edit textarea{background:#0a0a0a;color:#ededed;border-color:#333}.edit button{background:#ededed;color:#111}.edit span{color:#a3a3a3}p code,li code{background:#1f1f1f;border-color:#333;color:#ededed}img{border-color:#333}}
</style>
</head>
<body><main class="page"><div class="meta"><span>${title}</span><span><a href="/share/${encodeURIComponent(share.token)}/editor">Rich editor</a> · <a href="/share/${encodeURIComponent(share.token)}/portable.md">Portable MD</a> · <a href="/share/${encodeURIComponent(share.token)}/bundle.zip">Bundle ZIP</a> · <a href="/share/${encodeURIComponent(share.token)}/raw">Raw</a></span></div><article>${out.join('\n')}</article>${editPanel}</main></body>
</html>`
}


function rewriteMarkdownAssetUrls(markdown: string, share: PublicShareRecord, baseUrl = ''): string {
  const prefix = baseUrl.replace(/\/$/, '')
  let rewritten = markdown.replace(MARKDOWN_LINK_RE, (full, bang: string, label: string, rawUrl: string) => {
    if (!bang) return full
    const resolved = resolveRelativePath(share.entryPath, rawUrl)
    if (!resolved || !sharePathAllowed(share, resolved)) return full
    const suffix = rawUrl.match(/[?#].*$/)?.[0] ?? ''
    const assetPath = stripUrlSuffix(resolved)
    const url = `${prefix}/share/${encodeURIComponent(share.token)}/assets/${assetPath.split('/').map(encodeURIComponent).join('/')}${suffix}`
    return `![${label}](${url})`
  })
  rewritten = rewritten.replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi, (full, before: string, rawUrl: string, after: string) => {
    const resolved = resolveRelativePath(share.entryPath, rawUrl)
    if (!resolved || !sharePathAllowed(share, resolved)) return full
    const suffix = rawUrl.match(/[?#].*$/)?.[0] ?? ''
    const assetPath = stripUrlSuffix(resolved)
    const url = `${prefix}/share/${encodeURIComponent(share.token)}/assets/${assetPath.split('/').map(encodeURIComponent).join('/')}${suffix}`
    return `<img${before} src="${url}"${after}>`
  })
  return rewritten
}

function rewriteMarkdownAssetUrlsForBundle(markdown: string, share: PublicShareRecord): string {
  return markdown.replace(MARKDOWN_LINK_RE, (full, bang: string, label: string, rawUrl: string) => {
    if (!bang) return full
    const resolved = resolveRelativePath(share.entryPath, rawUrl)
    if (!resolved || !sharePathAllowed(share, resolved)) return full
    return `![${label}](${stripUrlSuffix(resolved)})`
  }).replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi, (full, before: string, rawUrl: string, after: string) => {
    const resolved = resolveRelativePath(share.entryPath, rawUrl)
    if (!resolved || !sharePathAllowed(share, resolved)) return full
    return `<img${before} src="${stripUrlSuffix(resolved)}"${after}>`
  })
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u16(value: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b }
function u32(value: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b }

function createStoredZip(files: Array<{ name: string; data: Uint8Array }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name.replace(/^\/+/, ''), 'utf8')
    const data = Buffer.from(file.data)
    const crc = crc32(data)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ])
    localParts.push(local)
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    offset += local.length
  }
  const central = Buffer.concat(centralParts)
  return Buffer.concat([...localParts, central, Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0),
  ])])
}

async function readBinary(workspace: Workspace, path: string): Promise<Uint8Array> {
  if (workspace.readBinaryFile) return await workspace.readBinaryFile(path)
  return Buffer.from(await workspace.readFile(path), 'utf8')
}

function canWriteEntry(share: PublicShareRecord): boolean {
  if (share.capabilities.writeEntry === true) return true
  return share.capabilities.writeFiles?.includes(share.entryPath) === true
}

function findShareHandler(handlers: PublicShareHandler[], share: PublicShareRecord): PublicShareHandler | null {
  return handlers.find((handler) => {
    if (handler.canHandle) return handler.canHandle(share)
    return handler.kind === share.kind
  }) ?? null
}

function createMarkdownDownloadLinks(share: PublicShareRecord): Record<string, PublicShareDownloadLink> {
  return {
    portableMarkdown: { href: `/share/${encodeURIComponent(share.token)}/portable.md`, contentType: 'text/markdown; charset=utf-8', label: 'Portable Markdown' },
    bundleZip: { href: `/share/${encodeURIComponent(share.token)}/bundle.zip`, contentType: 'application/zip', label: 'Bundle ZIP' },
  }
}

export const markdownReviewShareHandler: PublicShareHandler = {
  kind: MARKDOWN_REVIEW_SHARE_KIND,
  canHandle: (share) => share.kind === MARKDOWN_REVIEW_SHARE_KIND || share.capabilities.renderMarkdown === true,
  meta: ({ share }) => ({
    appId: share.appId ?? MARKDOWN_REVIEW_SHARE_KIND,
    contentType: share.contentType ?? 'text/markdown; charset=utf-8',
    downloads: share.capabilities.downloads ?? createMarkdownDownloadLinks(share),
  }),
  async renderIndex({ share, workspace }) {
    if (!sharePathAllowed(share, share.entryPath)) throw new Error('share entry not allowed')
    const markdown = await workspace.readFile(share.entryPath)
    return { contentType: 'text/html; charset=utf-8', body: renderMarkdownDocument(markdown, share) }
  },
  async readRaw({ share, workspace }) {
    if (!sharePathAllowed(share, share.entryPath)) throw new Error('share entry not allowed')
    return { contentType: 'text/markdown; charset=utf-8', body: await workspace.readFile(share.entryPath) }
  },
  async writeRaw({ share, workspace }, content) {
    if (!sharePathAllowed(share, share.entryPath)) throw new Error('share entry not allowed')
    await workspace.writeFile(share.entryPath, content)
  },
  downloads: {
    async portableMarkdown({ share, workspace, request }) {
      if (!sharePathAllowed(share, share.entryPath)) throw new Error('share entry not allowed')
      const origin = `${request.protocol}://${request.host}`
      const markdown = rewriteMarkdownAssetUrls(await workspace.readFile(share.entryPath), share, origin)
      return {
        contentType: 'text/markdown; charset=utf-8',
        body: markdown,
        headers: { 'content-disposition': `attachment; filename="${posix.basename(share.entryPath).replace(/"/g, '')}"` },
      }
    },
    async bundleZip({ share, workspace }) {
      if (!sharePathAllowed(share, share.entryPath)) throw new Error('share entry not allowed')
      const markdown = rewriteMarkdownAssetUrlsForBundle(await workspace.readFile(share.entryPath), share)
      const files: Array<{ name: string; data: Uint8Array }> = [{ name: share.entryPath, data: Buffer.from(markdown, 'utf8') }]
      for (const path of share.capabilities.readFiles) {
        if (path === share.entryPath) continue
        files.push({ name: path, data: await readBinary(workspace, path) })
      }
      const zip = createStoredZip(files)
      return {
        contentType: 'application/zip',
        body: zip,
        headers: {
          'content-disposition': `attachment; filename="${posix.basename(share.entryPath, extname(share.entryPath)) || 'share'}.zip"`,
          'content-length': String(zip.byteLength),
        },
      }
    },
  },
}

async function resolveShare(opts: PublicShareRoutesOptions, token: string, reply: FastifyReply): Promise<PublicShareRecord | null> {
  const share = await opts.getShare(token)
  if (!share) {
    reply.code(404).send({ error: 'share not found' })
    return null
  }
  if (share.expiresAt && Date.parse(share.expiresAt) <= Date.now()) {
    reply.code(410).send({ error: 'share expired' })
    return null
  }
  return share
}

export function registerPublicShareRoutes(
  app: FastifyInstance,
  opts: PublicShareRoutesOptions,
  done: (err?: Error) => void,
): void {
  const handlers = opts.handlers ?? [markdownReviewShareHandler]
  const securityHeaders = (reply: FastifyReply) => reply
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")

  const sendPublicResponse = (reply: FastifyReply, response: PublicShareResponse) => {
    const secured = securityHeaders(reply).code(response.statusCode ?? 200).type(response.contentType)
    for (const [name, value] of Object.entries(response.headers ?? {})) secured.header(name, value)
    return secured.send(response.body instanceof Uint8Array && !(response.body instanceof Buffer) ? Buffer.from(response.body) : response.body)
  }

  const resolveHandledShare = async (token: string, reply: FastifyReply): Promise<{ share: PublicShareRecord; handler: PublicShareHandler } | null> => {
    const share = await resolveShare(opts, token, reply)
    if (!share) return null
    const handler = findShareHandler(handlers, share)
    if (!handler) {
      reply.code(501).send({ error: 'share kind not supported' })
      return null
    }
    return { share, handler }
  }

  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body)
    })
  }

  app.get('/share/:token/', async (request, reply) => {
    const { token } = request.params as { token: string }
    const resolved = await resolveHandledShare(token, reply)
    if (!resolved) return
    const { share, handler } = resolved
    if (!handler.renderIndex) return reply.code(501).send({ error: 'share app cannot render an index' })
    try {
      const workspace = await opts.getWorkspace(share)
      return sendPublicResponse(reply, await handler.renderIndex({ share, workspace, request }))
    } catch {
      return reply.code(404).send({ error: 'share entry not found' })
    }
  })

  app.get('/share/:token/meta', async (request, reply) => {
    const { token } = request.params as { token: string }
    const resolved = await resolveHandledShare(token, reply)
    if (!resolved) return
    const { share, handler } = resolved
    const handlerMeta = handler.meta({ share })
    const downloads = (handlerMeta.downloads as Record<string, PublicShareDownloadLink> | undefined) ?? share.capabilities.downloads ?? {}
    const servedDownloadIds = Object.keys(handler.downloads ?? {})
    return securityHeaders(reply).send({
      token: share.token,
      kind: share.kind,
      appId: share.appId ?? share.kind,
      entryPath: share.entryPath,
      contentType: share.contentType ?? contentTypeForPath(share.entryPath),
      editable: canWriteEntry(share),
      links: {
        editor: `/share/${encodeURIComponent(share.token)}/editor`,
        raw: `/share/${encodeURIComponent(share.token)}/raw`,
        downloads: Object.fromEntries(servedDownloadIds.map((id) => [id, `/share/${encodeURIComponent(share.token)}/download/${encodeURIComponent(id)}`])),
      },
      ...handlerMeta,
      downloads,
    })
  })

  app.get('/share/:token/raw', async (request, reply) => {
    const { token } = request.params as { token: string }
    const resolved = await resolveHandledShare(token, reply)
    if (!resolved) return
    const { share, handler } = resolved
    if (!handler.readRaw) return reply.code(501).send({ error: 'share app cannot read raw content' })
    try {
      const workspace = await opts.getWorkspace(share)
      return sendPublicResponse(reply, await handler.readRaw({ share, workspace, request }))
    } catch {
      return reply.code(404).send({ error: 'share entry not found' })
    }
  })

  const sendDownload = async (request: FastifyRequest, reply: FastifyReply, token: string, downloadId: string) => {
    const resolved = await resolveHandledShare(token, reply)
    if (!resolved) return
    const { share, handler } = resolved
    const download = handler.downloads?.[downloadId]
    if (!download) return reply.code(404).send({ error: 'share download not found' })
    try {
      const workspace = await opts.getWorkspace(share)
      return sendPublicResponse(reply, await download({ share, workspace, request }))
    } catch {
      return reply.code(404).send({ error: 'share download not found' })
    }
  }

  app.get('/share/:token/download/:downloadId', async (request, reply) => {
    const params = request.params as { token: string; downloadId: string }
    return sendDownload(request, reply, params.token, params.downloadId)
  })

  app.get('/share/:token/portable.md', async (request, reply) => {
    const { token } = request.params as { token: string }
    return sendDownload(request, reply, token, 'portableMarkdown')
  })

  app.get('/share/:token/bundle.zip', async (request, reply) => {
    const { token } = request.params as { token: string }
    return sendDownload(request, reply, token, 'bundleZip')
  })

  app.post('/share/:token/raw', async (request, reply) => {
    const { token } = request.params as { token: string }
    const resolved = await resolveHandledShare(token, reply)
    if (!resolved) return
    const { share, handler } = resolved
    if (!canWriteEntry(share)) return reply.code(403).send({ error: 'share is read-only' })
    if (!handler.writeRaw) return reply.code(501).send({ error: 'share app cannot write raw content' })
    const body = request.body
    const content = typeof body === 'string'
      ? new URLSearchParams(body).get('content')
      : typeof (body as { content?: unknown } | undefined)?.content === 'string'
        ? (body as { content: string }).content
        : null
    if (content === null) return reply.code(400).send({ error: 'content is required' })
    try {
      const workspace = await opts.getWorkspace(share)
      await handler.writeRaw({ share, workspace, request }, content)
      return reply.code(303).header('location', `/share/${encodeURIComponent(share.token)}/`).send()
    } catch {
      return reply.code(404).send({ error: 'share entry not found' })
    }
  })

  app.get('/share/:token/api/v1/files/raw', async (request, reply) => {
    const { token } = request.params as { token: string }
    const query = request.query as Record<string, unknown>
    const rawPath = typeof query.path === 'string' ? query.path : ''
    const resolved = await resolveHandledShare(token, reply)
    if (!resolved) return
    const { share } = resolved
    const assetPath = normalizeWorkspacePath(rawPath)
    if (!assetPath || !sharePathAllowed(share, assetPath)) {
      return reply.code(404).send({ error: 'asset not found' })
    }
    try {
      const workspace = await opts.getWorkspace(share)
      const bytes = await readBinary(workspace, assetPath)
      return securityHeaders(reply)
        .type(contentTypeForPath(assetPath))
        .header('content-length', String(bytes.byteLength))
        .send(Buffer.from(bytes))
    } catch {
      return reply.code(404).send({ error: 'asset not found' })
    }
  })

  app.get('/share/:token/assets/*', async (request, reply) => {
    const params = request.params as { token: string; '*': string }
    const resolved = await resolveHandledShare(params.token, reply)
    if (!resolved) return
    const { share } = resolved
    const assetPath = normalizeWorkspacePath(params['*'])
    if (!assetPath || !sharePathAllowed(share, assetPath) || assetPath === share.entryPath) {
      return reply.code(404).send({ error: 'asset not found' })
    }
    try {
      const workspace = await opts.getWorkspace(share)
      const bytes = await readBinary(workspace, assetPath)
      return securityHeaders(reply)
        .type(contentTypeForPath(assetPath))
        .header('content-length', String(bytes.byteLength))
        .send(Buffer.from(bytes))
    } catch {
      return reply.code(404).send({ error: 'asset not found' })
    }
  })

  done()
}
