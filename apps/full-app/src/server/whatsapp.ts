import { resolve } from 'node:path'
import { createHeadlessChromiumPdfRenderer } from '@hachej/boring-agent/server'
import type { CoreWhatsAppChannelOptions } from '@hachej/boring-core/app/server'
import { createNodeWorkspace } from '@hachej/boring-sandbox/providers/node-workspace'
import { createSelfHostedBatchFileTranscriber } from '@hachej/boring-transcription/server'
import { chromium } from 'playwright-core'

const REQUIRED_CREDENTIALS = [
  'BORING_WHATSAPP_ACCESS_TOKEN',
  'BORING_WHATSAPP_APP_SECRET',
  'BORING_WHATSAPP_VERIFY_TOKEN',
  'BORING_WHATSAPP_PHONE_NUMBER_ID',
  'BORING_WHATSAPP_FALLBACK_TEMPLATE',
] as const

interface FullAppWhatsAppBinding {
  readonly conversationKey: string
  readonly workspaceId: string
  readonly authSubjectId: string
  readonly sessionKey?: string
}

/** Reads host-owned deployment config without exporting credential material. */
export function readFullAppWhatsAppChannelOptions(
  defaultAgentTypeId: string,
  env: NodeJS.ProcessEnv = process.env,
): CoreWhatsAppChannelOptions | undefined {
  if (env.BORING_AGENT_CHANNELS !== '1' && env.BORING_AGENT_CHANNELS !== 'true') return undefined

  const missing = REQUIRED_CREDENTIALS.filter((name) => !env[name]?.trim())
  if (missing.length > 0) throw new Error(`WhatsApp channel credentials missing: ${missing.join(', ')}`)
  const bindings = parseBindings(env.BORING_WHATSAPP_BINDINGS_JSON)
  const resolveWorkspace = createWorkspaceResolver(env)
  const inboundMedia = readInboundMedia(env, resolveWorkspace)
  const artifactDelivery = readArtifactDelivery(env, resolveWorkspace)

  return {
    agentTypeId: env.BORING_WHATSAPP_AGENT_TYPE_ID?.trim() || defaultAgentTypeId,
    provisionedBindings: bindings,
    ...(inboundMedia ? { inboundMedia } : {}),
    ...(artifactDelivery ? { artifactDelivery } : {}),
    withCredentials: async (use) => await use({
      accessToken: env.BORING_WHATSAPP_ACCESS_TOKEN!.trim(),
      appSecret: env.BORING_WHATSAPP_APP_SECRET!.trim(),
      verifyToken: env.BORING_WHATSAPP_VERIFY_TOKEN!.trim(),
      phoneNumberId: env.BORING_WHATSAPP_PHONE_NUMBER_ID!.trim(),
      fallbackTemplateName: env.BORING_WHATSAPP_FALLBACK_TEMPLATE!.trim(),
      ...(env.BORING_WHATSAPP_FALLBACK_LANGUAGE?.trim()
        ? { fallbackTemplateLanguage: env.BORING_WHATSAPP_FALLBACK_LANGUAGE.trim() }
        : {}),
      ...(env.BORING_WHATSAPP_API_VERSION?.trim() ? { apiVersion: env.BORING_WHATSAPP_API_VERSION.trim() } : {}),
    }),
  }
}

type WorkspaceResolver = NonNullable<CoreWhatsAppChannelOptions['inboundMedia']>['runtime']['resolveWorkspace']

function createWorkspaceResolver(env: NodeJS.ProcessEnv): WorkspaceResolver | undefined {
  const baseRoot = env.BORING_AGENT_WORKSPACE_ROOT?.trim()
  if (!baseRoot) return undefined
  const resolvedBase = resolve(baseRoot)
  const workspaces = new Map<string, ReturnType<typeof createNodeWorkspace>>()
  return async (binding) => {
    const root = resolve(resolvedBase, binding.workspaceId)
    if (root === resolvedBase || !root.startsWith(`${resolvedBase}/`)) throw new Error('WhatsApp binding Workspace is outside the configured root')
    let workspace = workspaces.get(binding.workspaceId)
    if (!workspace) {
      workspace = createNodeWorkspace(root)
      workspaces.set(binding.workspaceId, workspace)
    }
    return workspace
  }
}

