import type { AgentTool } from './tool'

export function validateTool(tool: unknown): AgentTool | null {
  if (typeof tool !== 'object' || tool === null) return null
  const t = tool as Record<string, unknown>
  if (typeof t.name !== 'string' || t.name.length === 0) return null
  if (typeof t.description !== 'string') return null
  if (typeof t.parameters !== 'object' || t.parameters === null) return null
  if (typeof t.execute !== 'function') return null
  return t as unknown as AgentTool
}
