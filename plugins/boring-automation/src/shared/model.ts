export interface AutomationModelRef {
  provider: string
  id: string
}

/** Canonical provider:model-id parser shared by browser admission and dispatch. */
export function parseAutomationModelRef(value: string): AutomationModelRef | null {
  const separator = value.indexOf(":")
  if (separator <= 0 || separator >= value.length - 1) return null
  const provider = value.slice(0, separator).trim()
  const id = value.slice(separator + 1).trim()
  return provider && id ? { provider, id } : null
}
