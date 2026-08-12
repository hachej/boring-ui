export const BUILTIN_RUNTIME_MODE_IDS = [
  'direct',
  'local',
  'blaxel',
  'vercel-sandbox',
] as const

export type BuiltinRuntimeModeId = (typeof BUILTIN_RUNTIME_MODE_IDS)[number]

export function isBuiltinRuntimeModeId(value: string): value is BuiltinRuntimeModeId {
  return BUILTIN_RUNTIME_MODE_IDS.some((mode) => mode === value)
}
