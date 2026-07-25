import { describe, expect, it } from 'vitest'

import {
  AgentDefinitionValidationError,
  AgentDeploymentValidationError,
  createAgentAssetDigest,
  createAgentDefinitionDigest,
  type AgentDefinition,
  type AgentDeployment,
  type CompiledAgentBundle,
  type Sha256Digest,
} from '../../../shared/agent-definition'
import {
  AgentDefinitionErrorCode,
  AgentDeploymentErrorCode,
  ErrorCode,
} from '../../../shared/error-codes'
import { createResolvedAgentDigest, resolveAgentDeployment } from '../resolveAgentDeployment'

const COMPOSITION_DIGEST = `sha256:${'c'.repeat(64)}` as Sha256Digest
const CHANGED_COMPOSITION_DIGEST = `sha256:${'d'.repeat(64)}` as Sha256Digest

const definition: AgentDefinition = {
  schemaVersion: 1,
  definitionId: 'insurance-comparison',
  version: '1.0.0',
  description: 'Compares insurance policies.',
  instructionsRef: 'instructions.md',
}

async function makeBundle(): Promise<CompiledAgentBundle> {
  const asset = Object.freeze({
    path: 'instructions.md',
    digest: await createAgentAssetDigest('Compare insurance policies.'),
    content: 'Compare insurance policies.',
  })
  const assets = Object.freeze([asset])
  const frozenDefinition = Object.freeze({ ...definition })
  return Object.freeze({
    definition: frozenDefinition,
    definitionDigest: await createAgentDefinitionDigest({
      definition: frozenDefinition,
      assets,
    }),
    assets,
  })
}

function makeDeployment(bundle: CompiledAgentBundle): AgentDeployment {
  return {
    deploymentId: 'insurance-comparison-eu',
    version: '2026.07.11',
    agentId: 'default',
    definition: {
      definitionId: bundle.definition.definitionId,
      version: bundle.definition.version,
      digest: bundle.definitionDigest,
    },
  }
}

function binding(overrides: Record<string, unknown> = {}): unknown {
  return {
    workspaceId: 'insurance-client-a',
    defaultDeploymentId: 'insurance-comparison-eu',
    workspaceCompositionDigest: COMPOSITION_DIGEST,
    ...overrides,
  }
}

const definitionError = (field: string) => ({
  name: 'AgentDefinitionValidationError',
  code: ErrorCode.enum.CONFIG_INVALID,
  field,
  validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
}) satisfies Partial<AgentDefinitionValidationError>

const deploymentError = (field: string) => ({
  name: 'AgentDeploymentValidationError',
  code: ErrorCode.enum.CONFIG_INVALID,
  field,
  validationCode: AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_INVALID,
}) satisfies Partial<AgentDeploymentValidationError>

