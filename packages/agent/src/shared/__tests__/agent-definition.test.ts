import { describe, expect, it } from 'vitest'

import {
  AgentDefinitionValidationError,
  createAgentDefinitionDigest,
  createAgentDeploymentDigest,
  validateAgentDefinition,
  validateAgentDeployment,
  type AgentDefinition,
  type AgentDeployment,
  type Sha256Digest,
} from '../agent-definition'

const INSTRUCTIONS_DIGEST =
  'sha256:b7f7ddeb87b6f58b8144f548b6f84b352e3c3d3119eeae54495b4798ba3871f8' as Sha256Digest
const SKILL_DIGEST =
  'sha256:2d3aac943d4ab6c938352af6ffb4f0ffbc4f0901abf7c58aadb534301f6c3419' as Sha256Digest
const CHANGED_INSTRUCTIONS_DIGEST =
  'sha256:46bde421fed6b1f6c50833a908a3b75d439a189ea61e6fcf868f2609375c52d9' as Sha256Digest

const definition: AgentDefinition = {
  schemaVersion: 1,
  definitionId: 'insurance-comparison',
  version: '1.0.0',
  label: 'Insurance comparison',
  instructionsRef: 'instructions.md',
  capabilityRequirements: ['filesystem:read'],
  toolRefs: ['quotes.compare'],
  skillRefs: ['insurance-analysis'],
  mcpServerRefs: ['policy-catalog'],
}

const deployment: AgentDeployment = {
  deploymentId: 'insurance-comparison-eu',
  version: '1.0.0',
  agentId: 'default',
  definition: {
    definitionId: definition.definitionId,
    version: definition.version,
    digest: `sha256:${'2'.repeat(64)}`,
  },
}

describe('validateAgentDefinition', () => {
  it('accepts the behavior-only v1 definition', () => {
    expect(validateAgentDefinition(definition)).toEqual({
      valid: true,
      value: definition,
    })
  })

  it('accepts valid emoji in identity and display strings', () => {
    expect(validateAgentDefinition({
      ...definition,
      definitionId: 'insurance-🛡️',
      label: 'Insurance comparison 🛡️',
      instructionsRef: 'instructions-🛡️.md',
    }).valid).toBe(true)
    expect(validateAgentDeployment({
      ...deployment,
      agentId: 'default-🤖',
    }).valid).toBe(true)
  })

  it.each([
    ['definitionId', `agent-${String.fromCharCode(0xd800)}`],
    ['label', `Agent ${String.fromCharCode(0xdc00)}`],
    ['instructionsRef', `instructions-${String.fromCharCode(0xd800)}.md`],
  ])('rejects unpaired surrogate in %s', (field, value) => {
    const result = validateAgentDefinition({ ...definition, [field]: value })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues[0]).toMatchObject({
        code: 'AGENT_DEFINITION_INVALID',
        field,
      })
    }
  })

  it.each(['pluginRefs', 'plugins', 'systemPromptFragmentRefs'])(
    'rejects unsupported v1 field %s with the stable code',
    (field) => {
      const result = validateAgentDefinition({ ...definition, [field]: ['value'] })
      expect(result).toEqual({
        valid: false,
        issues: [{
          code: 'AGENT_DEFINITION_UNSUPPORTED_FIELD',
          field,
          message: `${field} is not supported by schema version 1`,
        }],
      })
    },
  )

  it('rejects deployment authority fields and unknown fields', () => {
    const result = validateAgentDefinition({
      ...definition,
      environmentAttachmentRefs: ['user-workspace'],
      runtimeProfileRef: 'eu-runsc',
      governancePolicyRef: 'insurance-governance',
      hostname: 'insurance-comparison.senecapp.ai',
    })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues.map(({ code, field }) => ({ code, field }))).toEqual([
      { code: 'AGENT_DEFINITION_UNSUPPORTED_FIELD', field: 'environmentAttachmentRefs' },
      { code: 'AGENT_DEFINITION_UNSUPPORTED_FIELD', field: 'governancePolicyRef' },
      { code: 'AGENT_DEFINITION_UNSUPPORTED_FIELD', field: 'hostname' },
      { code: 'AGENT_DEFINITION_UNSUPPORTED_FIELD', field: 'runtimeProfileRef' },
    ])
  })

  it.each([
    './instructions.md',
    '/instructions.md',
    'C:/instructions.md',
    'docs\\instructions.md',
    'docs//instructions.md',
    'docs/./instructions.md',
    'docs/../instructions.md',
    'docs/instructions.md/',
    'docs/\u0000instructions.md',
  ])('rejects non-canonical instructions path %j', (instructionsRef) => {
    const result = validateAgentDefinition({ ...definition, instructionsRef })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues[0]).toMatchObject({
        code: 'AGENT_DEFINITION_INVALID',
        field: 'instructionsRef',
      })
    }
  })
})

