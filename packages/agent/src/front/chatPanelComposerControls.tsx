import type { ComponentPropsWithoutRef, RefObject } from 'react'
import { forwardRef, useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@hachej/boring-ui-kit'
import { cn } from './lib'
import { displayModelLabel, displayProviderLabel } from './chatModelLabels'
import {
  encodeModelKey,
  THINKING_LEVELS,
  type AvailableModel,
  type ModelSelection,
  type ThinkingLevel,
} from './chatPanelSettings'

// Shared composer-action surface — single opinion on size, radius, hover,
// focus, and disabled states. Every button inside the composer footer
// wraps this so we never drift.
export const composerActionClass = cn(
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border-0 bg-transparent",
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

const THINKING_LEVEL_STATUS_LABELS: Record<ThinkingLevel, string> = {
  off: 'off',
  low: 'low',
  medium: 'medium',
  high: 'high',
}

const THINKING_LEVEL_DETAILS: Record<ThinkingLevel, string> = {
  off: 'No extra reasoning',
  low: 'Light reasoning',
  medium: 'Balanced reasoning',
  high: 'Deep reasoning',
}

const selectorTriggerClass = cn(
  composerActionClass,
  'h-7 rounded-lg border border-border/60 bg-transparent px-2 text-[12px] font-medium text-muted-foreground',
  'hover:border-border/80 hover:bg-muted/55 hover:text-foreground',
)

const selectorContentClass = cn(
  'rounded-xl border border-[color:var(--border)]',
  'bg-[color:var(--popover)] p-1 text-[color:var(--popover-foreground)] shadow-xl',
)

const composerPickerMenuClass = cn(
  'mb-1 w-full overflow-hidden rounded-lg border border-border/60',
  'bg-[color:var(--popover)] text-[color:var(--popover-foreground)] shadow-lg',
)

function selectorItemClass(selected: boolean) {
  return cn(
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
    'data-[selected=true]:bg-[color:oklch(from_var(--accent)_l_c_h/0.15)] data-[selected=true]:text-foreground',
    selected && 'bg-foreground/[0.06] text-foreground',
  )
}

function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
}

function useDismissOnOutsidePointer(ref: RefObject<HTMLElement | null>, onClose?: () => void) {
  useEffect(() => {
    if (!onClose) return
    const handler = (event: PointerEvent | MouseEvent) => {
      const target = event.target
      if (target instanceof Node && ref.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-boring-agent-part="model-select"], [data-boring-agent-part="thinking-select"]')) return
      onClose()
    }
    window.addEventListener('pointerdown', handler, { capture: true })
    window.addEventListener('mousedown', handler, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', handler, { capture: true })
      window.removeEventListener('mousedown', handler, { capture: true })
    }
  }, [onClose, ref])
}

/**
 * Three-bar level glyph for the Thinking trigger. The icon IS the data:
 * the number of lit bars equals the active level (off=0 .. high=3). Lets
 * the user read state without opening the popover.
 */
function ThinkingLevelGlyph({ level }: { level: ThinkingLevel }) {
  const lit = level === 'off' ? 0 : level === 'low' ? 1 : level === 'medium' ? 2 : 3
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className="shrink-0"
    >
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 4}
          y={10 - i * 2}
          width="2"
          height={3 + i * 2}
          rx="0.5"
          fill="currentColor"
          opacity={i < lit ? 1 : 0.25}
        />
      ))}
    </svg>
  )
}

type SelectorTrigger = 'button' | 'slash'

function modelTriggerLabel(value: ModelSelection | null, options: AvailableModel[], emptyLabel = 'Default model'): string {
  const current = value
    ? options.find((m) => m.provider === value.provider && m.id === value.id)
    : undefined
  const rawTriggerLabel = current?.label ?? value?.id
  return value
    ? rawTriggerLabel && current?.label && current.label !== value.id && /[A-Z]/.test(current.label)
      ? current.label
      : displayModelLabel(rawTriggerLabel ?? value.id)
    : emptyLabel
}

function modelMenuOptions(_value: ModelSelection | null, options: AvailableModel[]): AvailableModel[] {
  return options.filter((m) => m.available)
}

function groupModelOptions(options: AvailableModel[]): Map<string, AvailableModel[]> {
  const groups = new Map<string, AvailableModel[]>()
  for (const model of options) {
    const list = groups.get(model.provider) ?? []
    list.push(model)
    groups.set(model.provider, list)
  }
  return groups
}

type ModelSelectTriggerProps = Omit<ComponentPropsWithoutRef<'button'>, 'value'> & {
  value: ModelSelection | null
  options: AvailableModel[]
  disabled?: boolean
  trigger?: SelectorTrigger
  open?: boolean
  emptyLabel?: string
}

