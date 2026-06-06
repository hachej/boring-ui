import type { UIMessage } from 'ai'
import type { BoringChatMessage, PiChatEvent, PiChatStatus } from '../../shared/chat'
import type { AvailableModel, ThinkingLevel } from '../chatPanelSettings'
import { THINKING_LEVELS } from '../chatPanelSettings'
import type { PluginReloadDiagnostic } from '../composer/PluginUpdateStatus'
import type { PiChatState } from './pi/piChatReducer'

export function normalizeHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  const entries = normalizedHeaderEntries(headers)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export function headersContentKey(headers: Record<string, string | undefined> | undefined): string {
  return JSON.stringify(normalizedHeaderEntries(headers).sort(([a], [b]) => a.localeCompare(b)))
}

export function normalizedHeadersFromContentKey(key: string): Record<string, string> | undefined {
  const entries = JSON.parse(key) as Array<[string, string]>
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizedHeaderEntries(headers: Record<string, string | undefined> | undefined): Array<[string, string]> {
  return Object.entries(headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
}

export function statusForState(state: PiChatState | undefined, sessionsLoading: boolean): PiChatStatus {
  return state?.status ?? (sessionsLoading ? 'hydrating' : 'idle')
}

export function shouldHoldLocalSubmitted(session: { getState(): PiChatState } | undefined, receiptCursor?: number): boolean {
  if (!session) return true
  const state = session.getState()
  if (state.status !== 'idle') return false
  return receiptCursor === undefined || state.lastSeq < receiptCursor
}

export function isPiBusyStatus(status: PiChatStatus): boolean {
  return status === 'submitted' || status === 'streaming' || status === 'aborting'
}

export function toPromptSubmitStatus(status: PiChatStatus): 'ready' | 'submitted' | 'streaming' | 'error' {
  if (status === 'submitted' || status === 'hydrating') return 'submitted'
  if (status === 'streaming' || status === 'aborting') return 'streaming'
  if (status === 'error') return 'error'
  return 'ready'
}

export function resolveModelSlashSelection(query: string, options: AvailableModel[]): AvailableModel | null {
  const available = options.filter((option) => option.available)
  const trimmed = query.trim()
  const index = Number.parseInt(trimmed, 10)
  if (Number.isInteger(index) && String(index) === trimmed && index >= 1 && index <= available.length) {
    return available[index - 1] ?? null
  }

  const exact = available.find((option) => `${option.provider}:${option.id}` === trimmed || option.id === trimmed)
  if (exact) return exact

  const normalized = trimmed.toLowerCase()
  return available.find((option) => {
    const label = option.label?.toLowerCase() ?? ''
    const id = option.id.toLowerCase()
    const provider = option.provider.toLowerCase()
    return label.includes(normalized) || id.includes(normalized) || `${provider}:${id}`.includes(normalized)
  }) ?? null
}

export function resolveThinkingSlashSelection(query: string): ThinkingLevel | null {
  const normalized = query.trim().toLowerCase()
  if (normalized === 'med') return 'medium'
  return THINKING_LEVELS.find((level) => level === normalized) ?? null
}

export function thinkingLabel(level: ThinkingLevel): string {
  if (level === 'off') return 'Off'
  if (level === 'low') return 'Low'
  if (level === 'medium') return 'Med'
  return 'High'
}

export function toDebugUiMessage(message: BoringChatMessage): UIMessage {
  return {
    id: message.id,
    role: message.role === 'system' ? 'assistant' : message.role,
    parts: message.parts.map((part) => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: message.role === 'user' ? '[redacted user message]' : part.text }
      }
      if (part.type === 'file') {
        return {
          type: 'file' as const,
          mediaType: part.mediaType ?? 'application/octet-stream',
          filename: part.filename ? '[redacted attachment filename]' : undefined,
          url: part.url ? '[redacted attachment url]' : '',
        }
      }
      if (part.type === 'reasoning') return { type: 'reasoning' as const, text: '[redacted reasoning]' }
      return { type: 'text' as const, text: part.type === 'notice' ? part.text : `[tool] ${part.toolName}` }
    }),
  } as UIMessage
}

type BrowserPluginReloadParsed =
  | { kind: 'success'; diagnostic: PluginReloadDiagnostic }
  | { kind: 'error'; message: string }

export function parseBrowserPluginReloadDetail(detail: unknown): BrowserPluginReloadParsed | null {
  if (!detail || typeof detail !== 'object') return null
  const record = detail as { type?: unknown; id?: unknown; revision?: unknown; message?: unknown }
  if (typeof record.type !== 'string') return null
  const pluginId = typeof record.id === 'string' ? record.id : undefined
  const revision = typeof record.revision === 'number' ? `revision ${record.revision}` : 'updated'
  switch (record.type) {
    case 'boring.plugin.load':
      return { kind: 'success', diagnostic: { source: 'browser front reload', ...(pluginId ? { pluginId } : {}), message: `front module loaded (${revision})` } }
    case 'boring.plugin.unload':
      return { kind: 'success', diagnostic: { source: 'browser front reload', ...(pluginId ? { pluginId } : {}), message: `front module unloaded (${revision})` } }
    case 'boring.plugin.error':
    case 'boring.plugin.front-error': {
      const message = typeof record.message === 'string' && record.message.length > 0
        ? record.message
        : 'browser front module failed to load'
      return { kind: 'error', message: `Plugin front failed${pluginId ? ` (${pluginId})` : ''}: ${message}. Previous live version was kept.` }
    }
    default:
      return null
  }
}

export function pluginReloadFailureMessage(message: string): string | null {
  const firstLine = message.trim().split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? ''
  if (/^agent plugins reloaded\.?$/i.test(firstLine)) return null
  if (/^agent plugins will reload on the next message\.?$/i.test(firstLine)) return null
  return message
}

export function shouldRefreshSessionListAfterEvent(event: PiChatEvent): boolean {
  return event.type === 'agent-end'
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
