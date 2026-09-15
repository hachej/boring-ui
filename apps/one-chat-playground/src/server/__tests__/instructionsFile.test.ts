import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createInstructionsLoader } from '../instructionsFile'

const loaders: Array<{ close(): void }> = []
afterEach(() => { for (const l of loaders.splice(0)) l.close() })

async function tmpWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-instr-'))
  await mkdir(path.join(root, 'agent'), { recursive: true })
  return root
}

describe('createInstructionsLoader', () => {
  test('appends the standing instructions to the base prompt', async () => {
    const root = await tmpWorkspace()
    await writeFile(path.join(root, 'agent', 'instructions.md'), 'Always answer in French.')
    const loader = createInstructionsLoader({ workspaceRoot: root, basePrompt: 'BASE' })
    loaders.push(loader)
    const prompt = await loader.load()
    expect(prompt).toContain('BASE')
    expect(prompt).toContain('Always answer in French.')
    expect(prompt).toContain('agent/instructions.md')
  })

  test('returns the base prompt alone when the file is missing', async () => {
    const root = await tmpWorkspace()
    const loader = createInstructionsLoader({ workspaceRoot: root, basePrompt: 'BASE' })
    loaders.push(loader)
    expect(await loader.load()).toBe('BASE')
  })

  test('picks up an edit without a restart', async () => {
    const root = await tmpWorkspace()
    const file = path.join(root, 'agent', 'instructions.md')
    await writeFile(file, 'v1')
    const loader = createInstructionsLoader({ workspaceRoot: root, basePrompt: 'BASE' })
    loaders.push(loader)
    expect(await loader.load()).toContain('v1')
    await writeFile(file, 'v2')
    // fs.watch delivery is asynchronous; poll briefly.
    const deadline = Date.now() + 3000
    let latest = ''
    while (Date.now() < deadline) {
      latest = (await loader.load()) ?? ''
      if (latest.includes('v2')) break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(latest).toContain('v2')
  })
})
