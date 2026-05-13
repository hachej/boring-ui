import { Slot } from "@radix-ui/react-slot"
import type { ButtonHTMLAttributes, ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from "react"

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-xl border bg-background text-foreground", className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("px-6 pt-6", className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("px-6 pb-6", className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("font-semibold", className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("text-muted-foreground", className)} {...props} />
}

export function Badge({ className, variant: _variant, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: "secondary" }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs", className)} {...props} />
}

export function Button({ className, variant, asChild, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "outline" | "default"; asChild?: boolean; children?: ReactNode }) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50",
        variant === "outline" ? "border bg-background hover:bg-muted" : "bg-primary text-primary-foreground hover:opacity-90",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<typeof Comp>)}
    >
      {children}
    </Comp>
  )
}
