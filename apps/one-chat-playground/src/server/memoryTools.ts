import type { AgentTool, Workspace } from '@hachej/boring-agent/shared'

import {
  AGREEMENT_SECTIONS,
  INTENT_CHANGE_CLASSES,
  INTENT_STATUSES,
  agreeIntent,
  assertValidSlug,
  freezeIntent,
  isIntentStatus,
  type AgreementSections,
  type IntentChangeClass,
  noteIntent,
  openIntent,
  readIntent,
  recordChange,
  setIntentStatus,
  systemClock,
  type Clock,
} from './memoryFiles.js'

function text(body: string, isError = false): Awaited<ReturnType<AgentTool['execute']>> {
  return {
    content: [{ type: 'text', text: body }],
    ...(isError ? { isError: true } : {}),
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isChangeClass(value: unknown): value is IntentChangeClass {
  return typeof value === 'string' && (INTENT_CHANGE_CLASSES as readonly string[]).includes(value)
}

function agreementSections(value: unknown): AgreementSections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The agreement must include every fixed section.')
  const input = value as Record<string, unknown>
  return Object.fromEntries(AGREEMENT_SECTIONS.map(([key]) => [key, str(input[key])])) as unknown as AgreementSections
}

/** Tool errors are the agent's problem, not the user's: never surface a stack. */
async function guarded(run: () => Promise<string>): Promise<Awaited<ReturnType<AgentTool['execute']>>> {
  try {
    return text(await run())
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true)
  }
}

const SLUG_PARAM = {
  type: 'string',
  description: 'Short name for this piece of work, lowercase words joined by hyphens, e.g. "track-invoices". Reuse the same name for the whole track.',
} as const

/**
 * Memory, as tools rather than as free-form writes: a named call is far more
 * reliable than hoping the model edits the right Markdown in the right shape,
 * and it keeps the three files' structure something the loader can parse.
 */
