import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { AgentTool } from '@hachej/boring-agent/shared'

import { CHANGES_RELATIVE_PATH, PRODUCT_RELATIVE_PATH, intentPath, readIntent } from '../memoryFiles'
import { createMemoryTools } from '../memoryTools'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-memtools-'))
  const tools = createMemoryTools({ workspaceRoot: root, now: () => new Date('2026-09-15T14:02:00Z') })
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const call = async (name: string, params: Record<string, unknown>) => {
    const tool = byName.get(name)
    if (!tool) throw new Error(`no tool ${name}`)
    const result = await (tool as AgentTool).execute(params as never, {} as never)
    const body = result.content.map((part) => ('text' in part ? part.text : '')).join('')
    return { body, isError: result.isError === true }
  }
  return { root, call, names: [...byName.keys()] }
}

describe('memory tools', () => {
  test('exposes exactly the five memory tools', async () => {
    const { names } = await fixture()
    expect(names).toEqual(['open_intent', 'note_intent', 'agree_intent', 'set_intent_status', 'record_change'])
  })

  test('open_intent creates, then reports reopening and the missing agreement', async () => {
    const { root, call } = await fixture()
    const first = await call('open_intent', { slug: 'track-invoices', text: 'I need to track my invoices' })
    expect(first.isError).toBe(false)
    expect(first.body).toContain('Opened track-invoices (proposed)')
    expect(first.body).toContain('no agreement yet')
    expect(await readFile(intentPath(root, 'track-invoices'), 'utf8')).toContain('I need to track my invoices')

    const second = await call('open_intent', { slug: 'track-invoices', text: 'actually also credit notes' })
    expect(second.body).toContain('Reopened track-invoices')
  })

  test('open_intent rejects a slug that is not kebab-case', async () => {
    const { call } = await fixture()
    const result = await call('open_intent', { slug: '../escape', text: 'x' })
    expect(result.isError).toBe(true)
    expect(result.body).toContain('not a valid intent name')
  })

  test('note_intent errors plainly when the track does not exist', async () => {
    const { call } = await fixture()
    const result = await call('note_intent', { slug: 'ghost', text: 'x' })
    expect(result.isError).toBe(true)
    expect(result.body).toContain('no intent called "ghost"')
  })

  test('agree_intent sets the agreement and the status', async () => {
    const { root, call } = await fixture()
    await call('open_intent', { slug: 'crm', text: 'build a crm' })
    const result = await call('agree_intent', { slug: 'crm', agreement: 'One page listing clients.' })
    expect(result.body).toContain('Agreed on crm')
    const intent = await readIntent(root, 'crm')
    expect(intent?.status).toBe('agreed')
    expect(intent?.agreement).toBe('One page listing clients.')
    expect((await call('open_intent', { slug: 'crm', text: 'more' })).body).toContain('already has an agreement')
  })

  test('agree_intent refuses an empty agreement', async () => {
    const { call } = await fixture()
    await call('open_intent', { slug: 'crm', text: 'x' })
    expect((await call('agree_intent', { slug: 'crm', agreement: '   ' })).isError).toBe(true)
  })

  test('set_intent_status validates the status', async () => {
    const { root, call } = await fixture()
    await call('open_intent', { slug: 'crm', text: 'x' })
    expect((await call('set_intent_status', { slug: 'crm', status: 'shipped' })).isError).toBe(true)
    expect((await call('set_intent_status', { slug: 'crm', status: 'sketched' })).body).toContain('crm is now sketched')
    expect((await call('set_intent_status', { slug: 'crm', status: 'building' })).body).toContain('crm is now building')
    expect((await call('set_intent_status', { slug: 'crm', status: 'built' })).body).toContain('crm is now built')
    expect((await readIntent(root, 'crm'))?.status).toBe('built')
  })

  test('record_change logs one line, rewrites the description, and closes the track', async () => {
    const { root, call } = await fixture()
    await call('open_intent', { slug: 'members-list', text: 'x' })
    const result = await call('record_change', {
      slug: 'members-list',
      summary: 'The list now shows members.',
      productToday: 'A page listing members.',
    })
    expect(result.body).toContain('- 2026-09-15 · members-list · The list now shows members.')
    expect(await readFile(path.join(root, CHANGES_RELATIVE_PATH), 'utf8')).toContain('members-list')
    expect(await readFile(path.join(root, PRODUCT_RELATIVE_PATH), 'utf8')).toBe('A page listing members.\n')
    expect((await readIntent(root, 'members-list'))?.status).toBe('kept')
  })

  test('record_change leaves an undone track undone', async () => {
    const { root, call } = await fixture()
    await call('open_intent', { slug: 'members-list', text: 'x' })
    await call('set_intent_status', { slug: 'members-list', status: 'undone' })
    await call('record_change', { slug: 'members-list', summary: 'Taken back.', productToday: 'A page.' })
    expect((await readIntent(root, 'members-list'))?.status).toBe('undone')
  })
})
