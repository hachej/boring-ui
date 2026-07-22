import { symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AgentDefinitionErrorCode,
  ErrorCode,
} from '../../../shared/error-codes'
import {
  AgentDefinitionValidationError,
} from '../../../shared/agent-definition'
import {
  AgentDirectoryCompilerError,
  compileAgentDirectory,
  materializeAgentDirectory,
} from '../../index'
import {
  definition,
  makeTempDir,
  writeAgentDirectory,
} from './materializeAgentDirectory.testSupport'

const MANIFEST_MAX_BYTES = 64 * 1024
const INSTRUCTIONS_MAX_BYTES = 256 * 1024

describe('declarative authored-source trust boundary', () => {
  it('accepts inclusive manifest and instruction limits', async () => {
    const root = await makeTempDir()
    const manifest = JSON.stringify(definition())
    await writeAgentDirectory(root, {
      manifestText: manifest + ' '.repeat(MANIFEST_MAX_BYTES - Buffer.byteLength(manifest)),
      instructions: 'x'.repeat(INSTRUCTIONS_MAX_BYTES),
    })

    const source = await materializeAgentDirectory({ directory: root })

    expect(source.instructions).toHaveLength(INSTRUCTIONS_MAX_BYTES)
  })

  it.each([
    ['agent.json', MANIFEST_MAX_BYTES + 1, 'agent.json'],
    ['instructions.md', INSTRUCTIONS_MAX_BYTES + 1, 'instructionsRef'],
  ] as const)('rejects %s above its byte limit before decode', async (file, size, field) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root)
    await writeFile(join(root, file), 'x'.repeat(size))

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field,
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it.each([
    ['agent.json', 'agent.json'],
    ['instructions.md', 'instructionsRef'],
  ] as const)('rejects invalid UTF-8 in %s with a field-specific error', async (file, field) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root)
    await writeFile(join(root, file), new Uint8Array([0xc3, 0x28]))

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDirectoryCompilerError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field,
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it.each([
    ['agent.json', 'agent.json'],
    ['instructions.md', 'instructionsRef'],
  ] as const)('rejects a symbolic-link %s even when its target stays inside the directory', async (file, field) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root)
    const target = join(root, `real-${file}`)
    await writeFile(target, file === 'agent.json'
      ? JSON.stringify(definition())
      : 'Safe instructions.')
    await unlink(join(root, file))
    await symlink(target, join(root, file))

    await expect(compileAgentDirectory(root)).rejects.toMatchObject({
      name: 'AgentDirectoryCompilerError',
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      compilerCode: 'AGENT_PATH_SYMLINK_ESCAPE',
      field,
    } satisfies Partial<AgentDirectoryCompilerError>)
  })

  it('rejects empty or whitespace-only instructions', async () => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, { instructions: ' \n\t ' })

    await expect(materializeAgentDirectory({ directory: root })).rejects.toMatchObject({
      name: 'AgentDefinitionValidationError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'instructionsRef',
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    } satisfies Partial<AgentDefinitionValidationError>)
  })

  it.each([
    ['label', 'private\nlabel'],
    ['description', 'private\u007fdescription'],
  ])('rejects control characters in %s without returning authored values', async (field, value) => {
    const root = await makeTempDir()
    await writeAgentDirectory(root, { manifest: definition({ [field]: value }) })

    let error: unknown
    try {
      await materializeAgentDirectory({ directory: root })
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      name: 'AgentDefinitionValidationError',
      field,
      validationCode: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    })
    expect((error as Error).message).not.toContain(value)
  })
})
