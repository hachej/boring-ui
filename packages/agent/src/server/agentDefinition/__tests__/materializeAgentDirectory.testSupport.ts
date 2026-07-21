import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect } from 'vitest'

import {
  AuthoredAgentMaterializationError,
  materializeAgentDirectory,
} from '../../index'

const tempDirs: string[] = []

export const SECRET_THROW = new Error('ESECRET /private/agent/source.ts')

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

export async function makeTempDir(prefix = 'boring-authored-agent-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

export function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    definitionId: 'claims-assistant',
    version: '2026.07.18',
    label: 'Claims assistant',
    description: 'Helps process insurance claims.',
    instructionsRef: 'instructions.md',
    ...overrides,
  }
}

export async function writeAgentDirectory(
  directory: string,
  input: {
    manifest?: Record<string, unknown>
    manifestText?: string
    instructions?: string | Uint8Array
  } = {},
): Promise<void> {
  await writeFile(
    join(directory, 'agent.json'),
    input.manifestText ?? JSON.stringify(input.manifest ?? definition()),
  )
  await writeFile(
    join(directory, 'instructions.md'),
    input.instructions ?? 'Handle claims with care.',
  )
}

export function expectRedactedMaterializationError(
  error: unknown,
  expected: Partial<AuthoredAgentMaterializationError>,
): void {
  expect(error).toMatchObject({
    name: 'AuthoredAgentMaterializationError',
    ...expected,
  })
  expect(error).toBeInstanceOf(AuthoredAgentMaterializationError)
  expect(error).not.toBe(SECRET_THROW)
  expect((error as Error).message).not.toContain('ESECRET')
  expect((error as Error).message).not.toContain('/private')
}

export async function expectMaterializeRejectsRedacted(
  input: Parameters<typeof materializeAgentDirectory>[0],
  expected: Partial<AuthoredAgentMaterializationError>,
): Promise<void> {
  let error: unknown
  try {
    await materializeAgentDirectory(input)
  } catch (caught) {
    error = caught
  }
  expectRedactedMaterializationError(error, expected)
}
