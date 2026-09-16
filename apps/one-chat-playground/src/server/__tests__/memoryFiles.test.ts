import { afterEach, describe, expect, test } from 'vitest'

import {
  CHANGES_RELATIVE_PATH,
  PRODUCT_RELATIVE_PATH,
  agreeIntent,
  formatChangeLine,
  isValidSlug,
  intentPath,
  freezeIntent,
  noteIntent,
  openIntent,
  parseAgreement,
  parseChangeLine,
  parseIntent,
  readActiveIntent,
  readIntent,
  readLastChange,
  recordChange,
  renderAgreement,
  setIntentStatus,
  type AgreementSections,
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
const REAL_CASES = ['Late invoice for Marie', 'Paid invoice for Léo', 'Overdue invoice for Sam']
const agreement = (observation = 'Invoices are hard to follow.'): AgreementSections => ({
  observation,
  objective: 'Find an invoice in under one minute, measured during the three real cases.',
  whoAndWhen: 'The owner uses it alone, especially at the end of the week.',
  appRole: "I show and update invoices; I don't send email.",
  productSentence: 'One place to follow invoices.',
  journey: 'Open the list, find the invoice, update its status.',
  outOfScope: '| Out of scope | Why |\n| --- | --- |\n| Email reminders | Not available yet |',
  acceptance: '1. Case 1: late invoice → the app shows it as late.\n2. Case 2: paid invoice → the app shows it as paid.\n3. Case 3: overdue invoice → the app shows how late it is.',
  knownLimits: 'One person only.',
  openQuestions: 'None.',
})

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

  test('classifies post-agreement changes and advances the published revision', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(workspace, 'crm', agreement(), REAL_CASES, at('2026-09-15T09:30:00Z'))
    await noteIntent(workspace, 'crm', 'Add the label photo.', at('2026-09-15T10:00:00Z'), 'asked-by-user')
    const pending = await noteIntent(workspace, 'crm', 'I propose a second dashboard.', at('2026-09-15T10:05:00Z'), 'scope-by-me')
    expect(pending).toMatchObject({ revision: 3, approvedRevision: 2 })
    const stillPending = await noteIntent(workspace, 'crm', 'Correct a label.', at('2026-09-15T10:10:00Z'), 'wording')
    expect(stillPending).toMatchObject({ revision: 4, approvedRevision: 2 })
    expect(stillPending.body).toContain('[asked-by-user; v2; no revalidation]')
    expect(stillPending.body).toContain('[scope-by-me; v3; awaiting your yes]')
    expect(stillPending.body).toContain('[wording; v4; no revalidation]')
  })
})

describe('agree_intent', () => {
  test('writes one agreement section and replaces it on re-agreement', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(workspace, 'crm', agreement('One page listing clients.'), REAL_CASES, at('2026-09-15T09:30:00Z'))
    const raw = await workspace.readFile(intentPath('crm'))
    expect(raw.split('\n')[0]).toBe('status: agreed')
    expect(raw.match(/## What we agreed/g)).toHaveLength(1)
    expect(raw).toContain('One page listing clients.')

    await agreeIntent(workspace, 'crm', agreement('One page listing clients, sorted by name.'), REAL_CASES, at('2026-09-15T09:40:00Z'))
    const again = await workspace.readFile(intentPath('crm'))
    expect(again.match(/## What we agreed/g)).toHaveLength(1)
    expect(again).toContain('sorted by name')
  })

  test('entries appended after an agreement stay above it', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(workspace, 'crm', agreement('AGREEMENT'), REAL_CASES, at('2026-09-15T09:30:00Z'))
    await noteIntent(workspace, 'crm', 'LATER ENTRY', at('2026-09-15T10:00:00Z'))
    const raw = await workspace.readFile(intentPath('crm'))
    expect(raw.indexOf('LATER ENTRY')).toBeLessThan(raw.indexOf('## What we agreed'))
    expect(raw).toContain('AGREEMENT')
    expect(raw).toContain('## Real cases')
    expect(raw).toContain('1. Late invoice for Marie')
  })
})

describe('agreement contract', () => {
  test('renders and parses every fixed section', () => {
    const rendered = renderAgreement(agreement())
    expect(rendered).toContain('### Out of scope, with why')
    expect(parseAgreement(rendered)).toEqual(agreement())
  })

  test('rejects agreements without three case-linked acceptance lines', () => {
    expect(() => renderAgreement({ ...agreement(), acceptance: '1. Looks right.' })).toThrow(/Case 1/)
  })
})

describe('set_intent_status', () => {
  test('freezes the validated revision and refuses later mutation', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(workspace, 'crm', agreement(), REAL_CASES, at('2026-09-15T09:30:00Z'))
    await setIntentStatus(workspace, 'crm', 'sketched')
    const frozen = await freezeIntent(workspace, 'crm', at('2026-09-15T10:00:00Z'))
    expect(frozen).toMatchObject({ status: 'frozen', revision: 1, frozenRevision: 1 })
    expect(await workspace.readFile(intentPath('crm'))).toContain('frozen-revision: 1')
    expect(frozen.body).toContain('Revision v1 validated on the sketch; agreement frozen.')
    await expect(setIntentStatus(workspace, 'crm', 'agreed')).rejects.toThrow(/cannot return to agreed/)
    await setIntentStatus(workspace, 'crm', 'kept')
    await expect(openIntent(workspace, 'crm', 'one more thing')).rejects.toThrow(/crm-v2/)
    await expect(noteIntent(workspace, 'crm', 'one more thing')).rejects.toThrow(/crm-v2/)
  })

  test('rewrites only the status line', async () => {
    const workspace = await tmpWorkspace()
    await openIntent(workspace, 'crm', 'opened', at('2026-09-15T09:00:00Z'))
    await agreeIntent(workspace, 'crm', agreement('AGREEMENT'), REAL_CASES, at('2026-09-15T09:30:00Z'))
    expect((await setIntentStatus(workspace, 'crm', 'sketched')).status).toBe('sketched')
    expect((await setIntentStatus(workspace, 'crm', 'building')).status).toBe('building')
    const intent = await setIntentStatus(workspace, 'crm', 'built')
    expect(intent.status).toBe('built')
    expect(intent.agreement).toContain('AGREEMENT')
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
    await agreeIntent(workspace, 'track-invoices', agreement('AGREEMENT'), REAL_CASES, at('2026-09-15T11:30:00Z'))
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
