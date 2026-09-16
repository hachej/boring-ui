import path from 'node:path'

import type { Workspace } from '@hachej/boring-agent/shared'

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

export const INTENT_STATUSES = ['proposed', 'agreed', 'sketched', 'frozen', 'building', 'built', 'kept', 'undone'] as const
export type IntentStatus = (typeof INTENT_STATUSES)[number]

export const INTENT_CHANGE_CLASSES = ['asked-by-user', 'wording', 'scope-by-me'] as const
export type IntentChangeClass = (typeof INTENT_CHANGE_CLASSES)[number]

/** Statuses that mean the track is finished and no longer "where we are". */
const CLOSED_STATUSES: readonly IntentStatus[] = ['kept', 'undone']

export const REAL_CASES_HEADING = '## Real cases'
export const AGREEMENT_HEADING = '## What we agreed'

export const AGREEMENT_SECTIONS = [
  ['observation', 'Observation'],
  ['objective', 'Objective'],
  ['whoAndWhen', 'Who and when'],
  ['appRole', "What I do in the app / what I don't"],
  ['productSentence', 'The product in one sentence'],
  ['journey', 'The journey'],
  ['outOfScope', 'Out of scope, with why'],
  ['acceptance', 'Acceptance'],
  ['knownLimits', 'Known limits'],
  ['openQuestions', 'Open questions'],
] as const

export type AgreementSectionKey = (typeof AGREEMENT_SECTIONS)[number][0]
export type AgreementSections = Readonly<Record<AgreementSectionKey, string>>

function nonEmptySection(value: unknown, heading: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Agreement section "${heading}" cannot be empty.`)
  return value.trim()
}

/** Render the fixed agreement contract from user-worded section values. */
export function renderAgreement(sections: AgreementSections): string {
  const rendered = AGREEMENT_SECTIONS.map(([key, heading]) => `### ${heading}\n\n${nonEmptySection(sections[key], heading)}`).join('\n\n')
  const parsed = parseAgreement(rendered)
  if (!parsed) throw new Error('Agreement is missing one or more required sections.')
  if (!/^\s*\|.+\|\s*$/m.test(parsed.outOfScope) || !/^\s*\|\s*:?-+/m.test(parsed.outOfScope)) {
    throw new Error('Agreement section "Out of scope, with why" must be a Markdown table.')
  }
  for (const number of [1, 2, 3]) {
    if (!new RegExp(`^\\s*${number}\\.\\s+.*Case\\s+${number}\\b`, 'im').test(parsed.acceptance)) {
      throw new Error(`Acceptance item ${number} must reference Case ${number}.`)
    }
  }
  return rendered
}

