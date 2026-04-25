"use client"

import { forwardRef, useContext, useImperativeHandle, useRef } from "react"
import {
  ArrowUpRight,
  BookOpen,
  Code2,
  FileSearch,
  SendHorizontal,
  Wand2,
} from "lucide-react"
import { cn } from "../../lib/utils"

export interface ChatStagePlaceholderProps {
  sessionTitle?: string
  sessionId?: string
  appTitle?: string
  className?: string
}

export interface ChatStageHandle {
  focusComposer: () => void
}

const PROMPT_SUGGESTIONS = [
  { label: "Summarize the README", hint: "Read the docs and distill.", Icon: BookOpen },
  { label: "Explain this codebase", hint: "Walk me through the architecture.", Icon: FileSearch },
  { label: "Write a Python script", hint: "Scaffold a new file end-to-end.", Icon: Code2 },
  { label: "Refactor a function", hint: "Clean up, no behavior change.", Icon: Wand2 },
]

export const ChatStagePlaceholder = forwardRef<ChatStageHandle, ChatStagePlaceholderProps>(
  function ChatStagePlaceholder({ className }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(ref, () => ({
      focusComposer() {
        textareaRef.current?.focus()
      },
    }))

    return (
      <div className={cn("relative flex h-full min-h-0 flex-col bg-background", className)}>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full w-full max-w-[640px] flex-col justify-end px-6 pb-8 pt-16">
            <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <span className="inline-block h-px w-4 bg-[color:var(--accent)]" aria-hidden="true" />
              New session
            </div>
            <h3 className="mt-3 text-[34px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground">
              What are we building?
            </h3>
            <p className="mt-3 max-w-[440px] text-[14px] leading-relaxed text-muted-foreground">
              Ask a question, open a file from the workbench, or start from a template.
            </p>
            <div className="mt-8 grid w-full grid-cols-1 gap-px overflow-hidden rounded-xl bg-border/70 ring-1 ring-border/70 sm:grid-cols-2">
              {PROMPT_SUGGESTIONS.map(({ label, hint, Icon }) => (
                <button
                  key={label}
                  type="button"
                  className={cn(
                    "group flex items-start gap-3 bg-background px-4 py-3.5 text-left",
                    "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    "hover:bg-[color:var(--accent-soft)]",
                    "focus-visible:outline-none focus-visible:bg-[color:var(--accent-soft)]",
                  )}
                >
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--accent)]"
                    strokeWidth={1.75}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-medium text-foreground">{label}</span>
                    <span className="truncate text-[12px] text-muted-foreground">{hint}</span>
                  </span>
                  <ArrowUpRight
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      "group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-hover:text-[color:var(--accent)]",
                    )}
                    strokeWidth={2}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 pb-6 pt-2 sm:px-6">
          <div className="mx-auto max-w-[720px]">
            <div
              className={cn(
                "relative rounded-[14px] bg-[color:var(--canvas)] px-3 pt-3 pb-3.5",
                "shadow-[0_1px_2px_-1px_oklch(0_0_0/0.04),0_6px_18px_-10px_oklch(0_0_0/0.10),inset_0_0_0_1px_oklch(0_0_0/0.07)]",
                "focus-within:bg-background focus-within:shadow-[0_0_0_3px_oklch(0.62_0.14_65/0.15),0_1px_3px_-1px_oklch(0_0_0/0.06),0_10px_28px_-12px_oklch(0_0_0/0.12),inset_0_0_0_1px_oklch(0.62_0.14_65/0.60)]",
                "transition-[box-shadow,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
              )}
            >
              <textarea
                ref={textareaRef}
                rows={2}
                placeholder="Ask, build, explain…"
                className={cn(
                  "block w-full resize-none bg-transparent px-1 pb-1 pt-0.5 pr-10",
                  "text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground/60",
                  "focus:outline-none",
                )}
              />
              <div className="mt-2 flex items-center justify-between px-1 text-[10.5px] text-muted-foreground/70">
                <span className="flex items-center gap-1.5">
                  <kbd className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded border border-border/40 bg-background px-1 font-mono text-[9.5px] text-muted-foreground/70">↵</kbd>
                  <span>to send</span>
                  <span className="px-1 text-muted-foreground/30">·</span>
                  <kbd className="inline-flex h-[17px] items-center rounded border border-border/40 bg-background px-1 font-mono text-[9.5px] text-muted-foreground/70">⇧↵</kbd>
                  <span>for new line</span>
                </span>
              </div>
              <button
                type="button"
                disabled
                className={cn(
                  "absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md",
                  "bg-muted text-muted-foreground",
                  "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                )}
                aria-label="Send (disabled in placeholder)"
              >
                <SendHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>

      </div>
    )
  },
)

