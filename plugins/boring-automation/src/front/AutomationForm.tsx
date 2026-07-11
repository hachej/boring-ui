"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Button, Checkbox, Field, FieldDescription, FieldError, FieldLabel, Input, Textarea } from "@hachej/boring-ui-kit"
import type { Automation, AutomationCreate, AutomationPatch } from "../shared"

export interface AutomationDraft {
  title: string
  enabled: boolean
  cron: string
  timezone: string
  model: string
  prompt: string
}

export type AutomationValidationErrors = Partial<Record<keyof AutomationDraft, string>>

const DEFAULT_DRAFT: AutomationDraft = {
  title: "",
  enabled: true,
  cron: "0 9 * * *",
  timezone: "UTC",
  model: "",
  prompt: "",
}

export function draftFromAutomation(automation: Automation, prompt: string): AutomationDraft {
  return {
    title: automation.title,
    enabled: automation.enabled,
    cron: automation.cron,
    timezone: automation.timezone,
    model: automation.model,
    prompt,
  }
}

export function emptyAutomationDraft(): AutomationDraft {
  return { ...DEFAULT_DRAFT }
}

export function validateAutomationDraft(draft: AutomationDraft): AutomationValidationErrors {
  const errors: AutomationValidationErrors = {}
  if (!draft.title.trim()) errors.title = "Title is required."
  if (!draft.cron.trim()) errors.cron = "Cron schedule is required."
  if (!draft.timezone.trim()) errors.timezone = "Timezone is required."
  const model = draft.model.trim()
  if (!model) errors.model = "Model is required."
  else {
    const separator = model.indexOf(":")
    if (separator <= 0 || !model.slice(0, separator).trim() || !model.slice(separator + 1).trim()) {
      errors.model = "Use provider:model-id syntax."
    }
  }
  return errors
}

export function toAutomationCreate(draft: AutomationDraft): AutomationCreate {
  return {
    title: draft.title.trim(),
    enabled: draft.enabled,
    cron: draft.cron.trim(),
    timezone: draft.timezone.trim(),
    model: draft.model.trim(),
    prompt: draft.prompt,
  }
}

export function toAutomationPatch(draft: AutomationDraft): AutomationPatch {
  return {
    title: draft.title.trim(),
    enabled: draft.enabled,
    cron: draft.cron.trim(),
    timezone: draft.timezone.trim(),
    model: draft.model.trim(),
  }
}

export function AutomationForm({
  automation,
  prompt,
  mode,
  saving,
  onCancel,
  onSubmit,
}: {
  automation?: Automation
  prompt: string
  mode: "create" | "edit"
  saving: boolean
  onCancel: () => void
  onSubmit: (draft: AutomationDraft) => void
}) {
  const [draft, setDraft] = useState<AutomationDraft>(() => automation ? draftFromAutomation(automation, prompt) : emptyAutomationDraft())
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setDraft(automation ? draftFromAutomation(automation, prompt) : emptyAutomationDraft())
    setSubmitted(false)
  }, [automation, prompt])

  const errors = useMemo(() => validateAutomationDraft(draft), [draft])
  const hasErrors = Object.keys(errors).length > 0
  const cronDescriptionIds = submitted && errors.cron ? "automation-cron-description automation-cron-error" : "automation-cron-description"
  const modelDescriptionIds = submitted && errors.model ? "automation-model-description automation-model-error" : "automation-model-description"

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (hasErrors) return
    onSubmit(draft)
  }

  return (
    <form className="space-y-4" onSubmit={submit} noValidate aria-label={`${mode === "create" ? "Create" : "Edit"} automation form`}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="automation-title">Title</FieldLabel>
          <Input
            id="automation-title"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            aria-invalid={submitted && !!errors.title}
            aria-describedby={submitted && errors.title ? "automation-title-error" : undefined}
          />
          {submitted && errors.title ? <FieldError id="automation-title-error">{errors.title}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="automation-model">Model</FieldLabel>
          <Input
            id="automation-model"
            value={draft.model}
            placeholder="provider:model-id"
            onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
            aria-invalid={submitted && !!errors.model}
            aria-describedby={modelDescriptionIds}
          />
          <FieldDescription id="automation-model-description">Explicit provider and model ID, for example anthropic:claude-sonnet-4-5.</FieldDescription>
          {submitted && errors.model ? <FieldError id="automation-model-error">{errors.model}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="automation-cron">Cron</FieldLabel>
          <Input
            id="automation-cron"
            value={draft.cron}
            onChange={(event) => setDraft((current) => ({ ...current, cron: event.target.value }))}
            aria-invalid={submitted && !!errors.cron}
            aria-describedby={cronDescriptionIds}
          />
          <FieldDescription id="automation-cron-description">Example: 0 9 * * *</FieldDescription>
          {submitted && errors.cron ? <FieldError id="automation-cron-error">{errors.cron}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="automation-timezone">Timezone</FieldLabel>
          <Input
            id="automation-timezone"
            value={draft.timezone}
            onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
            aria-invalid={submitted && !!errors.timezone}
            aria-describedby={submitted && errors.timezone ? "automation-timezone-error" : undefined}
          />
          {submitted && errors.timezone ? <FieldError id="automation-timezone-error">{errors.timezone}</FieldError> : null}
        </Field>
      </div>

      <label className="flex w-fit items-center gap-2 rounded-md text-sm text-foreground focus-within:ring-2 focus-within:ring-ring/40">
        <Checkbox
          checked={draft.enabled}
          onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked === true }))}
          aria-label="Automation enabled"
        />
        Enabled
      </label>

      <Field>
        <FieldLabel htmlFor="automation-prompt">Markdown prompt</FieldLabel>
        <Textarea
          id="automation-prompt"
          value={draft.prompt}
          onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
          rows={12}
          spellCheck={false}
          className="min-h-64 resize-y font-mono text-[13px] leading-5"
          aria-describedby="automation-prompt-description"
        />
        <FieldDescription id="automation-prompt-description">Saved through the canonical prompt route; local CLI mode writes the Markdown prompt file.</FieldDescription>
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create automation" : "Save automation"}</Button>
      </div>
    </form>
  )
}
