import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

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

async function tmpWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'one-chat-memory-'))
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
    expect(() => intentPath('/ws', '../../etc/passwd')).toThrow(/not a valid intent name/)
  })
})

describe('open_intent', () => {
  test('creates the file with status proposed and one timestamped entry', async () => {
    const root = await tmpWorkspace()
    const { created, intent } = await openIntent(root, 'track-invoices', 'I need to track my invoices', at('2026-09-15T14:02:00Z'))
    expect(created).toBe(true)
    expect(intent.status).toBe('proposed')
    const raw = await readFile(intentPath(root, 'track-invoices'), 'utf8')
    expect(raw.split('\n')[0]).toBe('status: proposed')
    expect(raw).toContain('- 2026-09-15 14:02 — I need to track my invoices')
  })

  test('appends to an existing intent and keeps its status', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'track-invoices', 'first', at('2026-09-15T14:02:00Z'))
    await setIntentStatus(root, 'track-invoices', 'building')
    const { created } = await openIntent(root, 'track-invoices', 'second', at('2026-09-15T15:00:00Z'))
    expect(created).toBe(false)
    const intent = await readIntent(root, 'track-invoices')
    expect(intent?.status).toBe('building')
    expect(intent?.body).toContain('first')
    expect(intent?.body).toContain('second')
  })
})

describe('note_intent', () => {
  test('appends an entry', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    const intent = await noteIntent(root, 'crm', 'They bill monthly.', at('2026-09-15T09:05:00Z'))
    expect(intent.body).toContain('- 2026-09-15 09:05 — They bill monthly.')
  })

  test('refuses an intent that was never opened', async () => {
    const root = await tmpWorkspace()
    await expect(noteIntent(root, 'ghost', 'x')).rejects.toThrow(/no intent called "ghost"/)
  })
})

