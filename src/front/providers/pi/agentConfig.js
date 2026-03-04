const configState = {
  tools: [],
  systemPrompt: null,
}

const dedupeToolsByName = (tools) => {
  const merged = new Map()
  for (const tool of tools || []) {
    const name = String(tool?.name || '').trim()
    if (!name) continue
    merged.set(name, tool)
  }
  return [...merged.values()]
}

export function getPiAgentConfig() {
  return {
    tools: [...configState.tools],
    systemPrompt: configState.systemPrompt,
  }
}

export function setPiAgentConfig(config = {}) {
  if (Array.isArray(config.tools)) {
    configState.tools = dedupeToolsByName(config.tools)
  }
  if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
    configState.systemPrompt = config.systemPrompt
  }
  return getPiAgentConfig()
}

export function addPiAgentTools(tools = []) {
  if (!Array.isArray(tools) || tools.length === 0) return getPiAgentConfig()
  configState.tools = dedupeToolsByName([...configState.tools, ...tools])
  return getPiAgentConfig()
}

export function resetPiAgentConfig() {
  configState.tools = []
  configState.systemPrompt = null
  return getPiAgentConfig()
}