export const ModelSelectTrigger = forwardRef<HTMLButtonElement, ModelSelectTriggerProps>(function ModelSelectTrigger({
  value,
  options,
  disabled,
  trigger = 'button',
  open = false,
  emptyLabel,
  onClick,
  className,
  ...props
}, ref) {
  const triggerLabel = modelTriggerLabel(value, options, emptyLabel)
  // Show the provider alongside the model so the same model name across
  // providers stays unambiguous. The default automatic selection has no
  // provider to show.
  const triggerDisplay = value ? `${triggerLabel} (${displayProviderLabel(value.provider)})` : triggerLabel
  return (
    <button
      ref={ref}
      type="button"
      data-boring-agent-part="model-select"
      data-boring-state={disabled ? "disabled" : undefined}
      disabled={disabled}
      aria-label={trigger === 'slash' ? `Open model picker. Current model: ${triggerDisplay}` : 'Model'}
      title={trigger === 'slash' ? `Open model picker. Current model: ${triggerDisplay}` : undefined}
      onClick={onClick}
      className={cn(
        trigger === 'slash'
          ? 'max-w-[min(52vw,260px)] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-[var(--radius-md)] px-1.5 py-0.5 transition-colors hover:bg-foreground/[0.045] hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/20 disabled:pointer-events-none disabled:opacity-50'
          : selectorTriggerClass,
        trigger === 'slash' ? 'w-auto' : 'w-auto max-w-[min(52vw,260px)] gap-1',
        open && (trigger === 'slash' ? 'bg-muted/45' : 'border-border/80 bg-muted/55 text-foreground'),
        className,
      )}
      {...props}
    >
      {trigger === 'slash' ? (
        <>
          <span className="text-muted-foreground">/model: </span>
          <span className="text-foreground">{triggerDisplay}</span>
        </>
      ) : (
        <>
          <span className="min-w-0 truncate">{triggerDisplay}</span>
          <ChevronDownIcon className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        </>
      )}
    </button>
  )
})

