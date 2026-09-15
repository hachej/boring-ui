import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The agent's whole memory of this app is three kinds of file in the user's
 * own workspace — nothing else, no database, no hidden state:
 *
 *   agent/intents/<slug>.md   one track of work: status, what was said, what
 *                             was agreed. Appended to as the conversation goes.
 *   docs/CHANGES.md           append-only, one line per kept change or undo.
 *   docs/PRODUCT.md           what the app is today, rewritten in place.
 *
 * They are plain Markdown on purpose: the user can read them, and a later
 * documenter session can rewrite them without any migration.
 */
export const INTENTS_RELATIVE_DIR = path.join('agent', 'intents')
export const CHANGES_RELATIVE_PATH = path.join('docs', 'CHANGES.md')
export const PRODUCT_RELATIVE_PATH = path.join('docs', 'PRODUCT.md')

export const INTENT_STATUSES = ['proposed', 'agreed', 'sketched', 'building', 'built', 'kept', 'undone'] as const
export type IntentStatus = (typeof INTENT_STATUSES)[number]

/** Statuses that mean the track is finished and no longer "where we are". */
const CLOSED_STATUSES: readonly IntentStatus[] = ['kept', 'undone']

export const AGREEMENT_HEADING = '## What we agreed'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 64

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug)
}

/** Throws with a message the agent can act on; slugs are a tool contract, not user text. */
export function assertValidSlug(slug: unknown): asserts slug is string {
  if (!isValidSlug(slug)) {
    throw new Error(
      `"${String(slug)}" is not a valid intent name. Use lowercase words joined by single hyphens, for example "track-invoices".`,
    )
  }
}

export function isIntentStatus(value: unknown): value is IntentStatus {
  return typeof value === 'string' && (INTENT_STATUSES as readonly string[]).includes(value)
}

export function intentPath(workspaceRoot: string, slug: string): string {
  assertValidSlug(slug)
  return path.join(workspaceRoot, INTENTS_RELATIVE_DIR, `${slug}.md`)
}

export interface IntentFile {
  readonly slug: string
  readonly status: IntentStatus
  /** Everything between the status line and the agreement heading. */
  readonly body: string
  /** The text under "## What we agreed", or undefined while it is still being understood. */
  readonly agreement: string | undefined
}

/** A clock seam so tests can assert exact timestamps. */
export type Clock = () => Date

export const systemClock: Clock = () => new Date()

/** `2026-09-15` — the date the user would write. */
export function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** `2026-09-15 14:02` — enough to order a conversation, not a log format. */
export function stamp(now: Date): string {
  return `${isoDate(now)} ${now.toISOString().slice(11, 16)}`
}

export function parseIntent(slug: string, raw: string): IntentFile {
  const statusMatch = /^status:\s*(\S+)\s*$/m.exec(raw.split('\n', 1)[0] ?? '')
  const status: IntentStatus = isIntentStatus(statusMatch?.[1]) ? statusMatch[1] : 'proposed'
  const afterStatus = raw.split('\n').slice(1).join('\n')
  const headingIndex = afterStatus.indexOf(AGREEMENT_HEADING)
  if (headingIndex < 0) return { slug, status, body: afterStatus.trim(), agreement: undefined }
  return {
    slug,
    status,
    body: afterStatus.slice(0, headingIndex).trim(),
    agreement: afterStatus.slice(headingIndex + AGREEMENT_HEADING.length).trim() || undefined,
  }
}

export function serializeIntent(intent: Omit<IntentFile, 'slug'>): string {
  const parts = [`status: ${intent.status}`, '', intent.body.trim()]
  if (intent.agreement) parts.push('', AGREEMENT_HEADING, '', intent.agreement.trim())
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

export async function readIntent(workspaceRoot: string, slug: string): Promise<IntentFile | undefined> {
  try {
    return parseIntent(slug, await readFile(intentPath(workspaceRoot, slug), 'utf8'))
  } catch {
    return undefined
  }
}

async function writeIntent(workspaceRoot: string, slug: string, intent: Omit<IntentFile, 'slug'>): Promise<void> {
  const file = intentPath(workspaceRoot, slug)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, serializeIntent(intent), 'utf8')
}

/** Creates the intent (status `proposed`) or appends to the one that exists. */
export async function openIntent(
  workspaceRoot: string,
  slug: string,
  text: string,
  now: Clock = systemClock,
): Promise<{ intent: IntentFile; created: boolean }> {
  const existing = await readIntent(workspaceRoot, slug)
  const entry = `- ${stamp(now())} — ${text.trim()}`
  const next: Omit<IntentFile, 'slug'> = existing
    ? { status: existing.status, body: [existing.body, entry].filter(Boolean).join('\n'), agreement: existing.agreement }
    : { status: 'proposed', body: entry, agreement: undefined }
  await writeIntent(workspaceRoot, slug, next)
  return { intent: { slug, ...next }, created: !existing }
}

