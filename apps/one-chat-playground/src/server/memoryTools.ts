import type { AgentTool, Workspace } from '@hachej/boring-agent/shared'

import {
  INTENT_STATUSES,
  agreeIntent,
  assertValidSlug,
  isIntentStatus,
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
      },
      required: ['slug', 'text'],
      additionalProperties: false,
    },
    async execute(params) {
      return guarded(async () => {
        assertValidSlug(params.slug)
        const body = str(params.text)
        if (!body) throw new Error('An entry cannot be empty.')
        const intent = await noteIntent(workspace, params.slug, body, now)
        options.invalidatePrompt()
        return `Noted on ${intent.slug} (${intent.status}).`
      })
    },
  }

  const agree: AgentTool = {
    name: 'agree_intent',
    description:
      'Write down what you and the user agreed, once they have said yes to your summary. This is the brief you build from: who it is for, the one task, what it must do, and what "done" looks like. Sets the track to agreed.',
    parameters: {
      type: 'object',
      properties: {
        slug: SLUG_PARAM,
        agreement: {
          type: 'string',
          description: 'The complete agreement in plain words (Markdown): a short brief, then the handful of lines that say when it is right. Not a diff.',
        },
      },
      required: ['slug', 'agreement'],
      additionalProperties: false,
    },
    async execute(params, ctx) {
      return guarded(async () => {
        assertValidSlug(params.slug)
        const body = str(params.agreement)
        if (!body) throw new Error('An agreement cannot be empty.')
        const intent = await agreeIntent(workspace, params.slug, body, now)
        options.invalidatePrompt()
        options.onAgreement?.(intent.slug, ctx.sessionId)
        return `Agreed on ${intent.slug}. You can build it now.`
      })
    },
  }

  const status: AgentTool = {
    name: 'set_intent_status',
    description: `Move a track along: ${INTENT_STATUSES.join(', ')}. Use "sketched" when its static sketch is ready, "building" while the real app is being built, "built" when it finishes, and "undone" if the change was taken back.`,
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
        const intent = await setIntentStatus(workspace, params.slug, params.status)
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
