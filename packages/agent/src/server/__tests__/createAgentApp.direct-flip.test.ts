import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { createAgentApp } from '../createAgentApp'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'boring-ui-direct-flip-'))
  tempDirs.push(dir)
  return dir
}

test('direct mode produces pi tool names: bash, read, write, edit, find, grep, ls', async () => {
  const workspaceRoot = await makeTempDir()
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
  })

  const response = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  const catalog = JSON.parse(response.body)
  const names = catalog.tools.map((t: { name: string }) => t.name)

  expect(names).toContain('bash')
  expect(names).toContain('read')
  expect(names).toContain('write')
  expect(names).toContain('edit')
  expect(names).toContain('find')
  expect(names).toContain('grep')
  expect(names).toContain('ls')

  await app.close()
}, 15_000)

test('disableDefaultFileTools omits filesystem tools', async () => {
  const workspaceRoot = await makeTempDir()
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    disableDefaultFileTools: true,
    logger: false,
  })

  const response = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  const catalog = JSON.parse(response.body)
  const names = catalog.tools.map((t: { name: string }) => t.name)

  expect(names).toContain('bash')
  expect(names).not.toContain('read')
  expect(names).not.toContain('write')
  expect(names).not.toContain('edit')
  expect(names).not.toContain('find')
  expect(names).not.toContain('grep')
  expect(names).not.toContain('ls')

  await app.close()
}, 15_000)

test('extraTools are included after bundle tools', async () => {
  const workspaceRoot = await makeTempDir()
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    extraTools: [{
      name: 'custom_tool',
      description: 'A custom tool',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }] }
      },
    }],
  })

  const response = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
  const catalog = JSON.parse(response.body)
  const names = catalog.tools.map((t: { name: string }) => t.name)

  expect(names).toContain('custom_tool')
  const bashIdx = names.indexOf('bash')
  const customIdx = names.indexOf('custom_tool')
  expect(customIdx).toBeGreaterThan(bashIdx)

  await app.close()
}, 15_000)
