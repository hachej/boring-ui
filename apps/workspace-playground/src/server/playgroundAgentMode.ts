export type PlaygroundAgentMode = "scripted-single" | "scripted-multi" | "factory"

export function resolvePlaygroundAgentMode(
  env: Readonly<Record<string, string | undefined>>,
): PlaygroundAgentMode {
  if (env.VITE_BORING_FACTORY_AGENTS === "1") return "factory"
  if (env.BORING_AGENT_E2E_SCRIPTED_PI === "1") return "scripted-multi"
  return "scripted-single"
}
