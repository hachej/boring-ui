import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentDefinitionValidationError, createAgentAssetDigest } from '../../../shared/agent-definition'
import { AgentDefinitionErrorCode, ErrorCode } from '../../../shared/error-codes'
import {
  AgentDirectoryCompilerError,
  compileAgentDirectory,
  compilePersonaPackageDirectory,
} from '../compileAgentDirectory'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function makeTempDir(prefix = 'boring-agent-definition-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    definitionId: 'insurance-comparison',
    version: '1.0.0',
    label: 'Insurance comparison',
    description: 'Compares insurance policies.',
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
    input.instructions ?? 'Compare insurance policies.',
    'utf8',
  )
}

describe('compileAgentDirectory', () => {
  it('produces an immutable checkout-independent deterministic bundle', async () => {
    const firstRoot = await makeTempDir('boring-agent-first-checkout-')
    const secondRoot = await makeTempDir('boring-agent-second-checkout-')
    await writeAgentDirectory(firstRoot)
    await writeAgentDirectory(secondRoot)

    const first = await compileAgentDirectory(firstRoot)
    const repeated = await compileAgentDirectory(firstRoot)
    const relocated = await compileAgentDirectory(secondRoot)

    expect(JSON.stringify(repeated)).toBe(JSON.stringify(first))
    expect(JSON.stringify(relocated)).toBe(JSON.stringify(first))
    expect(relocated.definitionDigest).toBe(first.definitionDigest)
    expect(first.assets).toEqual([{
      path: 'instructions.md',
      digest: await createAgentAssetDigest('Compare insurance policies.'),
      content: 'Compare insurance policies.',
    }])
    expect(first.assets.some(({ path }) => path === first.definition.instructionsRef)).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.definition)).toBe(true)
    expect(first.definition).not.toHaveProperty('toolRefs')
    expect(Object.isFrozen(first.assets)).toBe(true)
    expect(Object.isFrozen(first.assets[0])).toBe(true)
  })

  it('changes both asset and definition digests when instructions change', async () => {
    const firstRoot = await makeTempDir()
    const changedRoot = await makeTempDir()
    await writeAgentDirectory(firstRoot)
    await writeAgentDirectory(changedRoot, { instructions: 'Changed instructions.' })

    const first = await compileAgentDirectory(firstRoot)
    const changed = await compileAgentDirectory(changedRoot)

    expect(changed.assets[0].digest).not.toBe(first.assets[0].digest)
    expect(changed.definitionDigest).not.toBe(first.definitionDigest)
  })

  it.each([
    ['pluginRefs', ['workspace-plugin']],
    ['plugins', ['workspace-plugin']],
    ['systemPromptFragmentRefs', ['generic-fragment']],
    ['hostname', 'insurance-comparison.senecapp.ai'],
    ['pricing', { currency: 'EUR' }],
  ])('preserves P6-D rejection metadata for unsupported field %s', async (field, value) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, { manifest: definition({ [field]: value }) })

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field,
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('rejects non-canonical authored instructionsRef instead of normalizing it', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ instructionsRef: './instructions.md' }),
    })

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'instructionsRef',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('rejects an instructionsRef that traverses outside the agent directory', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ instructionsRef: '../instructions.md' }),
    })

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'instructionsRef',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it.each([
    ['definitionId', ''],
    ['definitionId', ' insurance-comparison'],
    ['version', ''],
  ])('rejects malformed identity field %s', async (field, value) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, {
      manifest: definition({ [field]: value }),
    })

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field,
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('rejects an instructions symlink whose target remains inside the agent directory', async () => {
    const root = await makeTempDir()
    await mkdir(join(root, 'content'))
    await writeFile(join(root, 'content', 'instructions.md'), 'Contained instructions.', 'utf8')
    await writeFile(join(root, 'agent.json'), JSON.stringify(definition()), 'utf8')
    await symlink(join('content', 'instructions.md'), join(root, 'instructions.md'))

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDirectoryCompilerError',
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      compilerCode: 'AGENT_PATH_SYMLINK_ESCAPE',
      field: 'instructionsRef',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it('rejects an alternate contained instructions path', async () => {
    const root = await makeTempDir()
    await mkdir(join(root, '..notes'))
    await writeFile(join(root, '..notes', 'instructions.md'), 'Contained notes.', 'utf8')
    await writeFile(
      join(root, 'agent.json'),
      JSON.stringify(definition({ instructionsRef: '..notes/instructions.md' })),
      'utf8',
    )

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'instructionsRef',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it('rejects an instructions symlink that escapes the agent directory', async () => {
    const root = await makeTempDir()
    const outside = await makeTempDir('boring-agent-outside-')
    await writeFile(join(root, 'agent.json'), JSON.stringify(definition()), 'utf8')
    await writeFile(join(outside, 'instructions.md'), 'Outside instructions.', 'utf8')
    await symlink(join(outside, 'instructions.md'), join(root, 'instructions.md'))

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDirectoryCompilerError',
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      compilerCode: 'AGENT_PATH_SYMLINK_ESCAPE',
      field: 'instructionsRef',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it('rejects a manifest symlink that escapes the agent directory before parsing', async () => {
    const root = await makeTempDir()
    const outside = await makeTempDir('boring-agent-manifest-outside-')
    await writeFile(join(outside, 'agent.json'), JSON.stringify(definition()), 'utf8')
    await symlink(join(outside, 'agent.json'), join(root, 'agent.json'))

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      compilerCode: 'AGENT_PATH_SYMLINK_ESCAPE',
      field: 'agent.json',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it('reports missing instructions with stable public and compiler codes', async () => {
    const root = await makeTempDir()
    await writeFile(join(root, 'agent.json'), JSON.stringify(definition()), 'utf8')

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_NOT_FOUND,
      compilerCode: 'AGENT_ASSET_NOT_FOUND',
      field: 'instructionsRef',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it('reports a missing manifest before attempting discovery', async () => {
    const root = await makeTempDir()

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_NOT_FOUND,
      compilerCode: 'AGENT_MANIFEST_NOT_FOUND',
      field: 'agent.json',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it('reports malformed JSON without evaluating source code', async () => {
    const root = await makeTempDir()
    await writeFile(join(root, 'agent.json'), '{"schemaVersion": 1,', 'utf8')

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      code: ErrorCode.enum.CONFIG_INVALID,
      compilerCode: 'AGENT_MANIFEST_INVALID_JSON',
      field: 'agent.json',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it('rejects invalid UTF-8 instruction bytes', async () => {
    const root = await makeTempDir()
    await writeFile(join(root, 'agent.json'), JSON.stringify(definition()), 'utf8')
    await writeFile(join(root, 'instructions.md'), new Uint8Array([0xc3, 0x28]))

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      code: ErrorCode.enum.CONFIG_INVALID,
      compilerCode: 'AGENT_ASSET_INVALID_UTF8',
      field: 'instructionsRef',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })
})

async function writePersonaPackage(directory: string): Promise<void> {
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: '@fixture/persona',
    boring: {
      agent: {
        definitionId: 'fixture-persona',
        version: '1.0.0',
        label: 'Fixture Persona',
        instructionsRef: 'instructions.md',
      },
    },
  }), 'utf8')
  await writeFile(join(directory, 'instructions.md'), 'You are Fixture.', 'utf8')
}

describe('compilePersonaPackageDirectory knowledge/', () => {
  it('omits knowledgeDir and keeps a knowledge-free digest when knowledge/ is absent', async () => {
    const root = await makeTempDir('boring-agent-no-knowledge-')
    await writePersonaPackage(root)

    const bundle = await compilePersonaPackageDirectory(root)
    expect(bundle.knowledgeDir).toBeUndefined()
    expect(bundle.assets.map(({ path }) => path)).toEqual(['instructions.md'])
  })

  it('folds knowledge bytes into the definition digest; digest changes when knowledge bytes change', async () => {
    const withoutKnowledge = await makeTempDir('boring-agent-knowledge-baseline-')
    await writePersonaPackage(withoutKnowledge)
    const baseline = await compilePersonaPackageDirectory(withoutKnowledge)

    const root = await makeTempDir('boring-agent-knowledge-')
    await writePersonaPackage(root)
    await mkdir(join(root, 'knowledge', 'nested'), { recursive: true })
    await writeFile(join(root, 'knowledge', 'facts.md'), 'fact one', 'utf8')
    await writeFile(join(root, 'knowledge', 'nested', 'deep.md'), 'deep fact', 'utf8')

    const first = await compilePersonaPackageDirectory(root)
    expect(first.knowledgeDir).toBe(join(await realpath(root), 'knowledge'))
    expect(first.assets.map(({ path }) => path).sort()).toEqual([
      'instructions.md',
      'knowledge/facts.md',
      'knowledge/nested/deep.md',
    ])
    expect(first.definitionDigest).not.toBe(baseline.definitionDigest)

    const unchanged = await compilePersonaPackageDirectory(root)
    expect(unchanged.definitionDigest).toBe(first.definitionDigest)

    await writeFile(join(root, 'knowledge', 'facts.md'), 'fact one, revised', 'utf8')
    const changed = await compilePersonaPackageDirectory(root)
    expect(changed.definitionDigest).not.toBe(first.definitionDigest)
  })

  it('fails closed on a symlink inside knowledge/', async () => {
    const root = await makeTempDir('boring-agent-knowledge-symlink-')
    const outside = await makeTempDir('boring-agent-knowledge-outside-')
    await writePersonaPackage(root)
    await mkdir(join(root, 'knowledge'))
    await writeFile(join(outside, 'secret.md'), 'outside bytes', 'utf8')
    await symlink(join(outside, 'secret.md'), join(root, 'knowledge', 'escape.md'))

    await expect(compilePersonaPackageDirectory(root)).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      compilerCode: 'AGENT_PATH_SYMLINK_ESCAPE',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it('rejects a knowledge/ entry that is not valid UTF-8', async () => {
    const root = await makeTempDir('boring-agent-knowledge-utf8-')
    await writePersonaPackage(root)
    await mkdir(join(root, 'knowledge'))
    await writeFile(join(root, 'knowledge', 'binary.bin'), new Uint8Array([0xc3, 0x28]))

    await expect(compilePersonaPackageDirectory(root)).rejects.toMatchObject({
      code: ErrorCode.enum.CONFIG_INVALID,
      compilerCode: 'AGENT_ASSET_INVALID_UTF8',
      field: 'knowledge/binary.bin',
    } satisfies Partial<AgentDirectoryCompilerError>)
  })
})
