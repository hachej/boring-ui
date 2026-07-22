import { describe, expect, it } from 'vitest'

import {
  AgentDefinitionValidationError,
  OpaqueRefSchema,
  Sha256DigestSchema,
  createAgentAssetDigest,
  createAgentDefinitionDigest,
  createAgentDeploymentDigest,
  validateAgentDefinition,
  validateAgentDeployment,
  type AgentDefinition,
  type AgentDeployment,
  type Sha256Digest,
} from '../agent-definition'
import {
  AgentDefinitionErrorCode,
  AgentDeploymentErrorCode,
  ErrorCode,
} from '../error-codes'

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
  description: 'Compares insurance policies.',
  instructionsRef: 'instructions.md',
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

describe('exported identity validators', () => {
  it('preserves opaque reference length and Unicode rules', () => {
    expect(OpaqueRefSchema.safeParse('a'.repeat(256)).success).toBe(true)
    expect(OpaqueRefSchema.safeParse('a'.repeat(257)).success).toBe(false)
    expect(OpaqueRefSchema.safeParse('agent-🛡️').success).toBe(true)
    expect(OpaqueRefSchema.safeParse(`agent-${String.fromCharCode(0xd800)}`).success).toBe(false)
    expect(OpaqueRefSchema.safeParse(' agent').success).toBe(false)
    expect(OpaqueRefSchema.safeParse('agent\u0000').success).toBe(false)
  })

  it('accepts only canonical lowercase SHA-256 digests', () => {
    expect(Sha256DigestSchema.safeParse(`sha256:${'a'.repeat(64)}`).success).toBe(true)
    expect(Sha256DigestSchema.safeParse(`sha256:${'A'.repeat(64)}`).success).toBe(false)
    expect(Sha256DigestSchema.safeParse(`sha256:${'a'.repeat(63)}`).success).toBe(false)
    expect(Sha256DigestSchema.safeParse(`sha512:${'a'.repeat(64)}`).success).toBe(false)
  })
})

describe('validateAgentDefinition', () => {
  it('accepts the declarative-only v1 definition', () => {
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
      description: 'Compares coverage 🛡️',
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
    ['description', `Description ${String.fromCharCode(0xdc00)}`],
    ['instructionsRef', `instructions-${String.fromCharCode(0xd800)}.md`],
  ])('rejects unpaired surrogate in %s', (field, value) => {
    const result = validateAgentDefinition({ ...definition, [field]: value })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues[0]).toMatchObject({
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
        field,
      })
    }
  })

  it('accepts and strips absent or empty legacy behavior references', () => {
    expect(validateAgentDefinition({
      ...definition,
      capabilityRequirements: [],
      toolRefs: [],
      skillRefs: [],
      mcpServerRefs: [],
    })).toEqual({ valid: true, value: definition })
  })

  it.each([
    'capabilityRequirements',
    'toolRefs',
    'skillRefs',
    'mcpServerRefs',
  ] as const)('rejects non-empty legacy behavior selector %s', (field) => {
    expect(validateAgentDefinition({ ...definition, [field]: ['legacy-ref'] })).toEqual({
      valid: false,
      issues: [{
        code: AgentDefinitionErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
        field,
        message: `${field} cannot select behavior; configure trusted host plugins instead`,
      }],
    })
  })

  it.each([
    ['label', ' leading'],
    ['label', 'line\nbreak'],
    ['label', 'spoof\u202e'],
    ['label', 'x'.repeat(129)],
    ['description', 'trailing '],
    ['description', 'control\u007f'],
    ['description', 'x'.repeat(1_025)],
  ])('rejects unsafe or oversized display metadata in %s', (field, value) => {
    const result = validateAgentDefinition({ ...definition, [field]: value })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues[0]).toMatchObject({
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
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
          code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
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
      {
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
        field: 'environmentAttachmentRefs',
      },
      {
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
        field: 'governancePolicyRef',
      },
      {
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
        field: 'hostname',
      },
      {
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
        field: 'runtimeProfileRef',
      },
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
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
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
        code: AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_UNSUPPORTED_FIELD,
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
        code: AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_UNSUPPORTED_FIELD,
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
        code: AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_INVALID,
        field: 'definition.version',
      })
    }
  })
})

describe('canonical digests', () => {
  it('creates the canonical UTF-8 asset digest', async () => {
    await expect(createAgentAssetDigest('Compare insurance policies.')).resolves.toBe(
      INSTRUCTIONS_DIGEST,
    )
  })

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
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'assets[0].sourcePath',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it.each([null, {}])('rejects non-array assets input %#', async (assets) => {
    await expect(createAgentDefinitionDigest({
      definition,
      assets: assets as never,
    })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'assets',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
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
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'assets[0].content',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
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
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'assets[0].path',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('requires instructionsRef to name an included asset', async () => {
    await expect(createAgentDefinitionDigest({ definition, assets: [] })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'instructionsRef',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
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
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'assets.digest',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
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
