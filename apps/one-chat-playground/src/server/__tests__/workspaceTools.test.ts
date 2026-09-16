import { afterEach, describe, expect, test } from 'vitest'

import {
  createWorkspaceToolsExtension,
  loadWorkspaceTools,
} from '../workspaceTools'
import { workspaceFixture } from './workspaceFixture'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

async function fixture() {
  const runtimeBundle = await workspaceFixture('one-chat-tools-')
  disposers.push(runtimeBundle.disposeRuntime ?? (async () => {}))
  await runtimeBundle.workspace.mkdir('agent/tools', { recursive: true })
  return runtimeBundle
}

function manifest(name: string, script: string) {
  return JSON.stringify({
    name,
    description: `Run ${name}.`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: { command: ['node', `agent/tools/${script}.ts`] },
  })
}

describe('workspace declarative tools', () => {
  test('reads manifests through Workspace and executes the matching script in Sandbox', async () => {
    const runtimeBundle = await fixture()
    await runtimeBundle.workspace.writeFile(
      'agent/tools/answer.json',
      manifest('answer_count', 'answer'),
    )
    await runtimeBundle.workspace.writeFile(
      'agent/tools/answer.ts',
      "process.stdin.resume();process.stdin.on('end',()=>console.log(42))\n",
    )

    const [tool] = await loadWorkspaceTools({
      workspace: runtimeBundle.workspace,
      sandbox: runtimeBundle.sandbox,
      allowUnisolatedDirectExecution: true,
    })
    const result = await tool!.execute(
      {},
      {
        abortSignal: new AbortController().signal,
        toolCallId: 'test',
      },
    )
    expect(result.content[0]?.text.trim()).toBe('42')
  })

  test('the stable extension factory re-reads manifests on every reload invocation', async () => {
    const runtimeBundle = await fixture()
    await runtimeBundle.workspace.writeFile(
      'agent/tools/first.json',
      manifest('first_tool', 'first'),
    )
    await runtimeBundle.workspace.writeFile(
      'agent/tools/first.ts',
      'process.stdin.resume()\n',
    )
    const extension = createWorkspaceToolsExtension({
      workspace: runtimeBundle.workspace,
      sandbox: runtimeBundle.sandbox,
      allowUnisolatedDirectExecution: true,
    })
    const registered: string[] = []
    const pi = {
      registerTool(tool: { name: string }) {
        registered.push(tool.name)
      },
    }

    await extension(pi as never)
    expect(registered).toEqual(['first_tool'])

    await runtimeBundle.workspace.writeFile(
      'agent/tools/second.json',
      manifest('second_tool', 'second'),
    )
    await runtimeBundle.workspace.writeFile(
      'agent/tools/second.ts',
      'process.stdin.resume()\n',
    )
    registered.length = 0
    await extension(pi as never)
    expect(registered).toEqual(['first_tool', 'second_tool'])
  })

  test('rejects a manifest without its matching script and reserved names', async () => {
    const runtimeBundle = await fixture()
    await runtimeBundle.workspace.writeFile(
      'agent/tools/bad.json',
      manifest('read', 'bad'),
    )
    await expect(
      loadWorkspaceTools({
        workspace: runtimeBundle.workspace,
        sandbox: runtimeBundle.sandbox,
        allowUnisolatedDirectExecution: true,
      }),
    ).rejects.toThrow('matching script')
    await runtimeBundle.workspace.writeFile(
      'agent/tools/bad.ts',
      'process.stdin.resume()\n',
    )
    await expect(
      loadWorkspaceTools({
        workspace: runtimeBundle.workspace,
        sandbox: runtimeBundle.sandbox,
        reservedNames: new Set(['read']),
        allowUnisolatedDirectExecution: true,
      }),
    ).rejects.toThrow('reserved')
  })
})
