import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ErrorCode } from '../../../shared/error-codes'
import {
  AgentDefinitionValidationError,
} from '../../../shared/agent-definition'
import {
  AuthoredAgentMaterializationError,
  materializeAgentDirectory,
  type AuthoredAgentSourceV1,
} from '../../index'
import {
  definition,
  makeTempDir,
  writeAgentDirectory,
} from './materializeAgentDirectory.testSupport'

describe('materializeAgentDirectory', () => {
  it('returns only frozen declarative identity, metadata, and instructions', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, { instructions: 'Exact authored prompt.' })

    const source: AuthoredAgentSourceV1 = await materializeAgentDirectory({
      directory: root,
      expectedAgentTypeId: 'claims-assistant',
    })

    expect(source).toEqual({
      schemaVersion: 1,
      agentTypeId: 'claims-assistant',
      version: '2026.07.18',
      label: 'Claims assistant',
      description: 'Helps process insurance claims.',
      instructions: 'Exact authored prompt.',
    })
    expect(Object.keys(source).sort()).toEqual([
      'agentTypeId',
      'description',
      'instructions',
      'label',
      'schemaVersion',
      'version',
    ])
    expect(JSON.stringify(source)).not.toMatch(
      /definitionDigest|digest|assets|path|root|catalog|runtime|tool|skill|mcp|capabilit/i,
    )
    expect(Object.isFrozen(source)).toBe(true)
    expect(() => ((source as { version: string }).version = 'changed')).toThrow(TypeError)
  })

  it('accepts and strips empty legacy behavior arrays', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({
        label: undefined,
        description: undefined,
        toolRefs: [],
        capabilityRequirements: [],
        skillRefs: [],
        mcpServerRefs: [],
      }),
    })

    const source = await materializeAgentDirectory({ directory: root })

    expect(source).toEqual({
      schemaVersion: 1,
      agentTypeId: 'claims-assistant',
      version: '2026.07.18',
      instructions: 'Handle claims with care.',
    })
  })

  it.each([
    'capabilityRequirements',
    'toolRefs',
    'skillRefs',
    'mcpServerRefs',
  ] as const)('rejects non-empty legacy behavior selector %s', async (field) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ [field]: ['private.legacy.ref'] }),
    })

    await expect(materializeAgentDirectory({ directory: root })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
      field,
      message: expect.not.stringContaining('private.legacy.ref'),
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it.each([
    ['definitionId', 'ClaimsAssistant'],
    ['definitionId', '1claims-assistant'],
    ['definitionId', 'claims_assistant'],
    ['definitionId', `a${'b'.repeat(63)}`],
    ['expectedAgentTypeId', 'ClaimsAssistant'],
  ])('rejects invalid product agent type id in %s', async (field, value) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition(field === 'definitionId' ? { definitionId: value } : {}),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      ...(field === 'expectedAgentTypeId' ? { expectedAgentTypeId: value } : {}),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_ID_INVALID,
      field,
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('rejects expected agent type mismatches', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root)

    await expect(materializeAgentDirectory({
      directory: root,
      expectedAgentTypeId: 'other-agent',
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_TYPE_MISMATCH,
      field: 'expectedAgentTypeId',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('does not discover or import sibling executable modules', async () => {
    const root = await makeTempDir()
    await mkdir(join(root, 'tools'))
    await writeFile(
      join(root, 'tools', 'spy.mjs'),
      'globalThis.__authoredToolImportSpy = (globalThis.__authoredToolImportSpy ?? 0) + 1\n',
      'utf8',
    )
    ;(globalThis as { __authoredToolImportSpy?: number }).__authoredToolImportSpy = 0
    await writeAgentDirectory(root)

    await materializeAgentDirectory({ directory: root })

    expect((globalThis as { __authoredToolImportSpy?: number }).__authoredToolImportSpy).toBe(0)
  })

  it('preserves compiler validation errors and reads only the verified UTF-8 asset', async () => {
    const invalidRoot = await makeTempDir()
    await writeAgentDirectory(invalidRoot, {
      manifest: definition({ instructionsRef: './instructions.md' }),
    })
    await expect(materializeAgentDirectory({ directory: invalidRoot })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'instructionsRef',
    } satisfies Partial<AgentDefinitionValidationError>)

    const validRoot = await makeTempDir()
    await writeAgentDirectory(validRoot, { instructions: 'Verified UTF-8 🛡️' })
    const source = await materializeAgentDirectory({ directory: validRoot })
    expect(source.instructions).toBe(await readFile(join(validRoot, 'instructions.md'), 'utf8'))
  })
})

describe('authored agent source export boundary', () => {
  it('exports the declarative loader only from the server surface', () => {
    const serverIndex = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8')
    const sharedIndex = readFileSync(new URL('../../../shared/index.ts', import.meta.url), 'utf8')
    const frontIndex = readFileSync(new URL('../../../front/index.ts', import.meta.url), 'utf8')

    expect(serverIndex).toContain('materializeAgentDirectory')
    expect(serverIndex).toContain('AuthoredAgentSourceV1')
    expect(serverIndex).not.toContain('AuthoredAgentToolCatalog')
    expect(serverIndex).not.toContain('MaterializedAgentSourceV1')
    expect(sharedIndex).not.toMatch(/materializeAgentDirectory|AuthoredAgentSourceV1/)
    expect(frontIndex).not.toMatch(/materializeAgentDirectory|AuthoredAgentSourceV1/)
  })
})