export function ModelPickerMenu({
  value,
  onChange,
  options,
  disabled,
  hideDefaultOption = false,
  onClose,
  className,
}: {
  value: ModelSelection | null
  onChange: (next: ModelSelection | null) => void
  options: AvailableModel[]
  disabled?: boolean
  hideDefaultOption?: boolean
  onClose?: () => void
  className?: string
}) {
  const currentKey = value ? encodeModelKey(value) : null
  const menuOptions = modelMenuOptions(value, options)
  const groups = groupModelOptions(menuOptions)
  const groupedOptions = [...groups.values()].flat()
  const keyboardOptions = hideDefaultOption ? groupedOptions : [null, ...groupedOptions]
  const selectedIndex = currentKey
    ? Math.max(0, keyboardOptions.findIndex((option) => option && encodeModelKey(option) === currentKey))
    : 0
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const activeIndexRef = useRef(selectedIndex)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useDismissOnOutsidePointer(menuRef, onClose)
  const setKeyboardActiveIndex = (next: number | ((current: number) => number)) => {
    const resolved = typeof next === 'function' ? next(activeIndexRef.current) : next
    activeIndexRef.current = resolved
    setActiveIndex(resolved)
  }
  useEffect(() => {
    setKeyboardActiveIndex(selectedIndex)
  }, [selectedIndex])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
        return
      }
      if (disabled || isTextInputTarget(event.target)) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setKeyboardActiveIndex((index) => Math.min(index + 1, keyboardOptions.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setKeyboardActiveIndex((index) => Math.max(index - 1, 0))
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        onChange(keyboardOptions[activeIndexRef.current] ?? null)
        onClose?.()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [activeIndex, disabled, keyboardOptions, onChange, onClose])
  const optionIndexOffset = hideDefaultOption ? 0 : 1
  const optionIndexes = new Map(groupedOptions.map((option, index) => [encodeModelKey(option), index + optionIndexOffset]))
  return (
    <div ref={menuRef} data-boring-agent="" data-boring-agent-part="model-picker-menu" className={cn(composerPickerMenuClass, className)}>
      <Command className="bg-transparent text-[color:var(--popover-foreground)]">
        {menuOptions.length > 8 && (
          <div className="border-b border-border/60 px-2">
            <CommandInput
              placeholder="Search models…"
              autoFocus
              className="h-8 w-full border-0 bg-transparent text-[13px] outline-none focus:ring-0"
            />
          </div>
        )}
        <CommandList className="max-h-[300px] p-0.5">
          <CommandEmpty className="py-4 text-center text-[13px] text-muted-foreground">
            No models found
          </CommandEmpty>
          {!hideDefaultOption ? (
            <CommandGroup>
              <CommandItem
                value="Default model automatic auto"
                onSelect={() => {
                  if (disabled) return
                  onChange(null)
                  onClose?.()
                }}
                className={selectorItemClass(!value || activeIndex === 0)}
              >
                <CheckIcon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    !value ? "text-[color:var(--accent)] opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">Default model</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">auto</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
          {[...groups.entries()].map(([provider, list]) => (
            <CommandGroup
              key={provider}
              heading={displayProviderLabel(provider)}
              className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground/60"
            >
              {list.map((m) => {
                const key = encodeModelKey(m)
                const label = m.label || displayModelLabel(m.id)
                const itemIndex = optionIndexes.get(key) ?? 0
                return (
                  <CommandItem
                    key={key}
                    value={`${label} ${m.id} ${displayProviderLabel(m.provider)}`}
                    onSelect={() => {
                      if (disabled) return
                      onChange(m)
                      onClose?.()
                    }}
                    className={cn(selectorItemClass(key === currentKey || activeIndex === itemIndex))}
                  >
                    <CheckIcon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        key === currentKey ? "text-[color:var(--accent)] opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate whitespace-nowrap">{label}</span>
                    <span className="ml-auto max-w-[45%] shrink-0 truncate whitespace-nowrap text-right text-[10px] text-muted-foreground/60">{m.id}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </div>
  )
}

/**
 * Model picker whose options are pi-coding-agent's actual available
 * models (fetched from /api/v1/agent/models). Groups by provider and
 * shows a concise human-friendly label with the raw pi id as the
 * option's stored value, encoded as "{provider}:{id}" to keep
 * ids stable across providers.
 */
export function ModelSelect({
  value,
  onChange,
  options,
  disabled,
  trigger = 'button',
  openSignal,
  className,
  emptyLabel,
  ariaInvalid,
  ariaDescribedBy,
}: {
  value: ModelSelection | null
  onChange: (next: ModelSelection | null) => void
  options: AvailableModel[]
  disabled?: boolean
  trigger?: SelectorTrigger
  openSignal?: unknown
  className?: string
  emptyLabel?: string
  ariaInvalid?: boolean
  ariaDescribedBy?: string
}) {
  const [open, setOpen] = useState(false)
  const previousOpenSignalRef = useRef(openSignal)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  useEffect(() => {
    if (disabled || openSignal === undefined) {
      previousOpenSignalRef.current = openSignal
      return
    }
    if (previousOpenSignalRef.current !== openSignal) setOpen(true)
    previousOpenSignalRef.current = openSignal
  }, [disabled, openSignal])
  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <ModelSelectTrigger
          value={value}
          options={options}
          disabled={disabled}
          trigger={trigger}
          open={open}
          className={className}
          emptyLabel={emptyLabel}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
        />
      </PopoverTrigger>
      <PopoverContent
        align={trigger === 'slash' ? 'center' : 'start'}
        side="top"
        sideOffset={trigger === 'slash' ? 54 : 6}
        collisionPadding={12}
        data-boring-agent=""
        className={cn('w-[min(92vw,340px)]', selectorContentClass)}
      >
        <ModelPickerMenu
          value={value}
          onChange={onChange}
          options={options}
          disabled={disabled}
          onClose={() => setOpen(false)}
          className="mb-0 rounded-none border-0 bg-transparent shadow-none"
        />
      </PopoverContent>
    </Popover>
  )
}

export function ThinkingSelect({
  value,
  onChange,
  disabled,
  trigger = 'button',
  openSignal,
  className,
}: {
  value: ThinkingLevel
  onChange: (next: ThinkingLevel) => void
  disabled?: boolean
  trigger?: SelectorTrigger
  openSignal?: unknown
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const previousOpenSignalRef = useRef(openSignal)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  useEffect(() => {
    if (disabled || openSignal === undefined) {
      previousOpenSignalRef.current = openSignal
      return
    }
    if (previousOpenSignalRef.current !== openSignal) setOpen(true)
    previousOpenSignalRef.current = openSignal
  }, [disabled, openSignal])

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <ThinkingSelectTrigger
          value={value}
          disabled={disabled}
          trigger={trigger}
          open={open}
          className={className}
        />
      </PopoverTrigger>
      <PopoverContent
        align={trigger === 'slash' ? 'center' : 'end'}
        side="top"
        sideOffset={trigger === 'slash' ? 54 : 6}
        collisionPadding={12}
        data-boring-agent=""
        className={cn('w-[min(92vw,240px)]', selectorContentClass)}
      >
        <ThinkingPickerMenu
          value={value}
          onChange={onChange}
          disabled={disabled}
          onClose={() => setOpen(false)}
          className="mb-0 rounded-none border-0 bg-transparent shadow-none"
        />
      </PopoverContent>
    </Popover>
  )
}

type ThinkingSelectTriggerProps = Omit<ComponentPropsWithoutRef<'button'>, 'value'> & {
  value: ThinkingLevel
  disabled?: boolean
  trigger?: SelectorTrigger
  open?: boolean
}

export const ThinkingSelectTrigger = forwardRef<HTMLButtonElement, ThinkingSelectTriggerProps>(function ThinkingSelectTrigger({
  value,
  disabled,
  trigger = 'button',
  open = false,
  onClick,
  className,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-boring-agent-part="thinking-select"
      data-boring-state={disabled ? "disabled" : undefined}
      disabled={disabled}
      className={cn(
        trigger === 'slash'
          ? 'cursor-pointer rounded-[var(--radius-md)] px-1.5 py-0.5 transition-colors hover:bg-foreground/[0.045] hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/20 disabled:pointer-events-none disabled:opacity-50'
          : selectorTriggerClass,
        trigger === 'button' && 'gap-1.5',
        trigger === 'button' && value !== 'off' && !open && 'border-[color:oklch(from_var(--accent)_l_c_h/0.35)] bg-[color:oklch(from_var(--accent)_l_c_h/0.08)] text-foreground',
        open && (trigger === 'slash' ? 'bg-muted/45' : 'border-border/80 bg-muted/55 text-foreground'),
        className,
      )}
      aria-label={`Thinking level: ${THINKING_LEVEL_LABELS[value]}`}
      title={`Thinking: ${THINKING_LEVEL_LABELS[value]}`}
      data-testid="thinking-select"
      onClick={onClick}
      {...props}
    >
      {trigger === 'button' ? <ThinkingLevelGlyph level={value} /> : null}
      {trigger === 'slash' ? (
        <>
          <span className="text-muted-foreground">/thinking: </span>
          <span className="text-foreground">{THINKING_LEVEL_STATUS_LABELS[value]}</span>
        </>
      ) : (
        <>
          <span>{THINKING_LEVEL_LABELS[value]}</span>
          <ChevronDownIcon className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        </>
      )}
    </button>
  )
})

export function ThinkingPickerMenu({
  value,
  onChange,
  disabled,
  onClose,
  className,
}: {
  value: ThinkingLevel
  onChange: (next: ThinkingLevel) => void
  disabled?: boolean
  onClose?: () => void
  className?: string
}) {
  const selectedIndex = Math.max(0, THINKING_LEVELS.indexOf(value))
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const activeIndexRef = useRef(selectedIndex)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useDismissOnOutsidePointer(menuRef, onClose)
  const setKeyboardActiveIndex = (next: number | ((current: number) => number)) => {
    const resolved = typeof next === 'function' ? next(activeIndexRef.current) : next
    activeIndexRef.current = resolved
    setActiveIndex(resolved)
  }
  useEffect(() => {
    setKeyboardActiveIndex(selectedIndex)
  }, [selectedIndex])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
        return
      }
      if (disabled || isTextInputTarget(event.target)) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setKeyboardActiveIndex((index) => Math.min(index + 1, THINKING_LEVELS.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setKeyboardActiveIndex((index) => Math.max(index - 1, 0))
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        onChange(THINKING_LEVELS[activeIndexRef.current])
        onClose?.()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [activeIndex, disabled, onChange, onClose])
  return (
    <div ref={menuRef} data-boring-agent="" data-boring-agent-part="thinking-picker-menu" className={cn(composerPickerMenuClass, className)}>
      <Command className="bg-transparent text-[color:var(--popover-foreground)]">
        <CommandList className="max-h-[300px] p-0.5">
          {THINKING_LEVELS.map((level, index) => (
            <CommandItem
              key={level}
              value={`Thinking ${THINKING_LEVEL_LABELS[level]} ${THINKING_LEVEL_DETAILS[level]}`}
              onSelect={() => {
                if (disabled) return
                onChange(level)
                onClose?.()
              }}
              className={selectorItemClass(level === value || index === activeIndex)}
            >
              <CheckIcon
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  level === value ? 'text-[color:var(--accent)] opacity-100' : 'opacity-0',
                )}
              />
              <ThinkingLevelGlyph level={level} />
              <span className="font-medium">{THINKING_LEVEL_LABELS[level]}</span>
              <span className="ml-auto text-[11px] text-muted-foreground/65">
                {THINKING_LEVEL_DETAILS[level]}
              </span>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </div>
  )
}
