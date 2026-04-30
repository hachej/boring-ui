export interface AgentCommandContribution {
  id: string
  title: string
  run: () => void
  keywords?: string[]
  shortcut?: string
  when?: () => boolean
  pluginId?: string
}

export interface AgentCommandOptions {
  focusComposer?: () => void
  newChat?: () => void
  stopGeneration?: () => void
  canStopGeneration?: () => boolean
}

const AGENT_COMMAND_SOURCE = 'agent'

export function getAgentCommands(options: AgentCommandOptions = {}): AgentCommandContribution[] {
  const commands: AgentCommandContribution[] = []

  if (options.focusComposer) {
    commands.push({
      id: 'agent:focus-composer',
      title: 'Focus agent composer',
      keywords: ['agent', 'chat', 'prompt', 'composer', 'input'],
      pluginId: AGENT_COMMAND_SOURCE,
      run: options.focusComposer,
    })
  }

  if (options.newChat) {
    commands.push({
      id: 'agent:new-chat',
      title: 'New agent chat',
      keywords: ['agent', 'chat', 'session', 'new'],
      pluginId: AGENT_COMMAND_SOURCE,
      run: options.newChat,
    })
  }

  if (options.stopGeneration) {
    commands.push({
      id: 'agent:stop-generation',
      title: 'Stop agent generation',
      keywords: ['agent', 'chat', 'stop', 'cancel', 'generation'],
      pluginId: AGENT_COMMAND_SOURCE,
      when: options.canStopGeneration,
      run: options.stopGeneration,
    })
  }

  return commands
}
