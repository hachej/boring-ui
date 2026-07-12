import { describe, expect, it } from 'vitest'

import { renderD1BindingEnv, validateD1BindingEnv } from '../d1BindingEnv.js'
import { D1HostErrorCode, type D1SiteBindingV1 } from '../d1Plan.js'

const binding: D1SiteBindingV1 = {
  bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle', deploymentRef: 'deployment',
  workspaceAllocationRef: 'workspace-allocation', sessionAllocationRef: 'session-allocation',
  ownerPrincipalRef: 'owner', landing: { title: 'Insurance', summary: 'Compare policies.' },
  environmentRef: 'production', secretRefs: ['credential-ref'],
}
const canonical = [
  'BORING_D1_BINDING_ENV_SCHEMA=1',
  'BORING_D1_BINDING_ID=insurance',
  'BORING_D1_ENVIRONMENT_REF=production',
  'BORING_D1_WORKSPACE_ALLOCATION_REF=workspace-allocation',
  'BORING_D1_SESSION_ALLOCATION_REF=session-allocation',
].join('\n') + '\n'

describe('D1 binding env projection', () => {
  it('renders exact stable LF-terminated bytes independent of object property order', () => {
    expect(renderD1BindingEnv(binding)).toBe(canonical)
    expect(renderD1BindingEnv({ ...binding, environmentRef: binding.environmentRef })).toBe(canonical)
    expect(() => validateD1BindingEnv(canonical, binding)).not.toThrow()
  })

  it.each([
    ['reordered', canonical.split('\n').slice(0, -1).reverse().join('\n') + '\n'],
    ['duplicate', canonical + 'BORING_D1_BINDING_ID=insurance\n'],
    ['comment', `# generated\n${canonical}`],
    ['quoted', canonical.replace('=insurance\n', '="insurance"\n')],
    ['CRLF', canonical.replaceAll('\n', '\r\n')],
    ['missing final LF', canonical.slice(0, -1)],
    ['missing key', canonical.replace('BORING_D1_ENVIRONMENT_REF=production\n', '')],
    ['changed value', canonical.replace('=production\n', '=staging\n')],
    ['extra key', `${canonical}CANARY=/srv/private/raw-system-prompt\n`],
  ])('rejects %s with a field-only error', (_name, content) => {
    try {
      validateD1BindingEnv(content, binding)
      throw new Error('expected binding env rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: D1HostErrorCode.PLAN_INVALID, details: { field: 'bindingEnv' } })
      expect(JSON.stringify(error)).not.toMatch(/CANARY|private|prompt|insurance/)
    }
  })
})
