/**
 * Extended-thinking budget. Sent through the agent runtime to providers that
 * support reasoning controls. 'off' means no reasoning chunks; the higher
 * tiers progressively allow more think-time.
 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export const DEFAULT_THINKING: ThinkingLevel = 'medium'
export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high']

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
}

/**
 * Selected model, stored as { provider, id } so the composer can pass through
 * the agent runtime's registered model IDs rather than a local alias table.
 * Unqualified legacy aliases are ignored: Boring must not infer a provider
 * when the runtime owns model selection.
 */
export interface ModelSelection {
  provider: string
  id: string
}

export interface AvailableModel extends ModelSelection {
  label: string
  available: boolean
}

export function parseModelSelection(value: unknown): ModelSelection | null {
  if (typeof value === 'object' && value !== null) {
    const parsed = value as Partial<ModelSelection>
    return typeof parsed.provider === 'string' && typeof parsed.id === 'string'
      ? { provider: parsed.provider, id: parsed.id }
      : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) {
    try {
      return parseModelSelection(JSON.parse(trimmed))
    } catch {
      return null
    }
  }
  const idx = trimmed.indexOf(':')
  return idx > 0 && idx < trimmed.length - 1
    ? { provider: trimmed.slice(0, idx), id: trimmed.slice(idx + 1) }
    : null
}

export function encodeModelKey(sel: ModelSelection): string {
  return `${sel.provider}:${sel.id}`
}
