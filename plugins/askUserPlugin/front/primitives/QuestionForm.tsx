import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { Checkbox, ChoiceGroup, ChoiceGroupLegend, ChoiceItem, ChoiceItemBody, ChoiceItemDescription, ChoiceItemTitle, Field, FieldDescription, FieldError, FieldLabel, Input, Radio, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@hachej/boring-ui-kit"
import type { AskUserAnswerValue, AskUserField, AskUserFormSchema } from "../../shared/types"

export type QuestionFormValues = Record<string, AskUserAnswerValue>
export type QuestionValidationResult = { valid: boolean; errors: Record<string, string> }
export type QuestionFormStatus = "ready" | "answered" | "cancelled" | "abandoned"
export type QuestionFormState = {
  schema?: AskUserFormSchema
  status: QuestionFormStatus
  values: QuestionFormValues
  touched: Record<string, boolean>
  errors: Record<string, string>
  submitting: boolean
  disabled: boolean
  dirtyHints: Record<string, string>
}

export type QuestionFieldRendererProps = {
  field: AskUserField
  value: AskUserAnswerValue | undefined
  error?: string
  disabled: boolean
  describedBy: string
  onChange(value: AskUserAnswerValue): void
  onBlur(): void
}
export type QuestionFieldRenderer = (props: QuestionFieldRendererProps) => React.ReactNode
export type QuestionFieldRendererRegistry = Partial<Record<AskUserField["type"], QuestionFieldRenderer>> & {
  unsupported?: QuestionFieldRenderer
}

type ContextValue = QuestionFormState & {
  setValue(name: string, value: AskUserAnswerValue): void
  touch(name: string): void
  submit(): Promise<void>
  cancel(): void
  rendererRegistry: QuestionFieldRendererRegistry
  formRef: React.RefObject<HTMLFormElement | null>
}

const QuestionFormContext = createContext<ContextValue | null>(null)

const fieldClass = "space-y-1.5"
const choiceControlClass = "mt-0.5"

export function useQuestionForm(): ContextValue {
  const ctx = useContext(QuestionFormContext)
  if (!ctx) throw new Error("useQuestionForm must be used inside QuestionFormProvider")
  return ctx
}

export type QuestionFormProviderProps = {
  schema?: AskUserFormSchema
  status?: QuestionFormStatus
  disabled?: boolean
  submitting?: boolean
  initialValues?: QuestionFormValues
  rendererRegistry?: QuestionFieldRendererRegistry
  onSubmit?(values: QuestionFormValues): void | Promise<void>
  onCancel?(): void
  children: React.ReactNode
}

export function QuestionFormProvider({
  schema,
  status = "ready",
  disabled = false,
  submitting: controlledSubmitting,
  initialValues,
  rendererRegistry = {},
  onSubmit,
  onCancel,
  children,
}: QuestionFormProviderProps) {
  const [values, setValues] = useState<QuestionFormValues>(() => defaultsFor(schema, initialValues))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [dirtyHints, setDirtyHints] = useState<Record<string, string>>({})
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    setValues((current) => {
      const next = defaultsFor(schema, initialValues)
      for (const field of schema?.fields ?? []) {
        if (touched[field.name] && current[field.name] !== undefined) {
          next[field.name] = current[field.name]
        }
      }
      return next
    })
  }, [schema, initialValues, touched])

  const errors = useMemo(() => {
    if (!schema) return {}
    const allErrors = validateQuestionValues(schema, values).errors
    if (submitted) return allErrors
    return Object.fromEntries(Object.entries(allErrors).filter(([name]) => touched[name]))
  }, [schema, values, submitted, touched])
  const setValue = useCallback((name: string, value: AskUserAnswerValue) => {
    setTouched((current) => ({ ...current, [name]: true }))
    setValues((current) => ({ ...current, [name]: value }))
  }, [])
  const touch = useCallback((name: string) => setTouched((current) => ({ ...current, [name]: true })), [])
  const submit = useCallback(async () => {
    if (!schema || status !== "ready" || disabled) return
    const result = validateQuestionValues(schema, values)
    if (!result.valid) {
      setSubmitted(true)
      const first = Object.keys(result.errors)[0]
      formRef.current?.querySelector<HTMLElement>(`[name="${cssEscape(first)}"]`)?.focus()
      return
    }
    setSubmitting(true)
    try { await onSubmit?.(values) } finally { setSubmitting(false) }
  }, [schema, status, disabled, values, onSubmit])
  const cancel = useCallback(() => {
    if (Object.keys(touched).length > 0 && !window.confirm("Discard your answer?")) return
    onCancel?.()
  }, [onCancel, touched])

  const value: ContextValue = { schema, status, values, touched, errors, submitting: controlledSubmitting ?? submitting, disabled, dirtyHints, setValue, touch, submit, cancel, rendererRegistry, formRef }
  return <QuestionFormContext.Provider value={value}>{children}</QuestionFormContext.Provider>
}

