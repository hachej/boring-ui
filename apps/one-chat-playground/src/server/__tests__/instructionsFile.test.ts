import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createInstructionsLoader, type InstructionsLoader } from '../instructionsFile'
import { agreeIntent, openIntent, recordChange } from '../memoryFiles'

/** fs.watch delivery is asynchronous; poll briefly for the recomputed prompt. */
async function pollUntil(loader: InstructionsLoader, needle: string): Promise<string> {
  const deadline = Date.now() + 5000
  let latest = ''
  while (Date.now() < deadline) {
    latest = (await loader.load()) ?? ''
    if (latest.includes(needle)) return latest
    await new Promise((r) => setTimeout(r, 50))
  }
  return latest
}

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

describe('the "where were we" line', () => {
  test('is absent while there is no memory, and appears once an intent exists', async () => {
    const root = await tmpWorkspace()
    const loader = createInstructionsLoader({ workspaceRoot: root, basePrompt: 'BASE' })
    loaders.push(loader)
    expect(await loader.load()).toBe('BASE')

    await openIntent(root, 'track-invoices', 'I need to track my invoices', () => new Date('2026-09-15T14:02:00Z'))
    const updated = await pollUntil(loader, 'Where we are')
    expect(updated).toContain('Where we are: active intent track-invoices (proposed).')
  })

  test('changes when the intent changes, and is byte-identical otherwise', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'track-invoices', 'first', () => new Date('2026-09-15T14:02:00Z'))
    const loader = createInstructionsLoader({ workspaceRoot: root, basePrompt: 'BASE' })
    loaders.push(loader)
    const before = await loader.load()
    expect(before).toContain('(proposed)')
    // Repeated loads with nothing touched must not churn the prompt.
    for (let i = 0; i < 5; i += 1) expect(await loader.load()).toBe(before)

    await agreeIntent(root, 'track-invoices', 'AGREEMENT', () => new Date('2026-09-15T14:30:00Z'))
    expect(await pollUntil(loader, '(agreed)')).toContain('active intent track-invoices (agreed).')
  })

  test('picks up a change log written under docs/', async () => {
    const root = await tmpWorkspace()
    const loader = createInstructionsLoader({ workspaceRoot: root, basePrompt: 'BASE' })
    loaders.push(loader)
    await loader.load()
    await recordChange(
      root,
      { slug: 'members-list', summary: 'The list shows members.', productToday: 'A members page.' },
      () => new Date('2026-09-15T12:00:00Z'),
    )
    expect(await pollUntil(loader, 'Last kept')).toContain('Last kept: members-list (2026-09-15).')
  })
})
