import type { CoreWhatsAppChannelOptions } from '@hachej/boring-core/app/server'

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
  if (env.BORING_AGENT_CHANNELS !== '1') return undefined

  const missing = REQUIRED_CREDENTIALS.filter((name) => !env[name]?.trim())
  if (missing.length > 0) throw new Error(`WhatsApp channel credentials missing: ${missing.join(', ')}`)
  const bindings = parseBindings(env.BORING_WHATSAPP_BINDINGS_JSON)

  return {
    agentTypeId: env.BORING_WHATSAPP_AGENT_TYPE_ID?.trim() || defaultAgentTypeId,
    provisionedBindings: bindings,
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
    && nonEmpty(candidate.workspaceId)
    && nonEmpty(candidate.authSubjectId)
    && (candidate.sessionKey === undefined || nonEmpty(candidate.sessionKey))
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
