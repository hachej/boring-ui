const STORAGE_MODEL_KEY = 'boring-agent:composer:model'
const STORAGE_MODEL_USER_KEY = 'boring-agent:composer:model:user-selected'
const STORAGE_THINKING_KEY = 'boring-agent:composer:thinking'
const STORAGE_SHOW_THOUGHTS_KEY = 'boring-agent:composer:show-thoughts'

/**
 * Extended-thinking budget. Sent through the agent runtime to providers that
 * support reasoning controls. 'off' means no reasoning chunks; the higher
 * tiers progressively allow more think-time.
 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export const DEFAULT_THINKING: ThinkingLevel = 'off'
export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high']

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
}

export function readStoredThinking(): ThinkingLevel {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_THINKING_KEY)
    if (isThinkingLevel(raw)) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_THINKING
}

export function writeStoredThinking(value: ThinkingLevel): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_THINKING_KEY, value)
  } catch { /* storage unavailable */ }
}

export function readStoredShowThoughts(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_SHOW_THOUGHTS_KEY) === '1'
  } catch { /* storage unavailable */ }
  return false
}

export function writeStoredShowThoughts(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_SHOW_THOUGHTS_KEY, value ? '1' : '0')
  } catch { /* storage unavailable */ }
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

export function modelPayload(model: ModelSelection | null): { model?: ModelSelection } {
  return model ? { model } : {}
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

function readStoredModel(): ModelSelection | null {
  try {
    return parseModelSelection(globalThis.localStorage?.getItem(STORAGE_MODEL_KEY))
  } catch { /* storage unavailable */ }
  return null
}

export function readStoredModelState(): { model: ModelSelection | null; userSelected: boolean } {
  const model = readStoredModel()
  let userSelected = false
  try {
    userSelected = globalThis.localStorage?.getItem(STORAGE_MODEL_USER_KEY) === '1'
  } catch { /* storage unavailable */ }
  return {
    // Only an explicit user-selection marker makes a stored model authoritative.
    // App defaults must come from props or /api/v1/agent/models.defaultModel;
    // otherwise child apps that seed localStorage can silently override the
    // composer after the user picks a different provider.
    model: userSelected ? model : null,
    userSelected,
  }
}

export function writeStoredModelSelection(model: ModelSelection): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_MODEL_KEY, JSON.stringify(model))
    globalThis.localStorage?.setItem(STORAGE_MODEL_USER_KEY, '1')
  } catch { /* storage unavailable */ }
}

export function clearStoredModelSelection(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_MODEL_KEY)
    globalThis.localStorage?.removeItem(STORAGE_MODEL_USER_KEY)
  } catch { /* storage unavailable */ }
}

export function encodeModelKey(sel: ModelSelection): string {
  return `${sel.provider}:${sel.id}`
}

export function decodeModelKey(key: string): ModelSelection | null {
  const idx = key.indexOf(':')
  if (idx < 0) return null
  return { provider: key.slice(0, idx), id: key.slice(idx + 1) }
}