/** Parse only complete fixed-shape agreements; legacy prose remains readable as raw text. */
export function parseAgreement(raw: string): AgreementSections | undefined {
  const values = new Map<AgreementSectionKey, string>()
  const matches = [...raw.matchAll(/^###\s+(.+?)\s*$/gm)]
  for (let index = 0; index < matches.length; index += 1) {
    const heading = matches[index]![1]!.trim()
    const definition = AGREEMENT_SECTIONS.find(([, expected]) => expected === heading)
    if (!definition) continue
    const start = (matches[index]!.index ?? 0) + matches[index]![0].length
    const end = matches[index + 1]?.index ?? raw.length
    values.set(definition[0], raw.slice(start, end).trim())
  }
  if (AGREEMENT_SECTIONS.some(([key]) => !values.get(key))) return undefined
  return Object.fromEntries(AGREEMENT_SECTIONS.map(([key]) => [key, values.get(key)!])) as AgreementSections
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 64

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug)
}

/** Throws with a message the agent can act on; slugs are a tool contract, not user text. */
export function assertValidSlug(slug: unknown): asserts slug is string {
  if (!isValidSlug(slug)) {
    throw new Error(`"${String(slug)}" is not a valid intent name. Use lowercase words joined by single hyphens, for example "track-invoices".`)
  }
}

export function isIntentStatus(value: unknown): value is IntentStatus {
  return typeof value === 'string' && (INTENT_STATUSES as readonly string[]).includes(value)
}

export function intentPath(slug: string): string {
  assertValidSlug(slug)
  return path.join(INTENTS_RELATIVE_DIR, `${slug}.md`)
}

export interface IntentFile {
  readonly slug: string
  readonly status: IntentStatus
  /** Published agreement/sketch revision. Zero means there is no agreement yet. */
  readonly revision: number
  /** Exact revision approved for building; lower than revision means awaiting the user's yes. */
  readonly approvedRevision: number
  /** Revision whose sketch closed this agreement, retained after kept/undone statuses. */
  readonly frozenRevision?: number
  /** Short user-facing name used in progress UI; persisted as `title:`. */
  readonly title?: string
  /** Timestamped interview and revision journal entries. */
  readonly body: string
  /** The three lived situations that acceptance must exercise. */
  readonly realCases: readonly string[]
  /** The text under "## What we agreed", or undefined while it is still being understood. */
  readonly agreement: string | undefined
}

export function isAgreementFrozen(intent: Pick<IntentFile, 'status' | 'frozenRevision'>): boolean {
  return intent.status === 'frozen' || intent.frozenRevision !== undefined
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
  const lines = raw.split('\n')
  let metadataEnd = 0
  let status: IntentStatus = 'proposed'
  let title: string | undefined
  let revision: number | undefined
  let approvedRevision: number | undefined
  let frozenRevision: number | undefined
  for (; metadataEnd < lines.length; metadataEnd += 1) {
    const line = lines[metadataEnd] ?? ''
    if (!line.trim()) {
      metadataEnd += 1
      break
    }
    const match = /^(status|title|revision|approved-revision|frozen-revision):\s*(.*?)\s*$/.exec(line)
    if (!match) break
    if (match[1] === 'status' && isIntentStatus(match[2])) status = match[2]
    if (match[1] === 'title') title = match[2]?.trim() || undefined
    if (match[1] === 'revision' && /^\d+$/.test(match[2] ?? '')) revision = Number(match[2])
    if (match[1] === 'approved-revision' && /^\d+$/.test(match[2] ?? '')) approvedRevision = Number(match[2])
    if (match[1] === 'frozen-revision' && /^\d+$/.test(match[2] ?? '')) frozenRevision = Number(match[2])
  }

  const afterMetadata = lines.slice(metadataEnd).join('\n')
  const agreementIndex = afterMetadata.indexOf(AGREEMENT_HEADING)
  const beforeAgreement = agreementIndex < 0 ? afterMetadata : afterMetadata.slice(0, agreementIndex)
  const realCasesIndex = beforeAgreement.indexOf(REAL_CASES_HEADING)
  const body = (realCasesIndex < 0 ? beforeAgreement : beforeAgreement.slice(0, realCasesIndex)).trim()
  const realCasesRaw = realCasesIndex < 0 ? '' : beforeAgreement.slice(realCasesIndex + REAL_CASES_HEADING.length).trim()
  const realCases = realCasesRaw
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+\.|[-*])\s+/, '').trim())
    .filter(Boolean)
  const agreement = agreementIndex < 0
    ? undefined
    : afterMetadata.slice(agreementIndex + AGREEMENT_HEADING.length).trim() || undefined
  return {
    slug,
    status,
    revision: revision ?? (agreement ? 1 : 0),
    approvedRevision: approvedRevision ?? (agreement ? revision ?? 1 : 0),
    ...(frozenRevision !== undefined || status === 'frozen'
      ? { frozenRevision: frozenRevision ?? revision ?? (agreement ? 1 : 0) }
      : {}),
    title,
    body,
    realCases,
    agreement,
  }
}

