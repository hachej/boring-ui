import { afterEach, describe, expect, test } from 'vitest'

import { createInstructionsLoader, type InstructionsLoader } from '../instructionsFile'
import { agreeIntent, openIntent, recordChange } from '../memoryFiles'
import { TEST_AGREEMENT, TEST_REAL_CASES, workspaceFixture } from './workspaceFixture'

const loaders: InstructionsLoader[] = []
const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const loader of loaders.splice(0)) loader.close()
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

async function fixture() {
  const bundle = await workspaceFixture('one-chat-instr-')
  disposers.push(bundle.disposeRuntime ?? (async () => {}))
  return bundle.workspace
}

describe('createInstructionsLoader', () => {
  test('appends the standing instructions to the base prompt', async () => {
    const workspace = await fixture()
    await workspace.mkdir('agent', { recursive: true })
    await workspace.writeFile('agent/instructions.md', 'Always answer in French.')
    const loader = createInstructionsLoader({ workspace, basePrompt: 'BASE' })
    loaders.push(loader)
    const prompt = await loader.load()
    expect(prompt).toContain('BASE')
    expect(prompt).toContain('Always answer in French.')
    expect(prompt).toContain('agent/instructions.md')
  })

  test('returns the base prompt alone when the file is missing', async () => {
    const workspace = await fixture()
    const loader = createInstructionsLoader({ workspace, basePrompt: 'BASE' })
    loaders.push(loader)
    expect(await loader.load()).toBe('BASE')
  })

  test('does not associate stale rendered text with a concurrent newer fingerprint', async () => {
    const workspace = await fixture()
    await workspace.mkdir('agent', { recursive: true })
    await workspace.writeFile('agent/instructions.md', 'v1')
    let raced = false
    const racingWorkspace = new Proxy(workspace, {
      get(target, property, receiver) {
        if (property !== 'readFile') return Reflect.get(target, property, receiver)
        return async (relativePath: string) => {
          const value = await target.readFile(relativePath)
          if (relativePath === 'agent/instructions.md' && !raced) {
            raced = true
            await target.writeFile(relativePath, 'v2')
          }
          return value
        }
      },
    })
    const loader = createInstructionsLoader({ workspace: racingWorkspace, basePrompt: 'BASE' })
    loaders.push(loader)
    expect(await loader.load()).toContain('v1')
    expect(await loader.load()).toContain('v2')
  })

  test('is byte-identical until an adapter edit changes a tracked mtime', async () => {
    const workspace = await fixture()
    await workspace.mkdir('agent', { recursive: true })
    await workspace.writeFile('agent/instructions.md', 'v1')
    const loader = createInstructionsLoader({ workspace, basePrompt: 'BASE' })
    loaders.push(loader)
    const before = await loader.load()
    for (let index = 0; index < 5; index += 1) expect(await loader.load()).toBe(before)

    await workspace.writeFile('agent/instructions.md', 'v2')
    expect(await loader.load()).toContain('v2')
  })
})

describe('the "where were we" line', () => {
  test('is absent while there is no memory, and appears once an intent exists', async () => {
    const workspace = await fixture()
    const loader = createInstructionsLoader({ workspace, basePrompt: 'BASE' })
    loaders.push(loader)
    expect(await loader.load()).toBe('BASE')

    await openIntent(workspace, 'track-invoices', 'I need to track my invoices', () => new Date('2026-09-15T14:02:00Z'))
    expect(await loader.load()).toContain('Where we are: active intent track-invoices (proposed).')
  })

  test('changes when the active intent changes, and is byte-identical otherwise', async () => {
    const workspace = await fixture()
    await openIntent(workspace, 'track-invoices', 'first', () => new Date('2026-09-15T14:02:00Z'))
    const loader = createInstructionsLoader({ workspace, basePrompt: 'BASE' })
    loaders.push(loader)
    const before = await loader.load()
    expect(before).toContain('(proposed)')
    for (let index = 0; index < 5; index += 1) expect(await loader.load()).toBe(before)

    await agreeIntent(workspace, 'track-invoices', TEST_AGREEMENT, TEST_REAL_CASES, () => new Date('2026-09-15T14:30:00Z'))
    expect(await loader.load()).toContain('active intent track-invoices (agreed).')
  })

  test('detects when an existing different intent becomes active in place', async () => {
    const workspace = await fixture()
    await workspace.mkdir('agent/intents', { recursive: true })
    await workspace.writeFile('agent/intents/first.md', 'status: proposed\n\nfirst\n')
    await workspace.writeFile('agent/intents/second.md', 'status: kept\n\nsecond\n')
    const loader = createInstructionsLoader({ workspace, basePrompt: 'BASE' })
    loaders.push(loader)
    expect(await loader.load()).toContain('active intent first')

    await new Promise((resolve) => setTimeout(resolve, 5))
    await workspace.writeFile('agent/intents/second.md', 'status: proposed\n\nsecond\n')
    expect(await loader.load()).toContain('active intent second')
  })

  test('picks up a change log written through the adapter', async () => {
    const workspace = await fixture()
    const loader = createInstructionsLoader({ workspace, basePrompt: 'BASE' })
    loaders.push(loader)
    await loader.load()
    await recordChange(
      workspace,
      {
        slug: 'members-list',
        summary: 'The list shows members.',
        productToday: 'A members page.',
      },
      () => new Date('2026-09-15T12:00:00Z'),
    )
    expect(await loader.load()).toContain('Last kept: members-list (2026-09-15).')
  })
})