export function QuestionForm({ children, "aria-label": ariaLabel = "Question form" }: React.PropsWithChildren<{ "aria-label"?: string }>) {
  const { submit, cancel, status, formRef } = useQuestionForm()
  return <form ref={formRef} data-question-form aria-label={ariaLabel} onSubmit={(event) => { event.preventDefault(); void submit() }} onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit() }
    if (event.key === "Escape") { event.preventDefault(); cancel() }
  }}>
    <div aria-live="polite" className="sr-only">{status === "ready" ? "Question ready" : `Question ${status}`}</div>
    {children}
  </form>
}

export function QuestionFields() {
  const { schema } = useQuestionForm()
  if (!schema) return null
  return <>{schema.fields.map((field) => <QuestionField key={field.name} field={field} />)}</>
}

export function QuestionField({ field }: { field: AskUserField }) {
  const { values, errors, disabled, submitting, setValue, touch, rendererRegistry, dirtyHints } = useQuestionForm()
  const error = errors[field.name]
  const helpId = `${field.name}-help`
  const errorId = `${field.name}-error`
  const hintId = `${field.name}-hint`
  const describedBy = [field.helpText ? helpId : undefined, error ? errorId : undefined, dirtyHints[field.name] ? hintId : undefined].filter(Boolean).join(" ")
  const renderer = rendererRegistry[field.type] ?? defaultRenderers[field.type] ?? rendererRegistry.unsupported ?? UnsupportedFieldRenderer
  return <Field data-field={field.name} className={fieldClass}>
    {renderer({ field, value: values[field.name], error, disabled: disabled || submitting, describedBy, onChange: (value) => setValue(field.name, value), onBlur: () => touch(field.name) })}
    {field.helpText ? <FieldDescription id={helpId}>{field.helpText}</FieldDescription> : null}
    {dirtyHints[field.name] ? <FieldDescription id={hintId}>{dirtyHints[field.name]}</FieldDescription> : null}
    {error ? <FieldError id={errorId} role="alert">{error}</FieldError> : null}
  </Field>
}

export function QuestionSubmitButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { schema, status, errors, submitting, disabled } = useQuestionForm()
  return <button {...props} type="submit" disabled={disabled || submitting || status !== "ready"}>{props.children ?? "Submit"}</button>
}

export function QuestionCancelButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { cancel, disabled, submitting } = useQuestionForm()
  return <button {...props} type="button" disabled={disabled || submitting} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) cancel() }}>{props.children ?? "Cancel"}</button>
}

const defaultRenderers: QuestionFieldRendererRegistry = {
  text: ({ field, value, disabled, describedBy, error, onChange, onBlur }) => field.type === "text" && (
    <>
      <FieldLabel htmlFor={field.name}>{label(field)}</FieldLabel>
      <Input id={field.name} name={field.name} value={typeof value === "string" ? value : ""} placeholder={field.placeholder} minLength={field.minLength} maxLength={field.maxLength} pattern={field.pattern} disabled={disabled} aria-describedby={describedBy || undefined} aria-invalid={!!error} aria-errormessage={error ? `${field.name}-error` : undefined} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </>
  ),
  textarea: ({ field, value, disabled, describedBy, error, onChange, onBlur }) => field.type === "textarea" && (
    <>
      <FieldLabel htmlFor={field.name}>{label(field)}</FieldLabel>
      <Textarea id={field.name} name={field.name} value={typeof value === "string" ? value : ""} placeholder={field.placeholder} minLength={field.minLength} maxLength={field.maxLength} disabled={disabled} aria-describedby={describedBy || undefined} aria-invalid={!!error} aria-errormessage={error ? `${field.name}-error` : undefined} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </>
  ),
  select: ({ field, value, disabled, describedBy, error, onChange, onBlur }) => (field.type === "select" || field.type === "radio") && (
    <ChoiceGroup aria-describedby={field.type === "radio" ? describedBy || undefined : undefined} aria-invalid={field.type === "radio" ? !!error : undefined} aria-errormessage={field.type === "radio" && error ? `${field.name}-error` : undefined}>
      <ChoiceGroupLegend>{label(field)}</ChoiceGroupLegend>
      {field.options.map((option) => field.type === "select" ? null : (
        <ChoiceItem key={option.value}>
          <Radio className={choiceControlClass} name={field.name} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} onBlur={onBlur} />
          <ChoiceItemBody>
            <ChoiceItemTitle>{option.label}</ChoiceItemTitle>
            {option.description ? <ChoiceItemDescription>{option.description}</ChoiceItemDescription> : null}
          </ChoiceItemBody>
        </ChoiceItem>
      ))}
      {field.type === "select" ? <Select name={field.name} value={typeof value === "string" ? value : ""} disabled={disabled} onValueChange={(next) => onChange(next)}><SelectTrigger className="w-full" aria-describedby={describedBy || undefined} aria-invalid={!!error} aria-errormessage={error ? `${field.name}-error` : undefined} onBlur={onBlur}><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{field.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select> : null}
    </ChoiceGroup>
  ),
  radio: (props) => defaultRenderers.select?.(props),
  multiselect: ({ field, value, disabled, describedBy, error, onChange, onBlur }) => field.type === "multiselect" && (
    <ChoiceGroup aria-describedby={describedBy || undefined} aria-invalid={!!error} aria-errormessage={error ? `${field.name}-error` : undefined}>
      <ChoiceGroupLegend>{label(field)}</ChoiceGroupLegend>
      {field.options.map((option) => {
        const list = Array.isArray(value) ? value : []
        return (
          <ChoiceItem key={option.value}>
            <Checkbox className={choiceControlClass} name={field.name} checked={list.includes(option.value)} disabled={disabled} onCheckedChange={(checked) => onChange(checked ? [...list, option.value] : list.filter((item) => item !== option.value))} onBlur={onBlur} />
            <ChoiceItemBody>
              <ChoiceItemTitle>{option.label}</ChoiceItemTitle>
              {option.description ? <ChoiceItemDescription>{option.description}</ChoiceItemDescription> : null}
            </ChoiceItemBody>
          </ChoiceItem>
        )
      })}
    </ChoiceGroup>
  ),
  checkbox: ({ field, value, disabled, describedBy, error, onChange, onBlur }) => field.type === "checkbox" && (
    <ChoiceItem>
      <Checkbox className={choiceControlClass} name={field.name} checked={value === true} disabled={disabled} aria-describedby={describedBy || undefined} aria-invalid={!!error} aria-errormessage={error ? `${field.name}-error` : undefined} onCheckedChange={(checked) => onChange(checked === true)} onBlur={onBlur} />
      <ChoiceItemTitle>{field.label}</ChoiceItemTitle>
    </ChoiceItem>
  ),
  number: ({ field, value, disabled, describedBy, error, onChange, onBlur }) => field.type === "number" && (
    <>
      <FieldLabel htmlFor={field.name}>{label(field)}</FieldLabel>
      <Input id={field.name} type="number" name={field.name} value={typeof value === "number" ? String(value) : ""} min={field.min} max={field.max} step={field.integer ? 1 : field.step} disabled={disabled} aria-describedby={describedBy || undefined} aria-invalid={!!error} aria-errormessage={error ? `${field.name}-error` : undefined} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} onBlur={onBlur} />
    </>
  ),
  unsupported: UnsupportedFieldRenderer,
}