function readInboundMedia(
  env: NodeJS.ProcessEnv,
  resolveWorkspace: WorkspaceResolver | undefined,
): CoreWhatsAppChannelOptions['inboundMedia'] {
  if (env.BORING_WHATSAPP_MEDIA !== '1' && env.BORING_WHATSAPP_MEDIA !== 'true') return undefined
  const upstreamWebSocketUrl = env.BORING_WHATSAPP_WHISPER_URL?.trim()
  const storageRegion = env.BORING_WHATSAPP_MEDIA_REGION?.trim()
  if (!resolveWorkspace || !upstreamWebSocketUrl || (storageRegion !== 'CH' && storageRegion !== 'EU')) {
    throw new Error('WhatsApp media requires BORING_AGENT_WORKSPACE_ROOT, BORING_WHATSAPP_WHISPER_URL, and BORING_WHATSAPP_MEDIA_REGION=CH|EU')
  }
  return {
    runtime: { storageRegion, resolveWorkspace },
    transcriber: createSelfHostedBatchFileTranscriber({
      upstreamWebSocketUrl,
      processorRegion: storageRegion,
      ...(env.BORING_WHATSAPP_WHISPER_TOKEN?.trim() ? { bearerToken: env.BORING_WHATSAPP_WHISPER_TOKEN.trim() } : {}),
    }),
  }
}

function readArtifactDelivery(
  env: NodeJS.ProcessEnv,
  resolveWorkspace: WorkspaceResolver | undefined,
): CoreWhatsAppChannelOptions['artifactDelivery'] {
  if (env.BORING_WHATSAPP_ARTIFACTS !== '1' && env.BORING_WHATSAPP_ARTIFACTS !== 'true') return undefined
  const authenticatedOrigin = env.BORING_WHATSAPP_AUTHENTICATED_ORIGIN?.trim()
  if (!resolveWorkspace || !authenticatedOrigin) {
    throw new Error('WhatsApp artifacts require BORING_AGENT_WORKSPACE_ROOT and BORING_WHATSAPP_AUTHENTICATED_ORIGIN')
  }
  const executablePath = env.BORING_WHATSAPP_CHROMIUM_PATH?.trim() || '/usr/bin/chromium'
  return {
    authenticatedOrigin,
    runtime: { resolveWorkspace },
    renderer: createHeadlessChromiumPdfRenderer({
      async launch({ headless }) {
        const browser = await chromium.launch({ headless, executablePath })
        return {
          async newPage() {
            const page = await browser.newPage()
            return {
              async route(pattern, handler) { await page.route(pattern, async (route) => { await handler(route) }) },
              async routeWebSocket(pattern, handler) { await page.routeWebSocket(pattern, (socket) => handler(socket)) },
              async setContent(html, options) { await page.setContent(html, options) },
              async pdf(options) { return await page.pdf(options) },
            }
          },
          async close() { await browser.close() },
        }
      },
    }),
  }
}

function parseBindings(raw: string | undefined): readonly FullAppWhatsAppBinding[] {
  if (!raw?.trim()) throw new Error('WhatsApp channel bindings missing: BORING_WHATSAPP_BINDINGS_JSON')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('WhatsApp channel bindings are invalid JSON')
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isBinding)) {
    throw new Error('WhatsApp channel bindings must be a non-empty array of provisioned binding objects')
  }
  const keys = new Set<string>()
  for (const binding of parsed) {
    if (keys.has(binding.conversationKey)) throw new Error('WhatsApp channel bindings contain a duplicate conversationKey')
    keys.add(binding.conversationKey)
  }
  return parsed
}

function isBinding(value: unknown): value is FullAppWhatsAppBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const allowed = new Set(['conversationKey', 'workspaceId', 'authSubjectId', 'sessionKey'])
  return Object.keys(candidate).every((key) => allowed.has(key))
    && nonEmpty(candidate.conversationKey)
    && safeWorkspaceId(candidate.workspaceId)
    && nonEmpty(candidate.authSubjectId)
    && (candidate.sessionKey === undefined || nonEmpty(candidate.sessionKey))
}

function safeWorkspaceId(value: unknown): value is string {
  return nonEmpty(value) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && value !== '.' && value !== '..'
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
