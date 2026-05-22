import type { BoringPluginAssetManager } from "./manager"

/**
 * Concatenates the `pi.systemPrompt` from every currently loaded boring
 * plugin into a single block, prefixed by a stable header. Returns
 * `undefined` when no plugin contributes a prompt so the harness can skip
 * the append entirely.
 *
 * The harness calls this on every prompt rebuild — Pi calls it from
 * `before_agent_start`, which `piSession.reload()` re-fires. Live plugin
 * additions/removals therefore land on the next agent turn without any
 * workspace-injected harness extension.
 */
export function aggregatePluginPrompts(
  manager: BoringPluginAssetManager,
): string | undefined {
  const prompts = manager
    .list()
    .map((plugin) => plugin.pi?.systemPrompt?.trim())
    .filter((prompt): prompt is string => Boolean(prompt))
  if (prompts.length === 0) return undefined
  return `# Loaded boring-ui plugin context\n\n${prompts.join("\n\n")}`
}
