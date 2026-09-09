import type { ShareEntryStore } from '../../shared/share-entry'
import type { Stat, Workspace } from '../../shared/workspace'
import { ErrorCode } from '../../shared/error-codes'
import type { ChannelBinding } from './channelBindingStore'

const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_PDF_BYTES = 16 * 1024 * 1024

export interface ChannelHtmlToPdfRenderer {
  /** Render the supplied immutable HTML bytes. The renderer must not navigate to the source path. */
  render(html: string): Promise<Uint8Array>
}

export interface HeadlessChromiumLauncher {
  launch(options: { headless: true }): Promise<{
    newPage(): Promise<{
      route(pattern: '**/*', handler: (route: { abort(): Promise<void> }) => Promise<void>): Promise<void>
      setContent(html: string, options: { waitUntil: 'load' }): Promise<void>
      pdf(options: { format: 'A4'; printBackground: true }): Promise<Uint8Array>
    }>
    close(): Promise<void>
  }>
}

/** Dependency-neutral Playwright/Puppeteer-style Chromium renderer. */
export function createHeadlessChromiumPdfRenderer(launcher: HeadlessChromiumLauncher): ChannelHtmlToPdfRenderer {
  return {
    async render(html) {
      const browser = await launcher.launch({ headless: true })
      try {
        const page = await browser.newPage()
        await page.route('**/*', async (route) => route.abort())
        await page.setContent(html, { waitUntil: 'load' })
        return Uint8Array.from(await page.pdf({ format: 'A4', printBackground: true }))
      } finally {
        await browser.close()
      }
    },
  }
}

export interface ChannelArtifactDocumentSender {
  sendDocument(input: {
    readonly conversationKey: string
    readonly bytes: Uint8Array
    readonly filename: string
    readonly mimeType: 'application/pdf'
  }): Promise<void>
  sendArtifactLink(input: { readonly conversationKey: string; readonly url: string }): Promise<void>
}

export interface ChannelArtifactDeliveryRuntime {
  /** Resolve the Workspace already authorized for this exact binding. */
  resolveWorkspace(binding: ChannelBinding): Promise<Workspace>
}

export interface ChannelArtifactDeliveryOptions {
  readonly authenticatedOrigin: string
  readonly producerPrincipalRef?: string
}

export interface PublishedChannelArtifact {
  readonly shareId: string
  readonly url: string
  readonly filename: 'artifact.pdf'
  readonly pdfByteSize: number
}

/**
 * Publishes one HTML workspace artifact to an already-bound channel recipient.
 * The share link remains a membership-gated live reference; the delivered PDF
 * is rendered from a stable byte snapshot and never re-reads the source.
 */
export class ChannelArtifactDeliveryService {
  private readonly origin: URL

  constructor(
    private readonly store: ShareEntryStore,
    private readonly runtime: ChannelArtifactDeliveryRuntime,
    private readonly renderer: ChannelHtmlToPdfRenderer,
    private readonly sender: ChannelArtifactDocumentSender,
    options: ChannelArtifactDeliveryOptions,
  ) {
    this.origin = authenticatedOrigin(options.authenticatedOrigin)
    this.producerPrincipalRef = options.producerPrincipalRef ?? 'channel-artifact-delivery'
  }

  private readonly producerPrincipalRef: string

  async publish(input: { readonly binding: ChannelBinding; readonly artifactPath: string }): Promise<PublishedChannelArtifact> {
    const { binding } = input
    if (binding.status !== 'active' || binding.outboundStatus !== 'active'
      || !binding.workspaceId || !binding.authSubjectId || !input.artifactPath.toLowerCase().endsWith('.html')) {
      throw artifactError(ErrorCode.enum.UNAUTHORIZED, 'artifact delivery is not authorized')
    }

    const workspace = await this.runtime.resolveWorkspace(binding)
    const html = await readStableHtml(workspace, input.artifactPath)
    const pdf = Uint8Array.from(await this.renderer.render(html))
    assertPdf(pdf)

    const entry = await this.store.create({
      workspaceId: binding.workspaceId,
      path: input.artifactPath,
      provenance: { producerPrincipalRef: this.producerPrincipalRef },
    })
    const url = new URL(`/a/${encodeURIComponent(entry.id)}`, this.origin).toString()
    const filename = 'artifact.pdf' as const

    await this.sender.sendDocument({
      conversationKey: binding.conversationKey,
      bytes: pdf,
      filename,
      mimeType: 'application/pdf',
    })
    await this.sender.sendArtifactLink({ conversationKey: binding.conversationKey, url })

    return { shareId: entry.id, url, filename, pdfByteSize: pdf.byteLength }
  }
}

function authenticatedOrigin(raw: string): URL {
  let origin: URL
  try {
    origin = new URL(raw)
  } catch {
    throw artifactError(ErrorCode.enum.CONFIG_INVALID, 'authenticated artifact origin is invalid')
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash
    || origin.pathname !== '/') {
    throw artifactError(ErrorCode.enum.CONFIG_INVALID, 'authenticated artifact origin is invalid')
  }
  return origin
}

async function readStableHtml(workspace: Workspace, path: string): Promise<string> {
  let before: Stat
  try {
    before = await workspace.stat(path)
  } catch {
    throw artifactError(ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE, 'artifact is unavailable')
  }
  assertHtmlStat(before)

  let html: string
  try {
    html = await workspace.readFile(path)
  } catch {
    throw artifactError(ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE, 'artifact is unavailable')
  }
  const after = await workspace.stat(path).catch(() => undefined)
  const byteSize = new TextEncoder().encode(html).byteLength
  if (!after || !sameStat(before, after) || byteSize !== before.size) {
    throw artifactError(ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE, 'artifact changed while being read')
  }
  if (!html.trim()) throw artifactError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact HTML is empty')
  return html
}

function assertHtmlStat(stat: Stat): void {
  if (stat.kind !== 'file' || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > MAX_HTML_BYTES) {
    throw artifactError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact HTML is invalid')
  }
}

function assertPdf(pdf: Uint8Array): void {
  const signature = new TextDecoder().decode(pdf.subarray(0, 5))
  if (signature !== '%PDF-' || pdf.byteLength > MAX_PDF_BYTES) {
    throw artifactError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'rendered PDF is invalid')
  }
}

function sameStat(left: Stat, right: Stat): boolean {
  return left.kind === right.kind && left.size === right.size && left.mtimeMs === right.mtimeMs
}

function artifactError(code: string, message: string): Error & { code: string; retryable: false } {
  return Object.assign(new Error(message), { code, retryable: false as const })
}