describe('agree_intent', () => {
  test('writes the agreement section once and sets status agreed', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(root, 'crm', 'One page listing clients.', at('2026-09-15T09:30:00Z'))
    const raw = await readFile(intentPath(root, 'crm'), 'utf8')
    expect(raw.split('\n')[0]).toBe('status: agreed')
    expect(raw.match(/## What we agreed/g)).toHaveLength(1)
    expect(raw).toContain('One page listing clients.')

    // Re-agreeing replaces the section instead of stacking a second one.
    await agreeIntent(root, 'crm', 'One page listing clients, sorted by name.', at('2026-09-15T09:40:00Z'))
    const again = await readFile(intentPath(root, 'crm'), 'utf8')
    expect(again.match(/## What we agreed/g)).toHaveLength(1)
    expect(again).toContain('sorted by name')
  })

  test('entries appended after an agreement stay above it', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(root, 'crm', 'AGREEMENT', at('2026-09-15T09:30:00Z'))
    await noteIntent(root, 'crm', 'LATER ENTRY', at('2026-09-15T10:00:00Z'))
    const raw = await readFile(intentPath(root, 'crm'), 'utf8')
    expect(raw.indexOf('LATER ENTRY')).toBeLessThan(raw.indexOf('## What we agreed'))
    expect(raw).toContain('AGREEMENT')
  })
})

describe('set_intent_status', () => {
  test('rewrites only the status line', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(root, 'crm', 'AGREEMENT', at('2026-09-15T09:30:00Z'))
    const sketched = await setIntentStatus(root, 'crm', 'sketched')
    expect(sketched.status).toBe('sketched')
    const building = await setIntentStatus(root, 'crm', 'building')
    expect(building.status).toBe('building')
    const intent = await setIntentStatus(root, 'crm', 'built')
    expect(intent.status).toBe('built')
    expect(intent.agreement).toBe('AGREEMENT')
    expect(intent.body).toContain('opened')
  })
})

describe('record_change', () => {
  test('appends one log line and rewrites the product description', async () => {
    const root = await tmpWorkspace()
    await recordChange(root, { slug: 'members-list', summary: 'The list shows members.', productToday: 'A members page.' }, at('2026-09-15T12:00:00Z'))
    await recordChange(root, { slug: 'track-invoices', summary: 'Invoices can be tracked.', productToday: 'A members page and invoices.' }, at('2026-09-16T12:00:00Z'))
    const changes = await readFile(path.join(root, CHANGES_RELATIVE_PATH), 'utf8')
    expect(changes).toContain('- 2026-09-15 · members-list · The list shows members.')
    expect(changes).toContain('- 2026-09-16 · track-invoices · Invoices can be tracked.')
    expect(changes.indexOf('members-list')).toBeLessThan(changes.indexOf('track-invoices'))
    expect(await readFile(path.join(root, PRODUCT_RELATIVE_PATH), 'utf8')).toBe('A members page and invoices.\n')
  })

  test('refuses an empty summary', async () => {
    const root = await tmpWorkspace()
    await expect(recordChange(root, { slug: 'x', summary: '  ', productToday: 'y' })).rejects.toThrow(/one-sentence summary/)
  })
})

describe('change lines', () => {
  test('round-trip', () => {
    const line = formatChangeLine({ date: '2026-09-15', slug: 'members-list', summary: 'A · B' })
    expect(parseChangeLine(line)).toEqual({ date: '2026-09-15', slug: 'members-list', summary: 'A · B' })
  })

  test('ignores prose lines', () => {
    expect(parseChangeLine('# Changes')).toBeUndefined()
  })
})

describe('parseIntent', () => {
  test('defaults a missing or unknown status to proposed', () => {
    expect(parseIntent('x', 'no status here\nbody').status).toBe('proposed')
    expect(parseIntent('x', 'status: nonsense\nbody').status).toBe('proposed')
  })
})

describe('where were we', () => {
  test('is undefined with no memory at all', async () => {
    expect(await whereWeAreLine(await tmpWorkspace())).toBeUndefined()
  })

  test('names the most recently touched open intent and the last kept change', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'members-list', 'older', at('2026-09-14T09:00:00Z'))
    await recordChange(root, { slug: 'members-list', summary: 'Members list.', productToday: 'A members page.' }, at('2026-09-15T10:00:00Z'))
    await setIntentStatus(root, 'members-list', 'kept')
    await openIntent(root, 'track-invoices', 'newer', at('2026-09-15T11:00:00Z'))
    await agreeIntent(root, 'track-invoices', 'AGREEMENT', at('2026-09-15T11:30:00Z'))
    expect(await whereWeAreLine(root)).toBe(
      'Where we are: active intent track-invoices (agreed). Last kept: members-list (2026-09-15).',
    )
  })

  test('skips kept and undone intents', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'a', 'x', at('2026-09-15T09:00:00Z'))
    await setIntentStatus(root, 'a', 'kept')
    await openIntent(root, 'b', 'x', at('2026-09-15T09:10:00Z'))
    await setIntentStatus(root, 'b', 'undone')
    expect(await readActiveIntent(root)).toBeUndefined()
    expect(await whereWeAreLine(root)).toBeUndefined()
  })

  test('ignores files that are not intents', async () => {
    const root = await tmpWorkspace()
    await openIntent(root, 'real', 'x', at('2026-09-15T09:00:00Z'))
    await writeFile(path.join(root, 'agent', 'intents', 'README.txt'), 'not an intent')
    await writeFile(path.join(root, 'agent', 'intents', 'Not A Slug.md'), 'status: proposed')
    expect((await readActiveIntent(root))?.slug).toBe('real')
  })

  test('reads the last change even when the log has trailing prose', async () => {
    const root = await tmpWorkspace()
    await recordChange(root, { slug: 'one', summary: 'First.', productToday: 'p' }, at('2026-09-15T10:00:00Z'))
    const file = path.join(root, CHANGES_RELATIVE_PATH)
    await writeFile(file, `${await readFile(file, 'utf8')}\n(nothing else yet)\n`)
    expect((await readLastChange(root))?.slug).toBe('one')
  })
})
