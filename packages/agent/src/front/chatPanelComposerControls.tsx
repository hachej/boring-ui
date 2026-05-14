import { useState } from 'react'
import { BotIcon, BrainIcon, EyeIcon, EyeOffIcon } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@hachej/boring-ui-kit'
import { cn } from './lib'
import { displayModelLabel, displayProviderLabel } from './chatModelLabels'
import {
  encodeModelKey,
  isThinkingLevel,
  THINKING_LEVELS,
  type AvailableModel,
  type ModelSelection,
  type ThinkingLevel,
} from './chatPanelSettings'

// Shared composer-action surface — single opinion on size, radius, hover,
// focus, and disabled states. Every button inside the composer footer
// wraps this so we never drift.
export const composerActionClass = cn(
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border-0 bg-transparent",
  "text-muted-foreground shadow-none transition",
  "hover:bg-muted/60 hover:text-foreground",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "disabled:pointer-events-none disabled:opacity-50",
)

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Med',
  high: 'High',
}

/**
 * Model picker whose options are pi-coding-agent's actual available
 * models (fetched from /api/v1/agent/models). Groups by provider and
 * shows a concise human-friendly label with the raw pi id as the
 * SelectItem's stored value, encoded as "{provider}:{id}" to keep
 * ids stable across providers.
 */
export function ModelSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: ModelSelection | null
  onChange: (next: ModelSelection) => void
  options: AvailableModel[]
  disabled?: boolean
}) {
  const currentKey = value ? encodeModelKey(value) : null
  // Trigger label prefers a live entry, falls back to raw id for offline /
  // legacy short-alias sessions. With no selected/default model, show the
  // honest state: Pi will choose its configured/session fallback server-side.
  const current = value
    ? options.find((m) => m.provider === value.provider && m.id === value.id)
    : undefined
  const triggerLabel = value ? current?.label ?? displayModelLabel(value.id) : 'Pi default'
  const triggerProviderLabel = value ? displayProviderLabel(value.provider) : 'Auto'

  const availableOptions = options.filter((m) => m.available)
  const hasCurrentOption = currentKey
    ? availableOptions.some((m) => encodeModelKey(m) === currentKey)
    : true
  const menuOptions = hasCurrentOption || !value
    ? availableOptions
    : [
        {
          provider: value.provider,
          id: value.id,
          label: triggerLabel,
          available: true,
        },
        ...availableOptions,
      ]

  // Group by provider, preserving the server's already-sorted order.
  const groups = new Map<string, AvailableModel[]>()
  for (const m of menuOptions) {
    const list = groups.get(m.provider) ?? []
    list.push(m)
    groups.set(m.provider, list)
  }

  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-boring-agent-part="model-select"
          data-boring-state={disabled ? "disabled" : undefined}
          disabled={disabled}
          aria-label="Model"
          className={cn(
            composerActionClass,
            "w-auto max-w-[min(56vw,240px)] px-2.5 text-xs font-medium",
            open && "bg-muted/60 text-foreground",
          )}
        >
          <BotIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <span className="hidden shrink-0 rounded-full border border-border/70 bg-background/45 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
            {triggerProviderLabel}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        data-boring-agent=""
        className="w-[min(92vw,360px)] rounded-lg border-border/70 bg-popover p-0 shadow-2xl"
      >
        <Command>
          <CommandInput
            placeholder="Search models…"
            className="h-9 border-0 text-[13px] focus:ring-0"
          />
          <CommandList className="max-h-[280px]">
            <CommandEmpty className="py-4 text-center text-[13px] text-muted-foreground">
              No models found
            </CommandEmpty>
            {[...groups.entries()].map(([provider, list]) => (
              <CommandGroup
                key={provider}
                heading={displayProviderLabel(provider)}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-muted-foreground/75"
              >
                {list.map((m) => {
                  const key = encodeModelKey(m)
                  const label = m.label || displayModelLabel(m.id)
                  return (
                    <CommandItem
                      key={key}
                      value={`${label} ${m.id} ${displayProviderLabel(m.provider)}`}
                      onSelect={() => { onChange(m); setOpen(false) }}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-md px-2 py-2 text-[13px]",
                        key === currentKey && "bg-foreground/[0.06]",
                      )}
                    >
                      <span className="truncate font-medium">{label}</span>
                      <span className="truncate text-[11px] text-muted-foreground">{m.id}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function ThinkingSelect({
  value,
  onChange,
  disabled,
}: {
  value: ThinkingLevel
  onChange: (next: ThinkingLevel) => void
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isThinkingLevel(next)) onChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        data-boring-agent-part="thinking-select"
        data-boring-state={disabled ? "disabled" : undefined}
        className={cn(composerActionClass, "w-8 px-0")}
        aria-label="Thinking level"
        data-testid="thinking-select"
      >
        {THINKING_LEVELS.map((level) => (
          <span key={level} data-value={level} hidden />
        ))}
        <BrainIcon className="h-3.5 w-3.5" />
      </SelectTrigger>
      <SelectContent position="popper" side="top" align="end" data-boring-agent="" className="w-auto min-w-0 rounded-lg border-border/70 bg-popover p-2 shadow-2xl">
        <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          Think
        </div>
        <div className="flex items-center gap-1">
          {THINKING_LEVELS.map((level) => (
            <SelectItem
              key={level}
              value={level}
              className="min-w-10 justify-center rounded-md px-2 py-1.5 text-center text-xs font-medium"
            >
              {THINKING_LEVEL_LABELS[level]}
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  )
}

export function ThoughtVisibilityButton({
  visible,
  onToggle,
}: {
  visible: boolean
  onToggle: () => void
}) {
  const Icon = visible ? EyeIcon : EyeOffIcon
  return (
    <IconButton
      type="button"
      data-boring-agent-part="thought-toggle"
      data-boring-state={visible ? "selected" : undefined}
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      className={cn(composerActionClass, "w-8")}
      aria-pressed={visible}
      aria-label={visible ? "Hide thoughts" : "Show thoughts"}
      title={visible ? "Hide thoughts" : "Show thoughts"}
    >
      <Icon className="h-3.5 w-3.5" />
    </IconButton>
  )
}
