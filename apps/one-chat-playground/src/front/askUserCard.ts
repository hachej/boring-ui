import type { PendingQuestionView } from '../server/askUser'
import type { AskUserAnswerValue } from '../../../../plugins/ask-user/src/shared/types'

/**
 * What the inline question card shows for one `ask_user` tool call.
 *
 * The card has exactly three lives: it is waiting for the user, it shows the
 * answer they gave, or the question is gone (cancelled, abandoned, from a
 * previous run) and the card should say nothing at all.
 */
export type QuestionCardState =
  | { readonly kind: 'pending'; readonly question: PendingQuestionView }
  | { readonly kind: 'answered'; readonly values: Record<string, AskUserAnswerValue> }
  | { readonly kind: 'gone' }

export interface ToolCallView {
  readonly toolCallId: string
  readonly state: string
  readonly output?: unknown
}

/** `User answered: {"kind":"delete"}. Continue…` — the tool's own result text. */
const ANSWERED_PREFIX = 'User answered:'

function outputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('')
  }
  if (output && typeof output === 'object' && 'content' in output) return outputText((output as { content: unknown }).content)
  return ''
}

/**
 * Recover the answer from the tool result, so a reloaded page still shows what
 * the user chose without keeping any client-side history.
 */
export function parseAnsweredValues(output: unknown): Record<string, AskUserAnswerValue> | undefined {
  const text = outputText(output)
  const start = text.indexOf(ANSWERED_PREFIX)
  if (start < 0) return undefined
  const open = text.indexOf('{', start)
  const close = text.lastIndexOf('}')
  if (open < 0 || close <= open) return undefined
  try {
    const parsed: unknown = JSON.parse(text.slice(open, close + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, AskUserAnswerValue>
  } catch {
    return undefined
  }
}

export function resolveQuestionCardState(input: {
  readonly call: ToolCallView
  readonly pending: readonly PendingQuestionView[]
  /** Answers submitted in this page's lifetime, by tool call id. */
  readonly justAnswered?: Readonly<Record<string, Record<string, AskUserAnswerValue>>>
}): QuestionCardState {
  const question = input.pending.find((candidate) => candidate.toolCallId === input.call.toolCallId)
  if (question) return { kind: 'pending', question }
  const optimistic = input.justAnswered?.[input.call.toolCallId]
  if (optimistic) return { kind: 'answered', values: optimistic }
  const parsed = parseAnsweredValues(input.call.output)
  if (parsed) return { kind: 'answered', values: parsed }
  return { kind: 'gone' }
}

/** "Delete them" rather than `{"choice":"delete"}`: the user never sees a payload. */
export function describeAnswer(
  values: Record<string, AskUserAnswerValue>,
  question?: PendingQuestionView,
): string {
  const labelFor = (fieldName: string, value: AskUserAnswerValue): string => {
    const field = question?.schema?.fields.find((candidate) => candidate.name === fieldName)
    const options = field && 'options' in field ? field.options : undefined
    const label = (raw: string) => options?.find((option) => option.value === raw)?.label ?? raw
    if (Array.isArray(value)) return value.map(label).join(', ')
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (value === null || value === undefined) return '—'
    return label(String(value))
  }
  return Object.entries(values)
    .map(([name, value]) => labelFor(name, value))
    .filter((part) => part.length > 0)
    .join(' · ')
}
