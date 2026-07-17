import { parseEnv } from 'node:util'

import { invalidAgentHostField, type AgentHostSiteBindingV1 } from './agentHostPlan.js'

const BINDING_ENV_KEYS = [
  'BORING_AGENT_HOST_BINDING_ENV_SCHEMA',
  'BORING_AGENT_HOST_BINDING_ID',
  'BORING_AGENT_HOST_ENVIRONMENT_REF',
  'BORING_AGENT_HOST_WORKSPACE_ALLOCATION_REF',
  'BORING_AGENT_HOST_SESSION_ALLOCATION_REF',
] as const

export function renderAgentHostBindingEnv(binding: AgentHostSiteBindingV1): string {
  return [
    'BORING_AGENT_HOST_BINDING_ENV_SCHEMA=1',
    `BORING_AGENT_HOST_BINDING_ID=${binding.bindingId}`,
    `BORING_AGENT_HOST_ENVIRONMENT_REF=${binding.environmentRef}`,
    `BORING_AGENT_HOST_WORKSPACE_ALLOCATION_REF=${binding.workspaceAllocationRef}`,
    `BORING_AGENT_HOST_SESSION_ALLOCATION_REF=${binding.sessionAllocationRef}`,
  ].join('\n') + '\n'
}

export function validateAgentHostBindingEnv(content: string, binding: AgentHostSiteBindingV1): void {
  let parsed: NodeJS.Dict<string>
  try { parsed = parseEnv(content) } catch { invalidAgentHostField('bindingEnv') }
  const canonical = renderAgentHostBindingEnv(binding)
  const expected = parseEnv(canonical)
  if (Object.keys(parsed).length !== BINDING_ENV_KEYS.length
    || BINDING_ENV_KEYS.some((key) => parsed[key] !== expected[key])
    || content !== canonical) invalidAgentHostField('bindingEnv')
}
