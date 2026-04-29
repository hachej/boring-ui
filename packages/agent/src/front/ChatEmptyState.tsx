"use client"

import { ArrowUpRight, BookOpen, Code2, FileSearch, Wand2 } from "lucide-react"
import type { ComponentType, ReactNode } from "react"
import { cn } from "./lib"

/**
 * Suggested action shown in a chat empty state. Customizable per child app
 * via `ChatPanel.suggestions` / `ChatCenteredShell.chatSuggestions`.
 *
 * Click behavior: if `onSelect` is provided it wins; otherwise `prompt`
 * (or `label` as a fallback) is sent as the next user message.
 */
export interface ChatSuggestion {
  /** Title shown on the suggestion card. */
  label: string
  /** Smaller hint/subtitle line below the label. */
  hint?: string
  /**
   * Lucide-compatible icon component (any component that accepts className
   * + strokeWidth). Pass `BookOpen`, `Code2`, etc. directly from lucide-react.
   */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>
  /**
   * Text inserted as the user's next message when the card is clicked. If
   * omitted, falls back to `label`.
   */
  prompt?: string
  /**
   * Override the click handler entirely. When set, `prompt` is ignored —
   * the host decides what happens (e.g., open a wizard, prefill the
   * composer, route somewhere).
   */
  onSelect?: () => void
}

/**
 * Sensible defaults that mirror the suggestions the chat-centered shell
 * showed before the agent was wired into the workspace. Child apps that
 * pass nothing inherit these; passing an empty array hides the grid.
 */
export const defaultChatSuggestions: ChatSuggestion[] = [
  {
    label: "Summarize the README",
    hint: "Read the docs and distill.",
    icon: BookOpen,
    prompt: "Summarize the README in this repo.",
  },
  {
    label: "Explain this codebase",
    hint: "Walk me through the architecture.",
    icon: FileSearch,
    prompt: "Give me a tour of this codebase — what are the key modules and how do they fit together?",
  },
  {
    label: "Write a Python script",
    hint: "Scaffold a new file end-to-end.",
    icon: Code2,
    prompt: "Help me scaffold a new Python script.",
  },
  {
    label: "Refactor a function",
    hint: "Clean up, no behavior change.",
    icon: Wand2,
    prompt: "Help me refactor a function — clean it up without changing behavior.",
  },
]

export interface ChatEmptyStateProps {
  /** Small uppercase eyebrow above the headline. */
  eyebrow?: string
  /** Large headline. Editorial tone. */
  title?: string
  /** Single-paragraph description below the headline. */
  description?: string
  /**
   * Suggestion cards. Pass `[]` to hide the grid entirely (headline still
   * renders). Defaults to `defaultChatSuggestions`.
   */
  suggestions?: ChatSuggestion[]
  /**
   * Fired when a suggestion card is clicked. The default ChatPanel wiring
   * resolves this to `sendMessage` with the suggestion's prompt.
   */
  onSelect?: (suggestion: ChatSuggestion) => void
  /** Optional content rendered below the suggestion grid. */
  footer?: ReactNode
  className?: string
}

export function ChatEmptyState({
  eyebrow = "New session",
  title = "What are we building?",
  description = "Ask a question, open a file from the workbench, or start from a template.",
  suggestions = defaultChatSuggestions,
  onSelect,
  footer,
  className,
}: ChatEmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[640px] flex-col px-2 pt-12 pb-4",
        className,
      )}
    >
      {eyebrow && (
        <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <span className="inline-block h-px w-4 bg-[color:var(--accent)]" aria-hidden="true" />
          {eyebrow}
        </div>
      )}
      {title && (
        <h3 className="mt-3 text-[34px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground">
          {title}
        </h3>
      )}
      {description && (
        <p className="mt-3 max-w-[440px] text-[14px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="mt-8 grid w-full grid-cols-1 gap-px overflow-hidden rounded-xl bg-border/70 ring-1 ring-border/70 sm:grid-cols-2">
          {suggestions.map((suggestion) => {
            const Icon = suggestion.icon
            return (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => {
                  if (suggestion.onSelect) {
                    suggestion.onSelect()
                    return
                  }
                  onSelect?.(suggestion)
                }}
                className={cn(
                  "group flex items-start gap-3 bg-background px-4 py-3.5 text-left",
                  "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  "hover:bg-[color:var(--accent-soft)]",
                  "focus-visible:outline-none focus-visible:bg-[color:var(--accent-soft)]",
                )}
              >
                {Icon && (
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--accent)]"
                    strokeWidth={1.75}
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {suggestion.label}
                  </span>
                  {suggestion.hint && (
                    <span className="truncate text-[12px] text-muted-foreground">
                      {suggestion.hint}
                    </span>
                  )}
                </span>
                <ArrowUpRight
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    "group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-hover:text-[color:var(--accent)]",
                  )}
                  strokeWidth={2}
                />
              </button>
            )
          })}
        </div>
      )}
      {footer}
    </div>
  )
}
