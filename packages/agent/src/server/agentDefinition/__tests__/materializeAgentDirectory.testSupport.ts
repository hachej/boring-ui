import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect } from 'vitest'

import type { AgentTool } from '../../../shared/tool'
import {
  AuthoredAgentMaterializationError,
  materializeAgentDirectory,
} from '../../index'

const tempDirs: string[] = []

export const SECRET_THROW = new Error('ESECRET /private/agent/tool.ts')

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
    instructionsRef: 'instructions.md',
    ...overrides,
  }
}

export async function writeAgentDirectory(
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

export function makeTool(name: string, overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: name }] }
    },
    ...overrides,
  }
}

export function throwingProxy<T extends object>(): T {
  return new Proxy(Object.create(null), {
    get() { throw SECRET_THROW },
    getOwnPropertyDescriptor() { throw SECRET_THROW },
    getPrototypeOf() { throw SECRET_THROW },
    has() { throw SECRET_THROW },
    ownKeys() { throw SECRET_THROW },
  }) as T
}

export function revokedProxy<T extends object>(target: T): T {
  const { proxy, revoke } = Proxy.revocable(target, {})
  revoke()
  return proxy
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
