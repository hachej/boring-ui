export const BORING_FACTORY_RESOURCE_CONTRACT_VERSION = 'boring.factory.resources.v1' as const
export const FACTORY_ORCHESTRATOR_AGENT_TYPE_ID = 'boring-orchestrator' as const
export const FACTORY_WORKER_AGENT_TYPE_ID = 'boring-worker' as const
export const FACTORY_REVIEWER_AGENT_TYPE_ID = 'boring-reviewer' as const
export const FACTORY_AGENT_TYPE_IDS = [
  FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
  FACTORY_WORKER_AGENT_TYPE_ID,
  FACTORY_REVIEWER_AGENT_TYPE_ID,
] as const
