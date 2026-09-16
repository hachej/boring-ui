import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createDirectSandboxProvider } from '@hachej/boring-sandbox/providers'
import { afterEach, describe, expect, test } from 'vitest'

import {
  BROKERED_SANDBOX_TOOL_MAX_OUTPUT_BYTES,
  createBrokeredSandboxTool,
  parseBrokeredSandboxToolManifest,
} from '../plugins/brokeredSandboxTool'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

async function directPair() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'brokered-tool-'))
  const pair = await createDirectSandboxProvider().create({
    workspaceRoot: root,
    workspaceId: 'brokered-tool-test',
    sessionId: 'test',
  })
  disposers.push(pair.dispose)
  return pair
}

const manifest = {
  name: 'count_items',
  description: 'Count the supplied items.',
  parameters: {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'string' } } },
    required: ['items'],
    additionalProperties: false,
  },
  run: {
    command: [
      'node',
      '-e',
      "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(String(JSON.parse(s).items.length)))",
    ],
    stdin: 'json' as const,
  },
}

function context() {
  return { abortSignal: new AbortController().signal, toolCallId: 'call-1' }
}

function granted(pair: Awaited<ReturnType<typeof directPair>>) {
  return { workspace: pair.workspace, sandbox: pair.sandbox, allowUnisolatedDirectExecution: true }
}

describe('brokered sandbox tools', () => {
  test('rejects the unisolated direct provider by default', async () => {
    const pair = await directPair()
    expect(() =>
      createBrokeredSandboxTool(manifest, { workspace: pair.workspace, sandbox: pair.sandbox }),
    ).toThrow('isolated sandbox')
  })

  test('executes through direct only with an explicit host-owned development grant', async () => {
    const pair = await directPair()
    const tool = createBrokeredSandboxTool(manifest, granted(pair))

    await expect(
      tool.execute({ items: ['a', 'b', 'c'] }, context()),
    ).resolves.toEqual({
      content: [{ type: 'text', text: '3' }],
    })
  })

  test('reports stderr and the exit code without importing user code', async () => {
    const pair = await directPair()
    const tool = createBrokeredSandboxTool(
      {
        ...manifest,
        run: {
          command: [
            'node',
            '-e',
            "process.stderr.write('bad input');process.exit(7)",
          ],
        },
      },
      granted(pair),
    )

    const result = await tool.execute({}, context())
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('exit code 7')
    expect(result.content[0]?.text).toContain('bad input')
  })

  test('refuses cwd and command paths outside the workspace', async () => {
    const pair = await directPair()
    expect(() =>
      createBrokeredSandboxTool(
        {
          ...manifest,
          run: { ...manifest.run, cwd: '../outside' },
        },
        granted(pair),
      ),
    ).toThrow('must stay inside the workspace')
    expect(() =>
      createBrokeredSandboxTool(
        {
          ...manifest,
          run: { ...manifest.run, command: ['/tmp/outside-script'] },
        },
        granted(pair),
      ),
    ).toThrow('must stay inside the workspace')
    expect(() =>
      createBrokeredSandboxTool(
        {
          ...manifest,
          run: { ...manifest.run, command: ['../../usr/bin/node'] },
        },
        granted(pair),
      ),
    ).toThrow('must stay inside the workspace')
  })

  test('uses Workspace stat to reject a command script symlinked outside the workspace', async () => {
    const pair = await directPair()
    const outside = path.join(os.tmpdir(), `brokered-outside-${process.pid}.js`)
    await writeFile(outside, "console.log('escaped')")
    await pair.workspace.mkdir('agent/tools', { recursive: true })
    await symlink(outside, path.join(pair.workspace.root, 'agent/tools/escaped.ts'))
    const tool = createBrokeredSandboxTool({
      ...manifest,
      run: { command: ['node', 'agent/tools/escaped.ts'] },
    }, granted(pair))

    const result = await tool.execute({}, context())
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('unavailable inside the workspace')
  })

  test('resolves a bare script argument against cwd before the Workspace check', async () => {
    const pair = await directPair()
    const outside = path.join(os.tmpdir(), `brokered-cwd-outside-${process.pid}.ts`)
    await writeFile(outside, "console.log('escaped')")
    await pair.workspace.mkdir('agent/tools', { recursive: true })
    await symlink(outside, path.join(pair.workspace.root, 'agent/tools/escaped.ts'))
    const tool = createBrokeredSandboxTool({
      ...manifest,
      run: { cwd: 'agent/tools', command: ['node', 'escaped.ts'] },
    }, granted(pair))

    const result = await tool.execute({}, context())
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('agent/tools/escaped.ts')
  })

  test('caps stdout at the broker limit', async () => {
    const pair = await directPair()
    const tool = createBrokeredSandboxTool(
      {
        ...manifest,
        run: {
          command: [
            'node',
            '-e',
            `process.stdout.write('x'.repeat(${BROKERED_SANDBOX_TOOL_MAX_OUTPUT_BYTES * 2}))`,
          ],
        },
      },
      granted(pair),
    )

    const result = await tool.execute({}, context())
    expect(result.content[0]?.text.length).toBeLessThanOrEqual(
      BROKERED_SANDBOX_TOOL_MAX_OUTPUT_BYTES,
    )
  })

  test('rejects unknown manifest fields', () => {
    expect(() =>
      parseBrokeredSandboxToolManifest({ ...manifest, execute: 'host.js' }),
    ).toThrow()
  })
})