function UnsupportedFieldRenderer({ field }: QuestionFieldRendererProps) { return <FieldDescription role="note">Unsupported question field: {field.type}</FieldDescription> }
function label(field: AskUserField): React.ReactNode { return <>{field.label}{"required" in field && field.required ? <span className="text-destructive" aria-hidden="true"> *</span> : null}</> }
function defaultsFor(schema?: AskUserFormSchema, initial?: QuestionFormValues): QuestionFormValues {
  const values: QuestionFormValues = { ...(initial ?? {}) }
  for (const field of schema?.fields ?? []) if (values[field.name] === undefined && "defaultValue" in field) values[field.name] = field.defaultValue as AskUserAnswerValue
  return values
}

export function validateQuestionValues(schema: AskUserFormSchema, values: QuestionFormValues): QuestionValidationResult {
  const errors: Record<string, string> = {}
  for (const field of schema.fields) {
    const value = values[field.name]
    const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)
    if ("required" in field && field.required && empty) { errors[field.name] = "This field is required."; continue }
    if (empty) continue
    if (field.type === "text" || field.type === "textarea") {
      if (typeof value !== "string") errors[field.name] = "Enter text."
      else if (field.minLength !== undefined && value.length < field.minLength) errors[field.name] = `Must be at least ${field.minLength} characters.`
      else if (field.maxLength !== undefined && value.length > field.maxLength) errors[field.name] = `Must be at most ${field.maxLength} characters.`
      else if (field.type === "text" && field.pattern && !new RegExp(field.pattern).test(value)) errors[field.name] = "Invalid format."
    } else if ((field.type === "select" || field.type === "radio") && (typeof value !== "string" || !field.options.some((o) => o.value === value))) errors[field.name] = "Choose a valid option."
    else if (field.type === "multiselect") {
      if (!Array.isArray(value)) errors[field.name] = "Choose valid options."
      else if (field.minSelections !== undefined && value.length < field.minSelections) errors[field.name] = `Choose at least ${field.minSelections}.`
      else if (field.maxSelections !== undefined && value.length > field.maxSelections) errors[field.name] = `Choose at most ${field.maxSelections}.`
      else if (value.some((item) => !field.options.some((o) => o.value === item))) errors[field.name] = "Choose valid options."
    } else if (field.type === "checkbox" && typeof value !== "boolean") errors[field.name] = "Must be checked or unchecked."
    else if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) errors[field.name] = "Enter a number."
      else if (field.integer && !Number.isInteger(value)) errors[field.name] = "Enter a whole number."
      else if (field.min !== undefined && value < field.min) errors[field.name] = `Must be at least ${field.min}.`
      else if (field.max !== undefined && value > field.max) errors[field.name] = `Must be at most ${field.max}.`
    }
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

function cssEscape(value: string): string { return globalThis.CSS?.escape?.(value) ?? value.replace(/[^A-Za-z0-9_-]/g, "\\$&") }