describe('validateAgentDeployment', () => {
  it('accepts only deployment identity and a pinned definition reference', () => {
    const result = validateAgentDeployment(deployment)
    expect(result).toEqual({ valid: true, value: deployment })
  })

  it.each([
    'environmentAttachmentRefs',
    'runtimeProfileRef',
    'modelPolicyRef',
    'sandboxPolicyRef',
    'governancePolicyRef',
    'hostname',
  ])('rejects workspace/runtime/policy field %s', (field) => {
    expect(validateAgentDeployment({ ...deployment, [field]: 'unsupported' })).toEqual({
      valid: false,
      issues: [{
        code: 'AGENT_DEPLOYMENT_UNSUPPORTED_FIELD',
        field,
        message: `${field} is not supported by schema version 1`,
      }],
    })
  })

  it('reports unknown fields inside the pinned definition reference', () => {
    expect(validateAgentDeployment({
      ...deployment,
      definition: { ...deployment.definition, runtimeProfileRef: 'eu-runsc' },
    })).toEqual({
      valid: false,
      issues: [{
        code: 'AGENT_DEPLOYMENT_UNSUPPORTED_FIELD',
        field: 'definition.runtimeProfileRef',
        message: 'runtimeProfileRef is not supported by schema version 1',
      }],
    })
  })

  it('rejects unpaired surrogates in deployment references', () => {
    const result = validateAgentDeployment({
      ...deployment,
      definition: {
        ...deployment.definition,
        version: `1.0.${String.fromCharCode(0xdc00)}`,
      },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues[0]).toMatchObject({
        code: 'AGENT_DEPLOYMENT_INVALID',
        field: 'definition.version',
      })
    }
  })
})

describe('canonical digests', () => {
  it('covers definition data and verified instruction assets independent of asset order', async () => {
    const instructions = {
      path: 'instructions.md',
      digest: INSTRUCTIONS_DIGEST,
      content: 'Compare insurance policies.',
    }
    const skill = {
      path: 'skills/insurance-analysis.md',
      digest: SKILL_DIGEST,
      content: 'Analyze exclusions.',
    }
    const first = await createAgentDefinitionDigest({
      definition,
      assets: [instructions, skill],
    })
    const reordered = await createAgentDefinitionDigest({
      definition,
      assets: [skill, instructions],
    })
    const changed = await createAgentDefinitionDigest({
      definition,
      assets: [{
        ...instructions,
        digest: CHANGED_INSTRUCTIONS_DIGEST,
        content: 'Changed instructions.',
      }, skill],
    })

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(reordered).toBe(first)
    expect(changed).not.toBe(first)
  })

  it('rejects producer metadata outside the verified asset contract', async () => {
    const assetWithProducerMetadata = {
      path: 'instructions.md',
      digest: INSTRUCTIONS_DIGEST,
      content: 'Compare insurance policies.',
      sourcePath: '/tmp/authoring/instructions.md',
    }
    await expect(createAgentDefinitionDigest({
      definition,
      assets: [assetWithProducerMetadata],
    })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'assets[0].sourcePath',
      validationCode: 'AGENT_DEFINITION_UNSUPPORTED_FIELD',
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it.each([null, {}])('rejects non-array assets input %#', async (assets) => {
    await expect(createAgentDefinitionDigest({
      definition,
      assets: assets as never,
    })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: 'CONFIG_INVALID',
      field: 'assets',
      validationCode: 'AGENT_DEFINITION_INVALID',
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('rejects unpaired surrogates in verified asset content', async () => {
    await expect(createAgentDefinitionDigest({
      definition,
      assets: [{
        path: 'instructions.md',
        digest: INSTRUCTIONS_DIGEST,
        content: `Compare ${String.fromCharCode(0xd800)} policies.`,
      }],
    })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'assets[0].content',
      validationCode: 'AGENT_DEFINITION_INVALID',
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it.each([
    './instructions.md',
    'instructions.md/',
    'docs//instructions.md',
    'docs/\u0000instructions.md',
    `docs/${String.fromCharCode(0xd800)}instructions.md`,
  ])('rejects non-canonical verified asset path %j', async (path) => {
    await expect(createAgentDefinitionDigest({
      definition,
      assets: [{
        path,
        digest: INSTRUCTIONS_DIGEST,
        content: 'Compare insurance policies.',
      }],
    })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'assets[0].path',
      validationCode: 'AGENT_DEFINITION_INVALID',
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('requires instructionsRef to name an included asset', async () => {
    await expect(createAgentDefinitionDigest({ definition, assets: [] })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: 'CONFIG_INVALID',
      field: 'instructionsRef',
      validationCode: 'AGENT_DEFINITION_INVALID',
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('rejects an asset digest that does not match its UTF-8 content', async () => {
    await expect(createAgentDefinitionDigest({
      definition,
      assets: [{
        path: 'instructions.md',
        digest: `sha256:${'0'.repeat(64)}`,
        content: 'Compare insurance policies.',
      }],
    })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: 'CONFIG_INVALID',
      field: 'assets.digest',
      validationCode: 'AGENT_DEFINITION_INVALID',
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('hashes the canonical deployment identity', async () => {
    const first = await createAgentDeploymentDigest(deployment)
    const changed = await createAgentDeploymentDigest({
      ...deployment,
      agentId: 'other-agent',
    })

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(changed).not.toBe(first)
  })
})
