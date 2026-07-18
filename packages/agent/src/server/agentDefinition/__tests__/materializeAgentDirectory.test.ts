import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import {
  AgentDefinitionValidationError,
} from '../../../shared/agent-definition'
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentTool } from '../../../shared/tool'
import {
  AuthoredAgentMaterializationError,
  materializeAgentDirectory,
  type MaterializedAgentSourceV1,
} from '../../index'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function makeTempDir(prefix = 'boring-authored-agent-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    definitionId: 'claims-assistant',
    version: '2026.07.18',
    label: 'Claims assistant',
    instructionsRef: 'instructions.md',
    ...overrides,
  }
}

async function writeAgentDirectory(
  directory: string,
  input: {
    manifest?: Record<string, unknown>
    instructions?: string
  } = {},
): Promise<void> {
  await writeFile(
    join(directory, 'agent.json'),
    JSON.stringify(input.manifest ?? definition()),
    'utf8',
  )
  await writeFile(
    join(directory, 'instructions.md'),
    input.instructions ?? 'Handle claims with care.',
    'utf8',
  )
}

function makeTool(name: string): AgentTool {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: name }] }
    },
  }
}

describe('materializeAgentDirectory', () => {
  it('returns the frozen server-only authored source for a ref-free directory', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, { instructions: 'Exact authored prompt.' })

    const source: MaterializedAgentSourceV1 = await materializeAgentDirectory({
      directory: root,
      expectedAgentTypeId: 'claims-assistant',
      toolCatalog: new Map([['unused.tool', makeTool('unused_tool')]]),
    })

    expect(source).toEqual({
      schemaVersion: 1,
      agentTypeId: 'claims-assistant',
      version: '2026.07.18',
      label: 'Claims assistant',
      instructions: 'Exact authored prompt.',
      tools: [],
      declaredToolRefs: [],
    })
    expect(Object.keys(source).sort()).toEqual([
      'agentTypeId',
      'declaredToolRefs',
      'instructions',
      'label',
      'schemaVersion',
      'tools',
      'version',
    ])
    expect(JSON.stringify(source)).not.toMatch(/definitionDigest|digest|assets|path|root|catalog|runtime|toolCatalog/)
    expect(Object.isFrozen(source)).toBe(true)
    expect(Object.isFrozen(source.tools)).toBe(true)
    expect(Object.isFrozen(source.declaredToolRefs)).toBe(true)
    expect(() => (source.tools as AgentTool[]).push(makeTool('late_tool'))).toThrow(TypeError)
    expect(() => (source.declaredToolRefs as string[]).push('late.ref')).toThrow(TypeError)
    expect(() => ((source as { version: string }).version = 'changed')).toThrow(TypeError)
  })

  it('keeps optional label omitted and freezes empty declared refs from authored empty arrays', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({
        label: undefined,
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
      tools: [],
      declaredToolRefs: [],
    })
    expect('label' in source).toBe(false)
    expect(Object.isFrozen(source.declaredToolRefs)).toBe(true)
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

  it('rejects expected agent type mismatches before returning behavior', async () => {
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

  it('fails any non-empty authored tool refs as catalog-required until A1.2', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['quotes.compare'] }),
    })

    await expect(materializeAgentDirectory({
      directory: root,
      toolCatalog: new Map([['quotes.compare', makeTool('compare_quotes')]]),
    })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_CATALOG_REQUIRED,
      field: 'toolRefs',
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it.each([
    'capabilityRequirements',
    'skillRefs',
    'mcpServerRefs',
  ])('rejects unsupported authored reference family %s', async (field) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ [field]: ['declared-ref'] }),
    })

    await expect(materializeAgentDirectory({ directory: root })).rejects.toMatchObject({
      name: 'AuthoredAgentMaterializationError',
      code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
      field,
    } satisfies Partial<AuthoredAgentMaterializationError>)
  })

  it('does not disclose authored ref or catalog values in materializer error messages', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ toolRefs: ['private.catalog.ref'] }),
    })

    let error: unknown
    try {
      await materializeAgentDirectory({
        directory: root,
        toolCatalog: new Map([['private.catalog.ref', makeTool('private_tool')]]),
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(AuthoredAgentMaterializationError)
    expect((error as Error).message).not.toContain('private.catalog.ref')
    expect((error as Error).message).not.toContain('private_tool')
  })

  it('preserves compiler validation error codes instead of wrapping them', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ instructionsRef: './instructions.md' }),
    })

    await expect(materializeAgentDirectory({ directory: root })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'instructionsRef',
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('reads instructions from the compiler-verified UTF-8 asset only', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, { instructions: 'Verified UTF-8 🛡️' })

    const source = await materializeAgentDirectory({ directory: root })

    expect(source.instructions).toBe(await readFile(join(root, 'instructions.md'), 'utf8'))
  })
})

describe('authored agent source export boundary', () => {
  it('exports materialization only from the server surface', () => {
    const serverIndex = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8')
    const sharedIndex = readFileSync(new URL('../../../shared/index.ts', import.meta.url), 'utf8')
    const frontIndex = readFileSync(new URL('../../../front/index.ts', import.meta.url), 'utf8')

    expect(serverIndex).toContain('materializeAgentDirectory')
    expect(serverIndex).toContain('MaterializedAgentSourceV1')
    expect(sharedIndex).not.toMatch(/materializeAgentDirectory|MaterializedAgentSourceV1/)
    expect(frontIndex).not.toMatch(/materializeAgentDirectory|MaterializedAgentSourceV1/)
  })
})