/** Appends one timestamped entry. Fails if the intent was never opened. */
export async function noteIntent(
  workspaceRoot: string,
  slug: string,
  text: string,
  now: Clock = systemClock,
): Promise<IntentFile> {
  const existing = await readIntent(workspaceRoot, slug)
  if (!existing) throw new Error(`There is no intent called "${slug}" yet. Open it first.`)
  const next = {
    status: existing.status,
    body: [existing.body, `- ${stamp(now())} — ${text.trim()}`].filter(Boolean).join('\n'),
    agreement: existing.agreement,
  }
  await writeIntent(workspaceRoot, slug, next)
  return { slug, ...next }
}

/** Writes the agreement section and moves the intent to `agreed`. */
export async function agreeIntent(
  workspaceRoot: string,
  slug: string,
  agreement: string,
  now: Clock = systemClock,
): Promise<IntentFile> {
  const existing = (await readIntent(workspaceRoot, slug)) ?? (await openIntent(workspaceRoot, slug, 'Opened.', now)).intent
  const next = { status: 'agreed' as const, body: existing.body, agreement: agreement.trim() }
  await writeIntent(workspaceRoot, slug, next)
  return { slug, ...next }
}

export async function setIntentStatus(
  workspaceRoot: string,
  slug: string,
  status: IntentStatus,
): Promise<IntentFile> {
  const existing = await readIntent(workspaceRoot, slug)
  if (!existing) throw new Error(`There is no intent called "${slug}" yet. Open it first.`)
  const next = { status, body: existing.body, agreement: existing.agreement }
  await writeIntent(workspaceRoot, slug, next)
  return { slug, ...next }
}

export interface ChangeLine {
  readonly date: string
  readonly slug: string
  readonly summary: string
}

export function formatChangeLine(change: ChangeLine): string {
  return `- ${change.date} · ${change.slug} · ${change.summary}`
}

export function parseChangeLine(line: string): ChangeLine | undefined {
  const match = /^-\s*(\d{4}-\d{2}-\d{2})\s*·\s*([^·]+?)\s*·\s*(.+)$/.exec(line.trim())
  if (!match) return undefined
  return { date: match[1]!, slug: match[2]!, summary: match[3]! }
}

/**
 * One kept change or undo: a line in the log the user can read top to bottom,
 * and a fresh description of what the app is now. The pair is written together
 * so the log and the description can never drift apart.
 *
 * Interim: the agent writes both. A later documenter session takes this over.
 */
export async function recordChange(
  workspaceRoot: string,
  input: { slug: string; summary: string; productToday: string },
  now: Clock = systemClock,
): Promise<{ line: string }> {
  assertValidSlug(input.slug)
  const summary = input.summary.trim().replace(/\s+/g, ' ')
  if (!summary) throw new Error('A change needs a one-sentence summary.')
  const productToday = input.productToday.trim()
  if (!productToday) throw new Error('A change needs the new description of what the app is today.')

  const changesFile = path.join(workspaceRoot, CHANGES_RELATIVE_PATH)
  const productFile = path.join(workspaceRoot, PRODUCT_RELATIVE_PATH)
  await mkdir(path.dirname(changesFile), { recursive: true })

  let existing = ''
  try {
    existing = await readFile(changesFile, 'utf8')
  } catch {
    existing = '# Changes\n'
  }
  const line = formatChangeLine({ date: isoDate(now()), slug: input.slug, summary })
  await writeFile(changesFile, `${existing.trimEnd()}\n${line}\n`, 'utf8')
  await writeFile(productFile, `${productToday}\n`, 'utf8')
  return { line }
}

export async function readLastChange(workspaceRoot: string): Promise<ChangeLine | undefined> {
  let raw: string
  try {
    raw = await readFile(path.join(workspaceRoot, CHANGES_RELATIVE_PATH), 'utf8')
  } catch {
    return undefined
  }
  for (const line of raw.split('\n').reverse()) {
    const parsed = parseChangeLine(line)
    if (parsed) return parsed
  }
  return undefined
}

/** The open track: the most recently touched intent that is neither kept nor undone. */
export async function readActiveIntent(workspaceRoot: string): Promise<IntentFile | undefined> {
  const dir = path.join(workspaceRoot, INTENTS_RELATIVE_DIR)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return undefined
  }
  let best: { intent: IntentFile; mtime: number } | undefined
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const slug = name.slice(0, -3)
    if (!isValidSlug(slug)) continue
    const intent = await readIntent(workspaceRoot, slug)
    if (!intent || CLOSED_STATUSES.includes(intent.status)) continue
    const mtime = await stat(path.join(dir, name)).then((s) => s.mtimeMs, () => 0)
    if (!best || mtime > best.mtime) best = { intent, mtime }
  }
  return best?.intent
}

/**
 * The one generated line in the system prompt: where the conversation stands,
 * so the agent picks the thread back up instead of asking the user to repeat
 * themselves. Recomputed only when a memory file changes — never per turn.
 */
export async function whereWeAreLine(workspaceRoot: string): Promise<string | undefined> {
  const [active, lastChange] = await Promise.all([
    readActiveIntent(workspaceRoot),
    readLastChange(workspaceRoot),
  ])
  const parts: string[] = []
  if (active) parts.push(`active intent ${active.slug} (${active.status})`)
  if (lastChange) parts.push(`Last kept: ${lastChange.slug} (${lastChange.date})`)
  if (!parts.length) return undefined
  return `Where we are: ${parts.join('. ')}.`
}
