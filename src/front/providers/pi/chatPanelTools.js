const ARTIFACT_TOOL_NAME = 'artifacts'

export function getAdditionalChatPanelTools(agent) {
  const tools = Array.isArray(agent?.state?.tools) ? agent.state.tools : []
  return tools.filter((tool) => String(tool?.name || '') !== ARTIFACT_TOOL_NAME)
}
