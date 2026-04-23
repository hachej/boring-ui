import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { getEnv, restoreEnvForTest, setEnvForTest } from '../config/env'
import { createAgentApp } from '../createAgentApp'
import { loadPlugins, flattenPluginTools } from '../harness/pi-coding-agent/pluginLoader'

const tempDirs: string[] = []
const ORIGINAL_TEMPLATE_PATH = getEnv('BORING_AGENT_TEMPLATE_PATH')

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
  restoreEnvForTest('BORING_AGENT_TEMPLATE_PATH', ORIGINAL_TEMPLATE_PATH)
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function makeWorkspaceLocalTempDir(prefix: string): Promise<string> {
  const baseDir = join(process.cwd(), '.tmp-test-workspaces')
  await mkdir(baseDir, { recursive: true })
  const dir = await mkdtemp(join(baseDir, prefix))
  tempDirs.push(dir)
  return dir
}

async function createTemplate(
  prefix: string,
  files: Record<string, string>,
): Promise<string> {
  const root = await makeTempDir(prefix)
  for (const [relPath, contents] of Object.entries(files)) {
    const filePath = join(root, relPath)
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, contents, 'utf-8')
  }
  return root
}

test('createAgentApp provisions from templatePath option', async () => {
  const parent = await makeTempDir('boring-ui-app-parent-')
  const workspaceRoot = join(parent, 'workspace')
  const templateRoot = await createTemplate('boring-ui-template-', {
    'README.md': '# api-template\n',
  })

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    templatePath: templateRoot,
  })
  await app.close()

  await expect(readFile(join(workspaceRoot, 'README.md'), 'utf-8')).resolves.toBe('# api-template\n')
})

test('createAgentApp falls back to BORING_AGENT_TEMPLATE_PATH', async () => {
  const parent = await makeTempDir('boring-ui-app-parent-')
  const workspaceRoot = join(parent, 'workspace')
  const templateRoot = await createTemplate('boring-ui-template-', {
    'FROM_ENV.txt': 'env-template\n',
  })
  setEnvForTest('BORING_AGENT_TEMPLATE_PATH', templateRoot)

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
  })
  await app.close()

  await expect(readFile(join(workspaceRoot, 'FROM_ENV.txt'), 'utf-8')).resolves.toBe('env-template\n')
})

test('createAgentApp option templatePath takes precedence over env fallback', async () => {
  const parent = await makeTempDir('boring-ui-app-parent-')
  const workspaceRoot = join(parent, 'workspace')
  const envTemplate = await createTemplate('boring-ui-template-env-', {
    'FROM_ENV.txt': 'env-template\n',
  })
  const apiTemplate = await createTemplate('boring-ui-template-api-', {
    'FROM_API.txt': 'api-template\n',
  })
  setEnvForTest('BORING_AGENT_TEMPLATE_PATH', envTemplate)

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    templatePath: apiTemplate,
  })
  await app.close()

  await expect(readFile(join(workspaceRoot, 'FROM_API.txt'), 'utf-8')).resolves.toBe('api-template\n')
  await expect(readFile(join(workspaceRoot, 'FROM_ENV.txt'), 'utf-8')).rejects.toSatisfy(
    (error: unknown) => (error as { code?: string }).code === 'ENOENT',
  )
})

test('extraTools appear in catalog endpoint', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-extra-tools-')

  const customTool = {
    name: 'reverse',
    description: 'Reverse a string.',
    parameters: {
      type: 'object' as const,
      properties: { s: { type: 'string' } },
      required: ['s'],
    },
    async execute(params: Record<string, unknown>) {
      const s = typeof params.s === 'string' ? params.s : ''
      return { content: [{ type: 'text' as const, text: s.split('').reverse().join('') }] }
    },
  }

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    extraTools: [customTool],
  })

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/catalog',
  })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  const names = body.tools.map((t: { name: string }) => t.name)
  expect(names).toContain('bash')
  expect(names).toContain('reverse')

  const reverseMeta = body.tools.find((t: { name: string }) => t.name === 'reverse')
  expect(reverseMeta.description).toBe('Reverse a string.')
  expect(reverseMeta.parameters.required).toEqual(['s'])

  await app.close()
})

test('extraTools are appended after standardCatalog', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-extra-tools-order-')

  const customTool = {
    name: 'custom_last',
    description: 'Should be after standard tools.',
    parameters: { type: 'object' as const, properties: {} },
    async execute() {
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    },
  }

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    extraTools: [customTool],
  })

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/catalog',
  })

  const names = res.json().tools.map((t: { name: string }) => t.name)
  const bashIdx = names.indexOf('bash')
  const customIdx = names.indexOf('custom_last')
  expect(bashIdx).toBeLessThan(customIdx)

  await app.close()
})

test('createAgentApp throws clearly when templatePath is missing', async () => {
  const parent = await makeTempDir('boring-ui-app-parent-')
  const workspaceRoot = join(parent, 'workspace')
  const missingTemplate = join(parent, 'missing-template')

  await expect(
    createAgentApp({
      workspaceRoot,
      mode: 'direct',
      logger: false,
      templatePath: missingTemplate,
    }),
  ).rejects.toThrow(`Failed to copy template from "${missingTemplate}"`)
})

test('real local plugin file remains callable and appears in app catalog', async () => {
  const workspaceRoot = await makeWorkspaceLocalTempDir('boring-ui-plugin-e2e-')
  const pluginDir = join(workspaceRoot, '.pi', 'extensions')
  await mkdir(pluginDir, { recursive: true })

  const pluginPath = join(pluginDir, 'hello.mjs')
  await writeFile(
    pluginPath,
    [
      'export default {',
      "  name: 'a4s_plugin_hello',",
      "  description: 'hello plugin tool for compatibility smoke test',",
      '  parameters: {',
      "    type: 'object',",
      "    properties: { name: { type: 'string' } },",
      "    required: ['name'],",
      '  },',
      '  async execute(params) {',
      "    const name = typeof params?.name === 'string' ? params.name : 'world'",
      "    return { content: [{ type: 'text', text: `hello ${name}` }] }",
      '  },',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  )

  const pluginResult = await loadPlugins({ cwd: workspaceRoot, skipGlobal: true })
  expect(pluginResult.errors).toEqual([])
  const pluginTools = flattenPluginTools(pluginResult)
  expect(pluginTools.map((tool) => tool.name)).toContain('a4s_plugin_hello')
  await expect(
    pluginTools.find((tool) => tool.name === 'a4s_plugin_hello')!.execute(
      { name: 'Ada' },
      { abortSignal: new AbortController().signal, toolCallId: 'plugin-call-1' },
    ),
  ).resolves.toMatchObject({
    content: [{ type: 'text', text: 'hello Ada' }],
  })

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
  })

  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/catalog',
    })
    expect(res.statusCode).toBe(200)
    const names = res.json().tools.map((t: { name: string }) => t.name)
    expect(names).toContain('a4s_plugin_hello')
  } finally {
    await app.close()
  }
})