export function serializeIntent(intent: Omit<IntentFile, 'slug'>): string {
  const parts = [
    `status: ${intent.status}`,
    ...(intent.title ? [`title: ${intent.title}`] : []),
    `revision: ${intent.revision}`,
    `approved-revision: ${intent.approvedRevision}`,
    ...(intent.frozenRevision !== undefined ? [`frozen-revision: ${intent.frozenRevision}`] : []),
    '',
    intent.body.trim(),
  ]
  if (intent.realCases.length) {
    parts.push('', REAL_CASES_HEADING, '', ...intent.realCases.map((realCase, index) => `${index + 1}. ${realCase.trim()}`))
  }
  if (intent.agreement) parts.push('', AGREEMENT_HEADING, '', intent.agreement.trim())
  return `${parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

function singular(value: string): string {
  if (/ies$/i.test(value)) return `${value.slice(0, -3)}y`
  if (/s$/i.test(value) && !/ss$/i.test(value)) return value.slice(0, -1)
  return value
}

/** A stable fallback when the model does not provide the short title itself. */
export function intentTitleFromUserWords(text: string, slug: string): string {
  const cleaned = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:please\s+)?(?:i\s+(?:need|want|would like)\s+(?:to\s+)?|can you\s+|could you\s+)/i, '')
  const tracked = /^track\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:with|by|so|that|for)\b|$)/i.exec(cleaned)?.[1]
  if (tracked) {
    const subject = tracked.split(/\s+/).map(singular).join(' ')
    return /\blist$/i.test(subject) ? subject : `${subject} list`
  }
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 1 && /s$/i.test(words[0]!)) return `${singular(words[0]!)} list`
  const fallback = words.slice(0, 6).join(' ') || slug.replace(/-/g, ' ')
  return `${fallback.charAt(0).toLowerCase()}${fallback.slice(1)}`
}

export async function readIntent(workspace: Workspace, slug: string): Promise<IntentFile | undefined> {
  try {
    return parseIntent(slug, await workspace.readFile(intentPath(slug)))
  } catch {
    return undefined
  }
}

async function writeIntent(workspace: Workspace, slug: string, intent: Omit<IntentFile, 'slug'>): Promise<void> {
  const file = intentPath(slug)
  await workspace.mkdir(path.dirname(file), { recursive: true })
  await workspace.writeFile(file, serializeIntent(intent))
}

/** Creates the intent (status `proposed`) or appends to the one that exists. */
export async function openIntent(
  workspace: Workspace,
  slug: string,
  text: string,
  now: Clock = systemClock,
  title?: string,
): Promise<{ intent: IntentFile; created: boolean }> {
  const existing = await readIntent(workspace, slug)
  if (existing && isAgreementFrozen(existing)) {
    throw new Error(`Intent "${slug}" is frozen at v${existing.revision}. Open a new intent such as "${slug}-v2" for this later request.`)
  }
  const entry = `- ${stamp(now())} — ${text.trim()}`
  const requestedTitle = title?.replace(/\s+/g, ' ').trim().slice(0, 80)
  const humanTitle = requestedTitle || intentTitleFromUserWords(text, slug)
  const next: Omit<IntentFile, 'slug'> = existing
    ? {
        status: existing.status,
        revision: existing.revision,
        approvedRevision: existing.approvedRevision,
        ...(existing.frozenRevision !== undefined ? { frozenRevision: existing.frozenRevision } : {}),
        title: existing.title ?? humanTitle,
        body: [existing.body, entry].filter(Boolean).join('\n'),
        realCases: existing.realCases,
        agreement: existing.agreement,
      }
    : {
        status: 'proposed',
        revision: 0,
        approvedRevision: 0,
        title: humanTitle,
        body: entry,
        realCases: [],
        agreement: undefined,
      }
  await writeIntent(workspace, slug, next)
  return { intent: { slug, ...next }, created: !existing }
}

async function appendIntentEvent(
  workspace: Workspace,
  slug: string,
  existing: IntentFile,
  entry: string,
  revision = existing.revision,
  approvedRevision = existing.approvedRevision,
): Promise<IntentFile> {
  const next = {
    status: existing.status,
    revision,
    approvedRevision,
    ...(existing.frozenRevision !== undefined ? { frozenRevision: existing.frozenRevision } : {}),
    title: existing.title,
    body: [existing.body, entry].filter(Boolean).join('\n'),
    realCases: existing.realCases,
    agreement: existing.agreement,
  }
  await writeIntent(workspace, slug, next)
  return { slug, ...next }
}

/** Host-authored lifecycle history may still be appended after the agreement freezes. */
export async function recordIntentEvent(
  workspace: Workspace,
  slug: string,
  text: string,
  now: Clock = systemClock,
): Promise<IntentFile> {
  const existing = await readIntent(workspace, slug)
  if (!existing) throw new Error(`There is no intent called "${slug}" yet. Open it first.`)
  return appendIntentEvent(workspace, slug, existing, `- ${stamp(now())} — ${text.trim()}`)
}

/** Appends one timestamped entry. Classified post-agreement changes publish a new revision. */
export async function noteIntent(
  workspace: Workspace,
  slug: string,
  text: string,
  now: Clock = systemClock,
  changeClass?: IntentChangeClass,
): Promise<IntentFile> {
  const existing = await readIntent(workspace, slug)
  if (!existing) throw new Error(`There is no intent called "${slug}" yet. Open it first.`)
  if (isAgreementFrozen(existing)) {
    throw new Error(`Intent "${slug}" is frozen at v${existing.revision}. Open a new intent such as "${slug}-v2" instead.`)
  }
  if (changeClass && !existing.agreement) throw new Error('Change classes apply only after an agreement.')
  const revision = existing.revision + (changeClass ? 1 : 0)
  const hasPendingApproval = existing.approvedRevision < existing.revision
  const approvedRevision = hasPendingApproval || changeClass === 'scope-by-me' ? existing.approvedRevision : revision
  const classification = changeClass
    ? ` [${changeClass}; v${revision}${changeClass === 'scope-by-me' ? '; awaiting your yes' : '; no revalidation'}]`
    : ''
  return appendIntentEvent(
    workspace,
    slug,
    existing,
    `- ${stamp(now())} —${classification} ${text.trim()}`,
    revision,
    approvedRevision,
  )
}

/** Writes the complete agreement contract and publishes revision v1. */
export async function agreeIntent(
  workspace: Workspace,
  slug: string,
  agreement: AgreementSections | string,
  realCases: readonly string[],
  now: Clock = systemClock,
): Promise<IntentFile> {
  const existing = (await readIntent(workspace, slug)) ?? (await openIntent(workspace, slug, 'Opened.', now)).intent
  if (isAgreementFrozen(existing)) throw new Error(`Intent "${slug}" is already frozen at v${existing.revision}.`)
  const cases = realCases.map((realCase) => realCase.trim()).filter(Boolean)
  if (cases.length < 3) throw new Error('An agreement needs at least three real cases.')
  const rendered = typeof agreement === 'string' ? agreement.trim() : renderAgreement(agreement)
  const parsed = parseAgreement(rendered)
  if (!parsed) throw new Error('Agreement is missing one or more required sections.')
  // Validate table and case-linked numbered acceptance for authored Markdown too.
  renderAgreement(parsed)
  const revision = Math.max(1, existing.revision)
  const next = {
    status: 'agreed' as const,
    revision,
    approvedRevision: revision,
    ...(existing.frozenRevision !== undefined ? { frozenRevision: existing.frozenRevision } : {}),
    title: existing.title,
    body: existing.approvedRevision < revision
      ? [existing.body, `- ${stamp(now())} — Revision v${revision} approved by the user.`].filter(Boolean).join('\n')
      : existing.body,
    realCases: cases,
    agreement: rendered,
  }
  await writeIntent(workspace, slug, next)
  return { slug, ...next }
}

/** Close the sketch gate without allowing later requests to mutate this contract. */
export async function freezeIntent(workspace: Workspace, slug: string, now: Clock = systemClock): Promise<IntentFile> {
  const existing = await readIntent(workspace, slug)
  if (!existing?.agreement) throw new Error(`Intent "${slug}" needs an agreement before it can be frozen.`)
  if (existing.approvedRevision !== existing.revision) {
    throw new Error(`Revision v${existing.revision} is awaiting the user's yes.`)
  }
  const next = {
    status: 'frozen' as const,
    revision: existing.revision,
    approvedRevision: existing.approvedRevision,
    frozenRevision: existing.revision,
    title: existing.title,
    body: [existing.body, `- ${stamp(now())} — Revision v${existing.revision} validated on the sketch; agreement frozen.`].filter(Boolean).join('\n'),
    realCases: existing.realCases,
    agreement: existing.agreement,
  }
  await writeIntent(workspace, slug, next)
  return { slug, ...next }
}

