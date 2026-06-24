import React from "react"

/**
 * Local UI primitives, styled to match @hachej/boring-ui-kit.
 *
 * Deliberately NOT importing the kit: runtime plugins load it through the
 * Vite proxy with its full radix dependency graph, which is slow on cold
 * load and can pull a second React copy into the page (hooks then crash
 * with "ReactSharedInternals.H is null"). Only the host React singleton
 * and design tokens are shared.
 */

export function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}

type ButtonVariant = "outline" | "ghost" | "secondary"
type ButtonSize = "xs" | "icon-xs"

const buttonVariantClass: Record<ButtonVariant, string> = {
  outline: "border border-border bg-background text-foreground hover:bg-muted/60",
  ghost: "text-foreground hover:bg-muted/60",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
}

const buttonSizeClass: Record<ButtonSize, string> = {
  xs: "h-6 gap-1 px-2",
  "icon-xs": "size-6",
}

const buttonBaseClass =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"

export function Button({
  variant = "outline",
  size = "xs",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type="button" {...props} className={classes(buttonBaseClass, buttonVariantClass[variant], buttonSizeClass[size], className)} />
}

export function LinkButton({
  variant = "outline",
  size = "xs",
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <a {...props} className={classes(buttonBaseClass, buttonVariantClass[variant], buttonSizeClass[size], className)} />
}

export function ChipButton({
  selected,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={classes(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected ? "border-foreground/20 bg-foreground/10 text-foreground" : "border-border bg-muted/50 hover:bg-muted",
        className,
      )}
    />
  )
}

export function Badge({
  variant = "outline",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "outline" | "secondary" }) {
  return (
    <span
      {...props}
      className={classes(
        "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        variant === "outline" ? "border-border text-foreground" : "border-transparent bg-secondary text-secondary-foreground",
        className,
      )}
    />
  )
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={classes(
        "w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    />
  )
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={classes(
        "w-full min-w-0 resize-y rounded-md border border-border bg-background p-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    />
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={classes("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  )
}

export function Separator() {
  return <hr className="border-0 border-t border-border" />
}

export function EmptyState({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={classes("flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center", className)}>
      {(title || description) && (
        <div className="space-y-1">
          {title && <h3 className="text-sm font-medium text-foreground">{title}</h3>}
          {description && <p className="mx-auto max-w-[48ch] text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
      {actions && <div className="flex items-center justify-center gap-2">{actions}</div>}
    </div>
  )
}