describe('resolveAgentDeployment', () => {
  it('returns a deterministic deeply immutable resolved agent', async () => {
    const bundle = await makeBundle()
    const deployment = makeDeployment(bundle)

    const first = await resolveAgentDeployment(bundle, deployment, binding())
    const repeated = await resolveAgentDeployment(bundle, deployment, binding())

    expect(repeated).toEqual(first)
    expect(first).toMatchObject({
      workspace: {
        workspaceId: 'insurance-client-a',
        defaultDeploymentId: deployment.deploymentId,
        compositionDigest: COMPOSITION_DIGEST,
      },
      deployment: {
        deploymentId: deployment.deploymentId,
        version: deployment.version,
        agentId: 'default',
      },
      definition: {
        definitionId: definition.definitionId,
        version: definition.version,
        digest: bundle.definitionDigest,
        instructionsRef: definition.instructionsRef,
      },
      instructions: {
        ref: definition.instructionsRef,
        content: 'Compare insurance policies.',
      },
    })
    expect(first.resolvedDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.resolvedDigest).toBe(await createResolvedAgentDigest({
      workspaceId: first.workspace.workspaceId,
      defaultDeploymentId: first.workspace.defaultDeploymentId,
      workspaceCompositionDigest: first.workspace.compositionDigest,
      definitionDigest: first.definition.digest,
      deploymentDigest: first.deployment.digest,
    }))
    expect(first.deployment.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.workspace)).toBe(true)
    expect(Object.isFrozen(first.deployment)).toBe(true)
    expect(Object.isFrozen(first.definition)).toBe(true)
    expect(Object.isFrozen(first.instructions)).toBe(true)
  })

  it('changes only composition identity and resolved digest when composition changes', async () => {
    const bundle = await makeBundle()
    const deployment = makeDeployment(bundle)
    const first = await resolveAgentDeployment(bundle, deployment, binding())
    const changed = await resolveAgentDeployment(bundle, deployment, binding({
      workspaceCompositionDigest: CHANGED_COMPOSITION_DIGEST,
    }))

    expect(changed.workspace).toEqual({
      ...first.workspace,
      compositionDigest: CHANGED_COMPOSITION_DIGEST,
    })
    expect(changed.definition).toEqual(first.definition)
    expect(changed.deployment).toEqual(first.deployment)
    expect(changed.instructions).toEqual(first.instructions)
    expect(changed.resolvedDigest).not.toBe(first.resolvedDigest)
  })

  it('resolves independent bindings without shared object state', async () => {
    const bundle = await makeBundle()
    const deployment = makeDeployment(bundle)
    const first = await resolveAgentDeployment(bundle, deployment, binding())
    const second = await resolveAgentDeployment(bundle, deployment, binding({
      workspaceId: 'insurance-client-b',
    }))

    expect(second.workspace.workspaceId).toBe('insurance-client-b')
    expect(second.resolvedDigest).not.toBe(first.resolvedDigest)
    expect(second).not.toBe(first)
    expect(second.workspace).not.toBe(first.workspace)
    expect(second.deployment).not.toBe(first.deployment)
    expect(second.definition).not.toBe(first.definition)
    expect(second.instructions).not.toBe(first.instructions)
  })

  it('rejects a bundle whose stored definition digest does not match verified content', async () => {
    const bundle = await makeBundle()
    const tamperedBundle = {
      ...bundle,
      definitionDigest: `sha256:${'f'.repeat(64)}` as Sha256Digest,
    }

    await expect(resolveAgentDeployment(
      tamperedBundle,
      makeDeployment(tamperedBundle),
      binding(),
    )).rejects.toMatchObject(definitionError('definitionDigest'))
  })

  it('re-verifies immutable asset content before resolving', async () => {
    const bundle = await makeBundle()
    const tamperedBundle = {
      ...bundle,
      assets: Object.freeze([Object.freeze({
        ...bundle.assets[0],
        content: 'Tampered instructions.',
      })]),
    }

    await expect(resolveAgentDeployment(
      tamperedBundle,
      makeDeployment(bundle),
      binding(),
    )).rejects.toMatchObject(definitionError('assets.digest'))
  })

  it('rejects missing referenced instructions with the definition error contract', async () => {
    const bundle = await makeBundle()
    const missingInstructions = {
      ...bundle,
      assets: Object.freeze([]),
    }

    await expect(resolveAgentDeployment(
      missingInstructions,
      makeDeployment(bundle),
      binding(),
    )).rejects.toMatchObject(definitionError('instructionsRef'))
  })

  it.each([
    ['definition.definitionId', (deployment: AgentDeployment) => ({
      ...deployment,
      definition: { ...deployment.definition, definitionId: 'other-definition' },
    })],
    ['definition.version', (deployment: AgentDeployment) => ({
      ...deployment,
      definition: { ...deployment.definition, version: '2.0.0' },
    })],
    ['definition.digest', (deployment: AgentDeployment) => ({
      ...deployment,
      definition: {
        ...deployment.definition,
        digest: `sha256:${'e'.repeat(64)}` as Sha256Digest,
      },
    })],
    ['agentId', (deployment: AgentDeployment) => ({ ...deployment, agentId: 'alternate' })],
  ] as const)('rejects cross-object mismatch at %s', async (field, change) => {
    const bundle = await makeBundle()

    await expect(resolveAgentDeployment(
      bundle,
      change(makeDeployment(bundle)),
      binding(),
    )).rejects.toMatchObject(deploymentError(field))
  })

  it('rejects a binding that names a different default deployment', async () => {
    const bundle = await makeBundle()

    await expect(resolveAgentDeployment(
      bundle,
      makeDeployment(bundle),
      binding({ defaultDeploymentId: 'other-deployment' }),
    )).rejects.toMatchObject(deploymentError('defaultDeploymentId'))
  })

  it('ignores surface-only binding metadata outside the resolver contract', async () => {
    const bundle = await makeBundle()
    const deployment = makeDeployment(bundle)

    const resolved = await resolveAgentDeployment(bundle, deployment, binding())
    const withHostname = await resolveAgentDeployment(
      bundle,
      deployment,
      binding({ hostname: 'insurance-comparison.senecapp.ai' }),
    )

    expect(withHostname).toEqual(resolved)
    expect(withHostname.resolvedDigest).toBe(resolved.resolvedDigest)
  })

  it('pins resolvedDigest to a golden vector for a fully-fixed fixture (canonicalStringify determinism)', async () => {
    const goldenDefinition: AgentDefinition = {
      schemaVersion: 1,
      definitionId: 'golden-definition',
      version: '1.0.0',
      instructionsRef: 'instructions.md',
    }
    const asset = Object.freeze({
      path: 'instructions.md',
      digest: await createAgentAssetDigest('Golden fixture instructions.'),
      content: 'Golden fixture instructions.',
    })
    const assets = Object.freeze([asset])
    const goldenDefinitionDigest = await createAgentDefinitionDigest({
      definition: goldenDefinition,
      assets,
    })
    const goldenBundle: CompiledAgentBundle = Object.freeze({
      definition: goldenDefinition,
      definitionDigest: goldenDefinitionDigest,
      assets,
    })
    const goldenDeployment: AgentDeployment = {
      deploymentId: 'golden-deployment',
      version: '1.0.0',
      agentId: 'default',
      definition: {
        definitionId: goldenDefinition.definitionId,
        version: goldenDefinition.version,
        digest: goldenDefinitionDigest,
      },
    }
    const goldenBinding = {
      workspaceId: 'golden-workspace',
      defaultDeploymentId: 'golden-deployment',
      workspaceCompositionDigest: `sha256:${'a'.repeat(64)}` as Sha256Digest,
    }

    const resolved = await resolveAgentDeployment(goldenBundle, goldenDeployment, goldenBinding)

    expect(goldenDefinitionDigest).toBe(
      'sha256:f950bf76817802ef360873cac765adb649fb428be432fec601891b620b9593ed',
    )
    expect(resolved.deployment.digest).toBe(
      'sha256:7bdfffa06038715e5a72ee2a2d5407ea75189213c2b59f090cca5c874e852c18',
    )
    expect(resolved.resolvedDigest).toBe(
      'sha256:fac5e93763fadc3a69d8bd53bb84dff2fe975484662cf711b08bc65d0cefa4ce',
    )
  })

  it.each([
    ['workspaceId', ''],
    ['workspaceId', 'a'.repeat(257)],
    ['workspaceId', ' leading-space'],
    ['workspaceId', 'control\u0000character'],
    ['workspaceId', `broken-${String.fromCharCode(0xd800)}`],
    ['defaultDeploymentId', ''],
    ['defaultDeploymentId', 'a'.repeat(257)],
    ['defaultDeploymentId', 'trailing-space '],
    ['defaultDeploymentId', 'control\u007fcharacter'],
    ['defaultDeploymentId', `broken-${String.fromCharCode(0xdc00)}`],
    ['workspaceCompositionDigest', `sha256:${'a'.repeat(63)}`],
    ['workspaceCompositionDigest', `sha256:${'A'.repeat(64)}`],
    ['workspaceCompositionDigest', `sha512:${'a'.repeat(64)}`],
  ])('rejects malformed authorized binding field %s', async (field, value) => {
    const bundle = await makeBundle()

    await expect(resolveAgentDeployment(
      bundle,
      makeDeployment(bundle),
      binding({ [field]: value }),
    )).rejects.toMatchObject(deploymentError(field))
  })
})