export async function setIntentStatus(workspace: Workspace, slug: string, status: IntentStatus): Promise<IntentFile> {
  const existing = await readIntent(workspace, slug)
  if (!existing) throw new Error(`There is no intent called "${slug}" yet. Open it first.`)
  if (isAgreementFrozen(existing) && status !== 'frozen' && status !== 'kept' && status !== 'undone') {
    throw new Error(`Intent "${slug}" is frozen at v${existing.revision} and cannot return to ${status}.`)
  }
  const next = {
    status,
    revision: existing.revision,
    approvedRevision: existing.approvedRevision,
    ...(existing.frozenRevision !== undefined ? { frozenRevision: existing.frozenRevision } : {}),
    title: existing.title,
    body: existing.body,
    realCases: existing.realCases,
    agreement: existing.agreement,
  }
  await writeIntent(workspace, slug, next)
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
  workspace: Workspace,
  input: { slug: string; summary: string; productToday: string },
  now: Clock = systemClock,
): Promise<{ line: string }> {
  assertValidSlug(input.slug)
  const summary = input.summary.trim().replace(/\s+/g, ' ')
  if (!summary) throw new Error('A change needs a one-sentence summary.')
  const productToday = input.productToday.trim()
  if (!productToday) throw new Error('A change needs the new description of what the app is today.')

  await workspace.mkdir(path.dirname(CHANGES_RELATIVE_PATH), {
    recursive: true,
  })
  let existing = ''
  try {
    existing = await workspace.readFile(CHANGES_RELATIVE_PATH)
  } catch {
    existing = '# Changes\n'
  }
  const line = formatChangeLine({
    date: isoDate(now()),
    slug: input.slug,
    summary,
  })
  await workspace.writeFile(CHANGES_RELATIVE_PATH, `${existing.trimEnd()}\n${line}\n`)
  await workspace.writeFile(PRODUCT_RELATIVE_PATH, `${productToday}\n`)
  return { line }
}

