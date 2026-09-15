import { useState } from 'react'

import type { PendingQuestionView } from '../server/askUser'
import type { AskUserAnswerValue, AskUserField } from '../../../../plugins/ask-user/src/shared/types'
import { describeAnswer, type QuestionCardState } from './askUserCard'

const CARD_CLASS =
  'my-2 rounded-xl border border-border bg-card px-4 py-3 text-[14px] text-foreground shadow-sm'
const BUTTON_CLASS =
  'min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-[14px] leading-tight hover:bg-accent disabled:opacity-50'
const PRIMARY_CLASS =
  'min-h-[44px] rounded-lg bg-primary px-4 py-2 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50'

function defaultValues(fields: readonly AskUserField[]): Record<string, AskUserAnswerValue> {
  const values: Record<string, AskUserAnswerValue> = {}
  for (const field of fields) {
    if (field.type === 'multiselect') values[field.name] = field.defaultValue ?? []
    else if (field.type === 'checkbox') values[field.name] = field.defaultValue ?? false
    else if (field.type === 'number') values[field.name] = field.defaultValue ?? null
    else values[field.name] = field.defaultValue ?? ''
  }
  return values
}

type ChoiceField = Extract<AskUserField, { type: 'select' | 'radio' }>

/** One choice field on its own is the common case: buttons, and the click answers. */
function singleChoiceField(question: PendingQuestionView): ChoiceField | undefined {
  const fields = question.schema?.fields ?? []
  const only = fields.length === 1 ? fields[0] : undefined
  return only && (only.type === 'select' || only.type === 'radio') ? only : undefined
}

export function QuestionCard({
  state,
  submitting,
  onAnswer,
}: {
  readonly state: QuestionCardState
  readonly submitting: boolean
  readonly onAnswer: (question: PendingQuestionView, values: Record<string, AskUserAnswerValue>) => void
}) {
  if (state.kind === 'gone') return null
  if (state.kind === 'answered') {
    return (
      <p className={`${CARD_CLASS} text-muted-foreground`} data-testid="one-chat-question-answered">
        You said: {describeAnswer(state.values)}
      </p>
    )
  }
  return <PendingCard question={state.question} submitting={submitting} onAnswer={onAnswer} />
}

function PendingCard({
  question,
  submitting,
  onAnswer,
}: {
  readonly question: PendingQuestionView
  readonly submitting: boolean
  readonly onAnswer: (question: PendingQuestionView, values: Record<string, AskUserAnswerValue>) => void
}) {
  const fields = question.schema?.fields ?? []
  const [values, setValues] = useState<Record<string, AskUserAnswerValue>>(() => defaultValues(fields))
  const set = (name: string, value: AskUserAnswerValue) => setValues((current) => ({ ...current, [name]: value }))
  const choice = singleChoiceField(question)

  return (
    <div className={CARD_CLASS} data-testid="one-chat-question-card">
      {question.title ? <p className="font-medium">{question.title}</p> : null}
      {question.context ? <p className="mt-1 text-muted-foreground">{question.context}</p> : null}

      {choice ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {choice.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={BUTTON_CLASS}
              disabled={submitting}
              onClick={() => onAnswer(question, { [choice.name]: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            onAnswer(question, values)
          }}
        >
          {fields.map((field) => (
            <FieldControl key={field.name} field={field} value={values[field.name] ?? null} onChange={(value) => set(field.name, value)} />
          ))}
          <div>
            <button type="submit" className={PRIMARY_CLASS} disabled={submitting}>
              {question.schema?.submitLabel ?? 'Send'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  readonly field: AskUserField
  readonly value: AskUserAnswerValue
  readonly onChange: (value: AskUserAnswerValue) => void
}) {
  const label = (
    <span className="text-[13px] text-muted-foreground">{field.label}</span>
  )
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] text-muted-foreground">{field.label}</legend>
        {field.options.map((option) => (
          <label key={option.value} className="flex min-h-[44px] items-center gap-2">
            <input
              type="checkbox"
              className="size-4"
              checked={selected.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((candidate) => candidate !== option.value),
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  if (field.type === 'checkbox') {
    return (
      <label className="flex min-h-[44px] items-center gap-2">
        <input type="checkbox" className="size-4" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
      </label>
    )
  }
  if (field.type === 'select' || field.type === 'radio') {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] text-muted-foreground">{field.label}</legend>
        <div className="flex flex-wrap gap-2">
          {field.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${BUTTON_CLASS} ${value === option.value ? 'border-primary' : ''}`}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    )
  }
  if (field.type === 'textarea') {
    return (
      <label className="flex flex-col gap-1">
        {label}
        <textarea
          className="min-h-[88px] rounded-lg border border-border bg-background px-3 py-2"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    )
  }
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        className="min-h-[44px] rounded-lg border border-border bg-background px-3 py-2"
        value={value === null || value === undefined ? '' : String(value)}
        placeholder={'placeholder' in field ? field.placeholder : undefined}
        onChange={(event) => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)}
      />
    </label>
  )
}
