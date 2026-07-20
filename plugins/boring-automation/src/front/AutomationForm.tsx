"use client"

import { ModelSelect, ThinkingSelect, type AvailableModel, type ModelSelection, type ThinkingLevel } from "@hachej/boring-agent/front"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Button, Field, FieldDescription, FieldError, FieldLabel, Input, Textarea } from "@hachej/boring-ui-kit"
import { validateAutomationSchedule, type Automation, type AutomationCreate, type AutomationPatch } from "../shared"
import { useAutomationRuntime } from "./AutomationRuntimeContext"

export interface AutomationDraft {
  title: string
  enabled: boolean
  cron: string
  timezone: string
  model: string
  thinkingLevel: ThinkingLevel
  prompt: string
}

export type AutomationValidationErrors = Partial<Record<keyof AutomationDraft, string>>

const DEFAULT_DRAFT: AutomationDraft = {
  title: "",
  enabled: true,
  cron: "0 9 * * *",
  timezone: "UTC",
  model: "",
  thinkingLevel: "medium",
  prompt: "",
}

export function draftFromAutomation(automation: Automation, prompt: string): AutomationDraft {
  return {
    title: automation.title,
    enabled: automation.enabled,
    cron: automation.cron,
    timezone: automation.timezone,
    model: automation.model,
    thinkingLevel: automation.thinkingLevel ?? "medium",
    prompt,
  }
}

export function emptyAutomationDraft(): AutomationDraft {
  return { ...DEFAULT_DRAFT }
}

export function validateAutomationDraft(draft: AutomationDraft): AutomationValidationErrors {
  const errors: AutomationValidationErrors = {}
  if (!draft.title.trim()) errors.title = "Title is required."
  const schedule = validateAutomationSchedule(draft.cron, draft.timezone)
  if (schedule.errors.cron) errors.cron = schedule.errors.cron
  if (schedule.errors.timezone) errors.timezone = schedule.errors.timezone
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
    thinkingLevel: draft.thinkingLevel,
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
    thinkingLevel: draft.thinkingLevel,
  }
}

function parseModel(model: string): ModelSelection | null {
  const separator = model.indexOf(":")
  return separator > 0 && separator < model.length - 1
    ? { provider: model.slice(0, separator), id: model.slice(separator + 1) }
    : null
}

function useAutomationModels(): AvailableModel[] {
  const { apiBaseUrl, authHeaders } = useAutomationRuntime()
  const [models, setModels] = useState<AvailableModel[]>([])
  useEffect(() => {
    let cancelled = false
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/v1/agent/models`, { headers: authHeaders })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { models?: AvailableModel[] } | null) => { if (!cancelled) setModels(payload?.models ?? []) })
      .catch(() => { if (!cancelled) setModels([]) })
    return () => { cancelled = true }
  }, [apiBaseUrl, authHeaders])
  return models
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
  const availableModels = useAutomationModels()

  useEffect(() => {
    setDraft(automation ? draftFromAutomation(automation, prompt) : emptyAutomationDraft())
    setSubmitted(false)
  }, [automation, prompt])

  const errors = useMemo(() => validateAutomationDraft(draft), [draft])
  const hasErrors = Object.keys(errors).length > 0
  const cronDescriptionIds = submitted && errors.cron ? "automation-cron-description automation-cron-error" : "automation-cron-description"
  const timezoneDescriptionIds = submitted && errors.timezone ? "automation-timezone-description automation-timezone-error" : "automation-timezone-description"
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
            autoFocus
            className="min-h-11"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            aria-invalid={submitted && !!errors.title}
            aria-describedby={submitted && errors.title ? "automation-title-error" : undefined}
          />
          {submitted && errors.title ? <FieldError id="automation-title-error">{errors.title}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel>Model</FieldLabel>
          <ModelSelect
            value={parseModel(draft.model)}
            options={availableModels}
            className="min-h-11 w-full max-w-none justify-between"
            onChange={(model) => setDraft((current) => ({ ...current, model: model ? `${model.provider}:${model.id}` : "" }))}
          />
          <FieldDescription id="automation-model-description">Uses the same available-model picker as the composer.</FieldDescription>
          {submitted && errors.model ? <FieldError id="automation-model-error">{errors.model}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel>Effort</FieldLabel>
          <ThinkingSelect
            value={draft.thinkingLevel}
            className="min-h-11 w-full justify-between border-border/60 bg-transparent text-muted-foreground"
            onChange={(thinkingLevel) => setDraft((current) => ({ ...current, thinkingLevel }))}
          />
          <FieldDescription>Uses the same reasoning-effort menu as the composer.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="automation-cron">Cron</FieldLabel>
          <Input
            id="automation-cron"
            className="min-h-11"
            value={draft.cron}
            onChange={(event) => setDraft((current) => ({ ...current, cron: event.target.value }))}
            aria-invalid={submitted && !!errors.cron}
            aria-describedby={cronDescriptionIds}
          />
          <FieldDescription id="automation-cron-description">Five-field cron, for example 0 9 * * *</FieldDescription>
          {submitted && errors.cron ? <FieldError id="automation-cron-error">{errors.cron}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="automation-timezone">Timezone</FieldLabel>
          <Input
            id="automation-timezone"
            className="min-h-11"
            value={draft.timezone}
            onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
            aria-invalid={submitted && !!errors.timezone}
            aria-describedby={timezoneDescriptionIds}
          />
          <FieldDescription id="automation-timezone-description">IANA timezone, for example UTC or America/New_York.</FieldDescription>
          {submitted && errors.timezone ? <FieldError id="automation-timezone-error">{errors.timezone}</FieldError> : null}
        </Field>
      </div>

      <div className="flex min-h-11 items-center gap-2 text-sm text-foreground">
        <Button
          type="button"
          role="switch"
          variant={draft.enabled ? "default" : "outline"}
          size="sm"
          aria-checked={draft.enabled}
          aria-label="Automation enabled"
          style={{ minHeight: 44 }}
          onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
        >
          {draft.enabled ? "Enabled" : "Disabled"}
        </Button>
        <span className="text-muted-foreground">Runs on schedule</span>
      </div>

      <Field>
        <FieldLabel htmlFor="automation-prompt">Markdown prompt</FieldLabel>
        <Textarea
          id="automation-prompt"
          value={draft.prompt}
          onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
          rows={6}
          spellCheck={false}
          className="min-h-28 resize-y font-mono text-[13px] leading-5 sm:min-h-36"
          aria-describedby="automation-prompt-description"
        />
        <FieldDescription id="automation-prompt-description">Saved to the workspace prompt file.</FieldDescription>
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        <Button className="min-h-11" type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button className="min-h-11" type="submit" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create automation" : "Save automation"}</Button>
      </div>
    </form>
  )
}
