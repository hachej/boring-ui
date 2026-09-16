import { afterEach, describe, expect, test } from 'vitest'
import type { AgentTool } from '@hachej/boring-agent/shared'

import { CHANGES_RELATIVE_PATH, PRODUCT_RELATIVE_PATH, intentPath, readIntent } from '../memoryFiles'
import { createMemoryTools } from '../memoryTools'
import { workspaceFixture } from './workspaceFixture'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

const REAL_CASES = ['Late invoice for Marie', 'Paid invoice for Léo', 'Overdue invoice for Sam']
const AGREEMENT = {
  observation: 'Invoices are hard to follow.',
  objective: 'Find an invoice in under one minute, measured on the real cases.',
  whoAndWhen: 'The owner, at the end of the week.',
  appRole: "I update invoice status; I don't send email.",
  productSentence: 'One place to follow invoices.',
  journey: 'Open, find, update.',
  outOfScope: '| Out of scope | Why |\n| --- | --- |\n| Email | Not available |',
  acceptance: '1. Case 1: late → shown late.\n2. Case 2: paid → shown paid.\n3. Case 3: overdue → delay shown.',
  knownLimits: 'One person.',
  openQuestions: 'None.',
}

async function fixture() {
  const bundle = await workspaceFixture('one-chat-memtools-')
  disposers.push(bundle.disposeRuntime ?? (async () => {}))
  const workspace = bundle.workspace
  const tools = createMemoryTools({
    workspace,
    invalidatePrompt: () => {},
    now: () => new Date('2026-09-15T14:02:00Z'),
  })
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const call = async (name: string, params: Record<string, unknown>) => {
    const tool = byName.get(name)
    if (!tool) throw new Error(`no tool ${name}`)
    const result = await (tool as AgentTool).execute(params as never, {} as never)
    const body = result.content.map((part) => ('text' in part ? part.text : '')).join('')
    return { body, isError: result.isError === true }
  }
  return { workspace, call, names: [...byName.keys()] }
}

describe('memory tools', () => {
  test('exposes exactly the five memory tools', async () => {
    expect((await fixture()).names).toEqual(['open_intent', 'note_intent', 'agree_intent', 'set_intent_status', 'record_change'])
  })

  test('open_intent creates, then reports reopening and the missing agreement', async () => {
    const { workspace, call } = await fixture()
    const first = await call('open_intent', {
      slug: 'track-invoices',
      text: 'I need to track my invoices',
    })
    expect(first.isError).toBe(false)
    expect(first.body).toContain('Opened track-invoices (proposed)')
    expect(first.body).toContain('no agreement yet')
    expect(await workspace.readFile(intentPath('track-invoices'))).toContain('I need to track my invoices')
    expect(
      (
        await call('open_intent', {
          slug: 'track-invoices',
          text: 'actually also credit notes',
        })
      ).body,
    ).toContain('Reopened track-invoices')
  })

  test('validates slugs and missing intents', async () => {
    const { call } = await fixture()
    expect((await call('open_intent', { slug: '../escape', text: 'x' })).isError).toBe(true)
    expect((await call('note_intent', { slug: 'ghost', text: 'x' })).body).toContain('no intent called "ghost"')
  })

  test('agree_intent sets the agreement and status', async () => {
    const { workspace, call } = await fixture()
    await call('open_intent', { slug: 'crm', text: 'build a crm' })
    expect(
      (
        await call('agree_intent', {
          slug: 'crm',
          realCases: REAL_CASES,
          agreement: AGREEMENT,
        })
      ).body,
    ).toContain('Agreed on crm')
    const intent = await readIntent(workspace, 'crm')
    expect(intent?.status).toBe('agreed')
    expect(intent?.agreement).toContain('### Observation')
    expect(intent?.realCases).toEqual(REAL_CASES)
    expect(intent?.revision).toBe(1)
    expect((await call('open_intent', { slug: 'crm', text: 'more' })).body).toContain('already has an agreement')
  })

  test('agree_intent refuses an empty agreement', async () => {
    const { call } = await fixture()
    await call('open_intent', { slug: 'crm', text: 'x' })
    expect((await call('agree_intent', { slug: 'crm', realCases: REAL_CASES, agreement: {} })).isError).toBe(true)
  })

  test('set_intent_status validates and persists status', async () => {
    const { workspace, call } = await fixture()
    await call('open_intent', { slug: 'crm', text: 'x' })
    expect((await call('set_intent_status', { slug: 'crm', status: 'shipped' })).isError).toBe(true)
    for (const status of ['sketched', 'building', 'built']) {
      expect((await call('set_intent_status', { slug: 'crm', status })).body).toContain(`crm is now ${status}`)
    }
    expect((await readIntent(workspace, 'crm'))?.status).toBe('built')
  })

  test('classifies revisions and freezes a kept sketch', async () => {
    const { workspace, call } = await fixture()
    await call('open_intent', { slug: 'crm', text: 'x' })
    await call('agree_intent', { slug: 'crm', realCases: REAL_CASES, agreement: AGREEMENT })
    await call('note_intent', { slug: 'crm', text: 'I propose another view.', changeClass: 'scope-by-me' })
    expect(await readIntent(workspace, 'crm')).toMatchObject({ revision: 2, approvedRevision: 1 })
    expect((await call('set_intent_status', { slug: 'crm', status: 'frozen' })).body).toContain('awaiting the user\'s yes')
    await call('agree_intent', { slug: 'crm', realCases: REAL_CASES, agreement: AGREEMENT })
    expect(await readIntent(workspace, 'crm')).toMatchObject({ revision: 2, approvedRevision: 2 })
    expect((await readIntent(workspace, 'crm'))?.body).toContain('Revision v2 approved by the user.')
    await call('set_intent_status', { slug: 'crm', status: 'frozen' })
    expect((await readIntent(workspace, 'crm'))?.status).toBe('frozen')
    expect((await call('open_intent', { slug: 'crm', text: 'later request' })).body).toContain('crm-v2')
  })

  test('record_change logs, rewrites the description, and closes the track', async () => {
    const { workspace, call } = await fixture()
    await call('open_intent', { slug: 'members-list', text: 'x' })
    const result = await call('record_change', {
      slug: 'members-list',
      summary: 'The list now shows members.',
      productToday: 'A page listing members.',
    })
    expect(result.body).toContain('- 2026-09-15 · members-list · The list now shows members.')
    expect(await workspace.readFile(CHANGES_RELATIVE_PATH)).toContain('members-list')
    expect(await workspace.readFile(PRODUCT_RELATIVE_PATH)).toBe('A page listing members.\n')
    expect((await readIntent(workspace, 'members-list'))?.status).toBe('kept')
  })

  test('record_change leaves an undone track undone', async () => {
    const { workspace, call } = await fixture()
    await call('open_intent', { slug: 'members-list', text: 'x' })
    await call('set_intent_status', { slug: 'members-list', status: 'undone' })
    await call('record_change', {
      slug: 'members-list',
      summary: 'Taken back.',
      productToday: 'A page.',
    })
    expect((await readIntent(workspace, 'members-list'))?.status).toBe('undone')
  })
})