export async function readLastChange(workspace: Workspace): Promise<ChangeLine | undefined> {
  let raw: string
  try {
    raw = await workspace.readFile(CHANGES_RELATIVE_PATH)
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
export async function readActiveIntent(workspace: Workspace): Promise<IntentFile | undefined> {
  let entries: Awaited<ReturnType<Workspace['readdir']>>
  try {
    entries = await workspace.readdir(INTENTS_RELATIVE_DIR)
  } catch {
    return undefined
  }
  let best: { intent: IntentFile; mtime: number } | undefined
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    const slug = entry.name.slice(0, -3)
    if (!isValidSlug(slug)) continue
    const intent = await readIntent(workspace, slug)
    if (!intent || CLOSED_STATUSES.includes(intent.status)) continue
    const mtime = await workspace.stat(path.join(INTENTS_RELATIVE_DIR, entry.name)).then(
      (value) => value.mtimeMs,
      () => 0,
    )
    if (!best || mtime > best.mtime) best = { intent, mtime }
  }
  return best?.intent
}

/**
 * The one generated line in the system prompt: where the conversation stands,
 * so the agent picks the thread back up instead of asking the user to repeat
 * themselves. Recomputed only when a memory file changes — never per turn.
 */
export async function whereWeAreLine(workspace: Workspace): Promise<string | undefined> {
  const [active, lastChange] = await Promise.all([readActiveIntent(workspace), readLastChange(workspace)])
  const parts: string[] = []
  if (active) parts.push(`active intent ${active.slug} (${active.status})`)
  if (lastChange) parts.push(`Last kept: ${lastChange.slug} (${lastChange.date})`)
  if (!parts.length) return undefined
  return `Where we are: ${parts.join('. ')}.`
}
