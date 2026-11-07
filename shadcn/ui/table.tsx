import * as React from "react"
import { cn } from "cn"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full min-w-0"
    >
      <table
        data-slot="table"
        className={cn("w-full table-fixed caption-bottom text-xs", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "px-2 py-1.5 text-left align-middle font-medium whitespace-normal break-words text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * `truncate` makes the cell one line with an ellipsis (D-1861): the children go in an inner block, because a td ignores max-width in an
 * auto-layout table. The block is bounded by `--table-cell-truncate-max` (default 16rem). The full text stays in `title`; a plain string
 * child is the default title. The block uses `overflow: clip` with a clip margin, not `hidden`, so an inline link's or Button's focus ring paints
 * outside it: `truncate` is for text and inline links; a 44px touch target still needs a row of at least 44px (the inline Button rule).
 */
function TableCell({
  className,
  truncate,
  title,
  children,
  ...props
}: React.ComponentProps<"td"> & { truncate?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-truncate={truncate ? "" : undefined}
      title={title ?? (truncate && typeof children === "string" ? children : undefined)}
      className={cn(
        "p-2 align-middle whitespace-normal break-words [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    >
      {truncate ? (
        <div
          data-slot="table-cell-truncate"
          className="overflow-clip text-ellipsis whitespace-nowrap"
          style={{ maxWidth: "var(--table-cell-truncate-max, 16rem)", overflowClipMargin: "0.5rem" }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
