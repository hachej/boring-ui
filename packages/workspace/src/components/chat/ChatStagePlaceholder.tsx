"use client"

import { forwardRef, useContext, useImperativeHandle, useRef } from "react"
import {
  ArrowUpRight,
  BookOpen,
  Clock3,
  Code2,
  FileSearch,
  PanelLeftClose,
  Plus,
  SendHorizontal,
  Wand2,
  User,
} from "lucide-react"
import { cn } from "../../lib/utils"
import { ChatShellContext } from "./context"

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
  function ChatStagePlaceholder({ sessionTitle, sessionId, appTitle = "Boring", className }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const shell = useContext(ChatShellContext)

    useImperativeHandle(ref, () => ({
      focusComposer() {
        textareaRef.current?.focus()
      },
    }))

    return (
      <div className={cn("relative flex h-full min-h-0 flex-col bg-background", className)}>
        <header
          className="flex items-center justify-between gap-3 border-b border-border/50 px-4"
          style={{ height: 52 }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
            >
              {appTitle.charAt(0).toUpperCase()}
            </div>
            <span className="truncate text-[13px] font-medium tracking-tight text-foreground">{appTitle}</span>
            {sessionTitle && (
              <>
                <span aria-hidden="true" className="text-muted-foreground/40">/</span>
                <span className="truncate text-[13px] font-normal text-muted-foreground">{sessionTitle}</span>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {shell && (
              <IconButton
                onClick={shell.toggleDrawer}
                active={shell.drawerOpen}
                aria-pressed={shell.drawerOpen}
                label={shell.drawerOpen ? "Hide sessions" : "Show sessions"}
                hint="⌘1"
              >
                {shell.drawerOpen ? <PanelLeftClose className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
              </IconButton>
            )}
            {shell?.onNewChat && (
              <IconButton onClick={shell.onNewChat} label="New chat">
                <Plus className="h-4 w-4" />
              </IconButton>
            )}
            <div className="mx-1.5 h-5 w-px bg-border/70" aria-hidden="true" />
            <button
              type="button"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground",
                "transition-colors hover:bg-muted/70 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-label="Account"
              title="Account"
            >
              <User className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full w-full max-w-[640px] flex-col justify-center px-6 py-12">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <span className="inline-block h-px w-6 bg-[color:var(--accent)]" aria-hidden="true" />
              New session
            </div>
            <h3 className="mt-3 text-[34px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground">
              What are we building?
            </h3>
            <p className="mt-3 max-w-[440px] text-[14px] leading-relaxed text-muted-foreground">
              Ask a question, open a file from the workbench, or start from a template.
            </p>
            <div className="mt-8 grid w-full grid-cols-1 gap-px overflow-hidden rounded-xl bg-[color:var(--border)] sm:grid-cols-2">
              {PROMPT_SUGGESTIONS.map(({ label, hint, Icon }) => (
                <button
                  key={label}
                  type="button"
                  className={cn(
                    "group flex items-start gap-3 bg-background px-4 py-3.5 text-left transition-colors",
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
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-hover:text-[color:var(--accent)]"
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
                "relative rounded-[14px] bg-background p-3",
                "shadow-[0_1px_2px_-1px_oklch(0_0_0/0.04),0_6px_18px_-10px_oklch(0_0_0/0.10),inset_0_0_0_1px_oklch(0_0_0/0.06)]",
                "focus-within:shadow-[0_1px_3px_-1px_oklch(0_0_0/0.06),0_10px_28px_-12px_oklch(0_0_0/0.12),inset_0_0_0_1px_oklch(0.62_0.14_65/0.40)]",
                "transition-shadow duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
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
              <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border/60 bg-background px-1 font-mono text-[10px] text-muted-foreground">↵</kbd>
                  <span>to send</span>
                  <span className="px-1 text-muted-foreground/40">·</span>
                  <kbd className="inline-flex h-[18px] items-center rounded border border-border/60 bg-background px-1 font-mono text-[10px] text-muted-foreground">⇧↵</kbd>
                  <span>for new line</span>
                </span>
                <kbd className="inline-flex h-[18px] items-center rounded border border-border/60 bg-background px-1.5 font-mono text-[10px] text-muted-foreground">
                  ⌘K
                </kbd>
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

function IconButton({
  children,
  onClick,
  active,
  label,
  hint,
  ...rest
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  label: string
  hint?: string
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md",
        "text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-muted text-foreground",
      )}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      {...rest}
    >
      {children}
    </button>
  )
}
