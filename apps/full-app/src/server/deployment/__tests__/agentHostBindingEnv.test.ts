import { describe, expect, it } from 'vitest'

import { renderAgentHostBindingEnv, validateAgentHostBindingEnv } from '../agentHostBindingEnv.js'
import { AgentHostErrorCode, type AgentHostSiteBindingV1 } from '../agentHostPlan.js'

const binding: AgentHostSiteBindingV1 = {
  bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle', deploymentRef: 'deployment',
  workspaceAllocationRef: 'workspace-allocation', sessionAllocationRef: 'session-allocation',
  ownerPrincipalRef: 'owner', landing: { title: 'Insurance', summary: 'Compare policies.' },
  environmentRef: 'production', secretRefs: ['credential-ref'],
}
const canonical = [
  'BORING_AGENT_HOST_BINDING_ENV_SCHEMA=1',
  'BORING_AGENT_HOST_BINDING_ID=insurance',
  'BORING_AGENT_HOST_ENVIRONMENT_REF=production',
  'BORING_AGENT_HOST_WORKSPACE_ALLOCATION_REF=workspace-allocation',
  'BORING_AGENT_HOST_SESSION_ALLOCATION_REF=session-allocation',
].join('\n') + '\n'

describe('AgentHost binding env projection', () => {
  it('renders exact stable LF-terminated bytes independent of object property order', () => {
    expect(renderAgentHostBindingEnv(binding)).toBe(canonical)
    expect(renderAgentHostBindingEnv({ ...binding, environmentRef: binding.environmentRef })).toBe(canonical)
    expect(() => validateAgentHostBindingEnv(canonical, binding)).not.toThrow()
  })

  it.each([
    ['reordered', canonical.split('\n').slice(0, -1).reverse().join('\n') + '\n'],
    ['duplicate', canonical + 'BORING_AGENT_HOST_BINDING_ID=insurance\n'],
    ['comment', `# generated\n${canonical}`],
    ['quoted', canonical.replace('=insurance\n', '="insurance"\n')],
    ['CRLF', canonical.replaceAll('\n', '\r\n')],
    ['missing final LF', canonical.slice(0, -1)],
    ['missing key', canonical.replace('BORING_AGENT_HOST_ENVIRONMENT_REF=production\n', '')],
    ['changed value', canonical.replace('=production\n', '=staging\n')],
    ['extra key', `${canonical}CANARY=/srv/private/raw-system-prompt\n`],
  ])('rejects %s with a field-only error', (_name, content) => {
    try {
      validateAgentHostBindingEnv(content, binding)
      throw new Error('expected binding env rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'bindingEnv' } })
      expect(JSON.stringify(error)).not.toMatch(/CANARY|private|prompt|insurance/)
    }
  })
})
