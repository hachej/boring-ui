import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, test } from 'vitest'

import { bindToolGroups, loadOneChatAgentPackage, loadOneChatAgentPackages } from '../agentPackages'
import { createInstructionsTools } from '../instructionsTool'
import { workspaceFixture } from './workspaceFixture'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

const appAgentsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../agents')

async function writeAgentPackage(root: string, tools: readonly string[]): Promise<void> {
  const packageRoot = path.join(root, 'colleague')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(path.join(packageRoot, 'instructions.md'), 'Be useful.\n')
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@test/agent-colleague',
      private: true,
      version: '1.0.0',
      boring: {
        agent: {
          definitionId: 'colleague',
          version: '1.0.0',
          label: 'Colleague',
          instructionsRef: 'instructions.md',
        },
      },
      tools,
    }),
  )
}

describe('one-chat agent packages', () => {
  test('fails fast when a manifest names an unknown host tool group', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-agent-package-'))
    await writeAgentPackage(root, ['instructions', 'not_a_real_group'])

    await expect(loadOneChatAgentPackage(root, 'colleague')).rejects.toThrow(/unknown tool group "not_a_real_group"/)
  })

  test('the documenter binds exactly the two instructions tools', async () => {
    const packages = await loadOneChatAgentPackages(appAgentsRoot)
    expect(packages.documenter.tools).toEqual(['instructions'])

    const bundle = await workspaceFixture('one-chat-documenter-tools-')
    disposers.push(bundle.disposeRuntime ?? (async () => {}))
    const instructions = createInstructionsTools({
      workspace: bundle.workspace,
      invalidatePrompt: () => {},
    })
    const bound = bindToolGroups(packages.documenter.tools, { instructions })
    expect(bound.compact).toBe(false)
    expect(bound.tools.map((tool) => tool.name)).toEqual(['read_my_instructions', 'update_my_instructions'])
  })
})
