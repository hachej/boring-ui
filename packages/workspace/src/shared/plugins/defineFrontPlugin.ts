import type { PluginOutput } from "./types"

// Internal IR. Plugin authors write front plugins with
// `definePlugin({ id, ... })`; the capturing API translates each
// declarative field / `api.register*` call into a normalized PluginOutput
// in `outputs`. This IR is the result of `boringFrontFactoryToPlugin`.
export interface WorkspaceFrontPlugin {
  id: string
  label?: string
  outputs: PluginOutput[]
}

export type PluginErrorKind = "validation" | "duplicate-id" | "runtime"

export class PluginError extends Error {
  constructor(
    public readonly kind: PluginErrorKind,
    message: string,
  ) {
    super(message)
  }
}

const VALID_OUTPUT_TYPES = new Set([
  "left-tab",
  "panel",
  "command",
  "catalog",
  "binding",
  "provider",
  "surface-resolver",
])

function fail(pluginId: string, msg: string): never {
  throw new PluginError("validation", `plugin "${pluginId}": ${msg}`)
}

export function defineFrontPlugin(spec: WorkspaceFrontPlugin): WorkspaceFrontPlugin {
  if (!spec.id || typeof spec.id !== "string") {
    fail(spec.id ?? "<unknown>", "id must be a non-empty string")
  }
  for (let i = 0; i < (spec.outputs ?? []).length; i++) {
    const output = spec.outputs[i]
    if (!output || typeof output !== "object" || !VALID_OUTPUT_TYPES.has(output.type)) {
      fail(spec.id, `outputs[${i}] must be a valid PluginOutput (got: ${JSON.stringify(output)})`)
    }
  }
  return { id: spec.id, ...(spec.label !== undefined ? { label: spec.label } : {}), outputs: spec.outputs ?? [] }
}