export function createMemoryTools(options: {
  readonly workspace: Workspace
  readonly now?: Clock
  readonly invalidatePrompt: () => void
  readonly onAgreement?: (slug: string, sessionId: string | undefined) => void
}): AgentTool[] {
  const workspace = options.workspace
  const now = options.now ?? systemClock

  const open: AgentTool = {
    name: 'open_intent',
    description:
      'Start (or reopen) a track of work on the app and record what the user asked, in their words. Call this the moment a message is about changing the app itself. If the track already exists, this appends to it and tells you its status and whether it already has an agreement.',
    parameters: {
      type: 'object',
      properties: {
        slug: SLUG_PARAM,
        text: {
          type: 'string',
          description: 'What the user asked, in their own words.',
        },
        title: {
          type: 'string',
          description: 'A short human name in the user\'s words, e.g. "supplier list". Omit only when the request itself is already a short title.',
        },
      },
      required: ['slug', 'text'],
      additionalProperties: false,
    },
    async execute(params) {
      return guarded(async () => {
        assertValidSlug(params.slug)
        const body = str(params.text)
        if (!body) throw new Error('Say what the user asked.')
        const { intent, created } = await openIntent(workspace, params.slug, body, now, str(params.title))
        options.invalidatePrompt()
        const agreement = intent.agreement ? 'It already has an agreement — you can build.' : 'It has no agreement yet — understand first, then agree.'
        return `${created ? 'Opened' : 'Reopened'} ${intent.slug} (${intent.status}). ${agreement}`
      })
    },
  }

  const note: AgentTool = {
    name: 'note_intent',
    description:
      'Add one entry to an open track: an answer the user gave, a clarification, a "change something" request, a decision. One call per thing worth remembering.',
    parameters: {
      type: 'object',
      properties: {
        slug: SLUG_PARAM,
        text: {
          type: 'string',
          description: 'The entry, one or two plain sentences.',
        },
        changeClass: {
          type: 'string',
          enum: [...INTENT_CHANGE_CLASSES],
          description: 'For a post-agreement request, classify it as asked-by-user, wording, or scope-by-me. Omit for interview answers and host-authored build notes.',
        },
      },
      required: ['slug', 'text'],
      additionalProperties: false,
    },
    async execute(params) {
      return guarded(async () => {
        assertValidSlug(params.slug)
        const body = str(params.text)
        if (!body) throw new Error('An entry cannot be empty.')
        if (params.changeClass !== undefined && !isChangeClass(params.changeClass)) {
          throw new Error(`Change class must be one of: ${INTENT_CHANGE_CLASSES.join(', ')}.`)
        }
        const intent = await noteIntent(workspace, params.slug, body, now, params.changeClass as IntentChangeClass | undefined)
        options.invalidatePrompt()
        return `Noted on ${intent.slug} (${intent.status}).`
      })
    },
  }

  const agree: AgentTool = {
    name: 'agree_intent',
    description:
      'Write the complete agreement only after the user says yes. Supply three lived cases and every fixed section in the user\'s words. Acceptance items 1–3 must say Case 1, Case 2, and Case 3; outOfScope must be a Markdown table. Sets revision v1 to agreed.',
    parameters: {
      type: 'object',
      properties: {
        slug: SLUG_PARAM,
        realCases: {
          type: 'array',
          minItems: 3,
          items: { type: 'string' },
          description: 'At least three situations the user actually lived, kept in the user\'s words.',
        },
        agreement: {
          type: 'object',
          properties: Object.fromEntries(AGREEMENT_SECTIONS.map(([key, heading]) => [key, {
            type: 'string',
            description: heading === 'Out of scope, with why'
              ? 'A Markdown table with columns Out of scope and Why.'
              : heading === 'Acceptance'
                ? 'A numbered Markdown list whose first three items explicitly reference Case 1, Case 2, and Case 3.'
                : heading === 'Open questions'
                  ? 'Open questions; when one closes, cross it out and include the date.'
                  : heading,
          }])),
          required: AGREEMENT_SECTIONS.map(([key]) => key),
          additionalProperties: false,
        },
      },
      required: ['slug', 'realCases', 'agreement'],
      additionalProperties: false,
    },
    async execute(params, ctx) {
      return guarded(async () => {
        assertValidSlug(params.slug)
        const realCases = Array.isArray(params.realCases) ? params.realCases.map(str) : []
        const intent = await agreeIntent(workspace, params.slug, agreementSections(params.agreement), realCases, now)
        options.invalidatePrompt()
        options.onAgreement?.(intent.slug, ctx.sessionId)
        return `Agreed on ${intent.slug}. You can build it now.`
      })
    },
  }

  const status: AgentTool = {
    name: 'set_intent_status',
    description: `Move a track along: ${INTENT_STATUSES.join(', ')}. Use "frozen" only when the user keeps the sketch; later requests then need a new v2 intent. Use "undone" if a kept change was taken back.`,
    parameters: {
      type: 'object',
      properties: {
        slug: SLUG_PARAM,
        status: {
          type: 'string',
          enum: [...INTENT_STATUSES],
          description: 'The new status.',
        },
      },
      required: ['slug', 'status'],
      additionalProperties: false,
    },
    async execute(params) {
      return guarded(async () => {
        assertValidSlug(params.slug)
        if (!isIntentStatus(params.status)) throw new Error(`Status must be one of: ${INTENT_STATUSES.join(', ')}.`)
        const intent = params.status === 'frozen'
          ? await freezeIntent(workspace, params.slug, now)
          : await setIntentStatus(workspace, params.slug, params.status)
        options.invalidatePrompt()
        return `${intent.slug} is now ${intent.status}.`
      })
    },
  }

  const record: AgentTool = {
    name: 'record_change',
    description:
      "Call this right after a change is in front of the user and kept (or after you undid one). It adds one line to the app's change log and rewrites the description of what the app is today, and closes the track as kept.",
    parameters: {
      type: 'object',
      properties: {
        slug: SLUG_PARAM,
        summary: {
          type: 'string',
          description: "One sentence, from the user's point of view, of what changed.",
        },
        productToday: {
          type: 'string',
          description:
            'The complete new description of what the app is today, in plain words (Markdown): who it is for, what they can do in it, what it holds. Replaces the old description.',
        },
      },
      required: ['slug', 'summary', 'productToday'],
      additionalProperties: false,
    },
    async execute(params) {
      return guarded(async () => {
        assertValidSlug(params.slug)
        const { line } = await recordChange(
          workspace,
          {
            slug: params.slug,
            summary: str(params.summary),
            productToday: str(params.productToday),
          },
          now,
        )
        const existing = await readIntent(workspace, params.slug)
        if (existing && existing.status !== 'undone') await setIntentStatus(workspace, params.slug, 'kept')
        options.invalidatePrompt()
        return `Recorded: ${line}`
      })
    },
  }

  return [open, note, agree, status, record]
}
