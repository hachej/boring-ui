export const AGENT_RESOURCES_FILESYSTEM_ID = 'agent_resources' as const

/**
 * Agent-scoped readonly filesystem carrying the knowledge/ folder shipped
 * inside an agent definition package (gh-1107 slice 2). Generic id only —
 * never tenant-named. The binding exists only for the owning agent.
 */
export const AGENT_KNOWLEDGE_FILESYSTEM_ID = 'agent_knowledge' as const

export interface AgentSkillResource {
  readonly filesystem: 'user' | typeof AGENT_RESOURCES_FILESYSTEM_ID | (string & {})
  readonly path: string
}
