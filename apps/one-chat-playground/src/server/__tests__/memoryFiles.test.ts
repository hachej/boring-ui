import { afterEach, describe, expect, test } from 'vitest'

import {
  CHANGES_RELATIVE_PATH,
  PRODUCT_RELATIVE_PATH,
  agreeIntent,
  formatChangeLine,
  isValidSlug,
  intentPath,
  noteIntent,
  openIntent,
  parseChangeLine,
  parseIntent,
  readActiveIntent,
  readIntent,
  readLastChange,
  recordChange,
  setIntentStatus,
  whereWeAreLine,
} from '../memoryFiles'
import { workspaceFixture } from './workspaceFixture'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

async function tmpWorkspace() {
  const bundle = await workspaceFixture('one-chat-memory-')
  disposers.push(bundle.disposeRuntime ?? (async () => {}))
  return bundle.workspace
}

const at = (iso: string) => () => new Date(iso)

describe('slugs', () => {
  test('accepts kebab-case only', () => {
    for (const good of ['track-invoices', 'crm', 'a1-b2-c3']) expect(isValidSlug(good)).toBe(true)
    for (const bad of ['Track-Invoices', 'track invoices', 'track_invoices', '-track', 'track-', 'track--x', '', '../escape', 'a'.repeat(65)]) {
      expect(isValidSlug(bad), bad).toBe(false)
    }
  })

  test('intentPath refuses a traversing slug', () => {
    expect(() => intentPath('../../etc/passwd')).toThrow(/not a valid intent name/)
  })
})

describe('open_intent', () => {
  test('creates the file with status proposed and one timestamped entry', async () => {
    const workspace = await tmpWorkspace()
    const { created, intent } = await openIntent(workspace, 'track-invoices', 'I need to track my invoices', at('2026-09-15T14:02:00Z'))
    expect(created).toBe(true)
    expect(intent.status).toBe('proposed')
    const raw = await workspace.readFile(intentPath('track-invoices'))
    expect(raw.split('\n').slice(0, 2)).toEqual(['status: proposed', 'title: invoice list'])
    expect(intent.title).toBe('invoice list')
    expect(raw).toContain('- 2026-09-15 14:02 — I need to track my invoices')
  })

  test('appends to an existing intent and keeps its status', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'track-invoices', 'first', at('2026-09-15T14:02:00Z'))
    await setIntentStatus(workspace, 'track-invoices', 'building')
    const { created } = await openIntent(workspace, 'track-invoices', 'second', at('2026-09-15T15:00:00Z'))
    expect(created).toBe(false)
    const intent = await readIntent(workspace, 'track-invoices')
    expect(intent?.status).toBe('building')
    expect(intent?.body).toContain('first')
    expect(intent?.body).toContain('second')
  })
})

describe('note_intent', () => {
  test('appends an entry', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    const intent = await noteIntent(workspace, 'crm', 'They bill monthly.', at('2026-09-15T09:05:00Z'))
    expect(intent.body).toContain('- 2026-09-15 09:05 — They bill monthly.')
  })

  test('refuses an intent that was never opened', async () => {
    await expect(noteIntent(await tmpWorkspace(), 'ghost', 'x')).rejects.toThrow(/no intent called "ghost"/)
  })
})

