import { parseEnv } from 'node:util'

import { invalidD1Field, type D1SiteBindingV1 } from './d1Plan.js'

const BINDING_ENV_KEYS = [
  'BORING_D1_BINDING_ENV_SCHEMA',
  'BORING_D1_BINDING_ID',
  'BORING_D1_ENVIRONMENT_REF',
  'BORING_D1_WORKSPACE_ALLOCATION_REF',
  'BORING_D1_SESSION_ALLOCATION_REF',
] as const

export function renderD1BindingEnv(binding: D1SiteBindingV1): string {
  return [
    'BORING_D1_BINDING_ENV_SCHEMA=1',
    `BORING_D1_BINDING_ID=${binding.bindingId}`,
    `BORING_D1_ENVIRONMENT_REF=${binding.environmentRef}`,
    `BORING_D1_WORKSPACE_ALLOCATION_REF=${binding.workspaceAllocationRef}`,
    `BORING_D1_SESSION_ALLOCATION_REF=${binding.sessionAllocationRef}`,
  ].join('\n') + '\n'
}

export function validateD1BindingEnv(content: string, binding: D1SiteBindingV1): void {
  let parsed: NodeJS.Dict<string>
  try { parsed = parseEnv(content) } catch { invalidD1Field('bindingEnv') }
  const canonical = renderD1BindingEnv(binding)
  const expected = parseEnv(canonical)
  if (Object.keys(parsed).length !== BINDING_ENV_KEYS.length
    || BINDING_ENV_KEYS.some((key) => parsed[key] !== expected[key])
    || content !== canonical) invalidD1Field('bindingEnv')
}
