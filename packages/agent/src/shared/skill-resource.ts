export const AGENT_RESOURCES_FILESYSTEM_ID = 'agent_resources' as const

export interface AgentSkillResource {
  readonly filesystem: 'user' | typeof AGENT_RESOURCES_FILESYSTEM_ID | (string & {})
  readonly path: string
}
