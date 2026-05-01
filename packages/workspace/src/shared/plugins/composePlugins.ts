import { defineFrontPlugin } from "./defineFrontPlugin"
import type { WorkspaceFrontPlugin } from "./defineFrontPlugin"
import type { PluginOutput } from "./types"

type OwnedPluginOutput = PluginOutput & { pluginId?: string }

export interface ComposePluginsOptions {
  id: string
  label?: string
  plugins: WorkspaceFrontPlugin[]
  outputs?: PluginOutput[]
  panels?: WorkspaceFrontPlugin["panels"]
  commands?: WorkspaceFrontPlugin["commands"]
  catalogs?: WorkspaceFrontPlugin["catalogs"]
  agentTools?: WorkspaceFrontPlugin["agentTools"]
  systemPrompt?: string
  /**
   * When true (default), child contributions are registered as owned by the
   * composed parent plugin. When false, output contributions carry the child
   * plugin id so bootstrap can preserve child ownership in registries.
   */
  adoptOutputs?: boolean
}

function withOwner<T extends PluginOutput>(
  output: T,
  pluginId: string | undefined,
): T {
  const { pluginId: _oldOwner, ...cleanOutput } = output as OwnedPluginOutput
  if (!pluginId) return cleanOutput as unknown as T
  return { ...cleanOutput, pluginId } as unknown as T
}

function pluginToOutputs(
  plugin: WorkspaceFrontPlugin,
  ownerPluginId: string | undefined,
): PluginOutput[] {
  const outputs: PluginOutput[] = []

  for (const panel of plugin.panels ?? []) {
    outputs.push(withOwner({ type: "panel", panel }, ownerPluginId))
  }
  for (const command of plugin.commands ?? []) {
    outputs.push(withOwner({ type: "command", command }, ownerPluginId))
  }
  for (const catalog of plugin.catalogs ?? []) {
    outputs.push(withOwner({ type: "catalog", catalog }, ownerPluginId))
  }
  for (const tool of plugin.agentTools ?? []) {
    outputs.push(
      withOwner({ type: "agent-tool", id: tool.name, tool }, ownerPluginId),
    )
  }
  for (const output of plugin.outputs ?? []) {
    outputs.push(withOwner(output, ownerPluginId))
  }

  return outputs
}

function compactPrompts(
  prompts: Array<string | undefined>,
): string | undefined {
  const text = prompts
    .map((prompt) => prompt?.trim())
    .filter((prompt): prompt is string => Boolean(prompt))
    .join("\n\n")
  return text || undefined
}

/**
 * Compose a parent plugin from smaller child plugins without introducing a new
 * enhancer/mixin lifecycle. Contributions are flattened into PluginOutput
 * values so normal plugin bootstrap remains the single registration path.
 */
export function composePlugins(options: ComposePluginsOptions): WorkspaceFrontPlugin {
  const adoptOutputs = options.adoptOutputs !== false
  const childOutputs = options.plugins.flatMap((plugin) =>
    pluginToOutputs(plugin, adoptOutputs ? undefined : plugin.id),
  )
  const parentOutputs = pluginToOutputs(
    {
      id: options.id,
      panels: options.panels,
      commands: options.commands,
      catalogs: options.catalogs,
      agentTools: options.agentTools,
      outputs: options.outputs,
    },
    undefined,
  )

  return defineFrontPlugin({
    id: options.id,
    label: options.label,
    systemPrompt: compactPrompts([
      ...options.plugins.map((plugin) => plugin.systemPrompt),
      options.systemPrompt,
    ]),
    outputs: [...childOutputs, ...parentOutputs],
  })
}