describe('agree_intent', () => {
  test('writes one agreement section and replaces it on re-agreement', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(workspace, 'crm', 'One page listing clients.', at('2026-09-15T09:30:00Z'))
    const raw = await workspace.readFile(intentPath('crm'))
    expect(raw.split('\n')[0]).toBe('status: agreed')
    expect(raw.match(/## What we agreed/g)).toHaveLength(1)
    expect(raw).toContain('One page listing clients.')

    await agreeIntent(workspace, 'crm', 'One page listing clients, sorted by name.', at('2026-09-15T09:40:00Z'))
    const again = await workspace.readFile(intentPath('crm'))
    expect(again.match(/## What we agreed/g)).toHaveLength(1)
    expect(again).toContain('sorted by name')
  })

  test('entries appended after an agreement stay above it', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(workspace, 'crm', 'AGREEMENT', at('2026-09-15T09:30:00Z'))
    await noteIntent(workspace, 'crm', 'LATER ENTRY', at('2026-09-15T10:00:00Z'))
    const raw = await workspace.readFile(intentPath('crm'))
    expect(raw.indexOf('LATER ENTRY')).toBeLessThan(raw.indexOf('## What we agreed'))
    expect(raw).toContain('AGREEMENT')
  })
})

describe('set_intent_status', () => {
  test('rewrites only the status line', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(workspace, 'crm', 'AGREEMENT', at('2026-09-15T09:30:00Z'))
    expect((await setIntentStatus(workspace, 'crm', 'sketched')).status).toBe('sketched')
    expect((await setIntentStatus(workspace, 'crm', 'building')).status).toBe('building')
    const intent = await setIntentStatus(workspace, 'crm', 'built')
    expect(intent.status).toBe('built')
    expect(intent.agreement).toBe('AGREEMENT')
    expect(intent.body).toContain('opened')
  })
})

describe('record_change', () => {
  test('appends one log line and rewrites the product description', async () => {
    const workspace = await tmpWorkspace()
    await recordChange(
      workspace,
      {
        slug: 'members-list',
        summary: 'The list shows members.',
        productToday: 'A members page.',
      },
      at('2026-09-15T12:00:00Z'),
    )
    await recordChange(
      workspace,
      {
        slug: 'track-invoices',
        summary: 'Invoices can be tracked.',
        productToday: 'A members page and invoices.',
      },
      at('2026-09-16T12:00:00Z'),
    )
    const changes = await workspace.readFile(CHANGES_RELATIVE_PATH)
    expect(changes).toContain('- 2026-09-15 · members-list · The list shows members.')
    expect(changes).toContain('- 2026-09-16 · track-invoices · Invoices can be tracked.')
    expect(changes.indexOf('members-list')).toBeLessThan(changes.indexOf('track-invoices'))
    expect(await workspace.readFile(PRODUCT_RELATIVE_PATH)).toBe('A members page and invoices.\n')
  })

  test('refuses an empty summary', async () => {
    await expect(
      recordChange(await tmpWorkspace(), {
        slug: 'x',
        summary: '  ',
        productToday: 'y',
      }),
    ).rejects.toThrow(/one-sentence summary/)
  })
})

describe('change lines', () => {
  test('round-trip', () => {
    const line = formatChangeLine({
      date: '2026-09-15',
      slug: 'members-list',
      summary: 'A · B',
    })
    expect(parseChangeLine(line)).toEqual({
      date: '2026-09-15',
      slug: 'members-list',
      summary: 'A · B',
    })
  })

  test('ignores prose lines', () => expect(parseChangeLine('# Changes')).toBeUndefined())
})

describe('parseIntent', () => {
  test('defaults a missing or unknown status to proposed', () => {
    expect(parseIntent('x', 'no status here\nbody').status).toBe('proposed')
    expect(parseIntent('x', 'status: nonsense\nbody').status).toBe('proposed')
  })

  test('reads an authored human title without leaving it in the body', () => {
    const intent = parseIntent('track-suppliers', 'status: agreed\ntitle: supplier list\n\n- request\n')
    expect(intent.title).toBe('supplier list')
    expect(intent.body).toBe('- request')
  })
})

describe('where were we', () => {
  test('is undefined with no memory at all', async () => {
    expect(await whereWeAreLine(await tmpWorkspace())).toBeUndefined()
  })

  test('names the most recently touched open intent and the last kept change', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'members-list', 'older', at('2026-09-14T09:00:00Z'))
    await recordChange(
      workspace,
      {
        slug: 'members-list',
        summary: 'Members list.',
        productToday: 'A members page.',
      },
      at('2026-09-15T10:00:00Z'),
    )
    await setIntentStatus(workspace, 'members-list', 'kept')
    await openIntent(workspace, 'track-invoices', 'newer', at('2026-09-15T11:00:00Z'))
    await agreeIntent(workspace, 'track-invoices', 'AGREEMENT', at('2026-09-15T11:30:00Z'))
    expect(await whereWeAreLine(workspace)).toBe('Where we are: active intent track-invoices (agreed). Last kept: members-list (2026-09-15).')
  })

  test('skips kept and undone intents', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'a', 'x', at('2026-09-15T09:00:00Z'))
    await setIntentStatus(workspace, 'a', 'kept')
    await openIntent(workspace, 'b', 'x', at('2026-09-15T09:10:00Z'))
    await setIntentStatus(workspace, 'b', 'undone')
    expect(await readActiveIntent(workspace)).toBeUndefined()
    expect(await whereWeAreLine(workspace)).toBeUndefined()
  })

  test('ignores files that are not intents', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'real', 'x', at('2026-09-15T09:00:00Z'))
    await workspace.writeFile('agent/intents/README.txt', 'not an intent')
    await workspace.writeFile('agent/intents/Not A Slug.md', 'status: proposed')
    expect((await readActiveIntent(workspace))?.slug).toBe('real')
  })

  test('reads the last change even when the log has trailing prose', async () => {
    const workspace = await tmpWorkspace()
    await recordChange(workspace, { slug: 'one', summary: 'First.', productToday: 'p' }, at('2026-09-15T10:00:00Z'))
    await workspace.writeFile(CHANGES_RELATIVE_PATH, `${await workspace.readFile(CHANGES_RELATIVE_PATH)}\n(nothing else yet)\n`)
    expect((await readLastChange(workspace))?.slug).toBe('one')
  })
})
