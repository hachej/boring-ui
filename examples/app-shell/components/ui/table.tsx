// Pinned shadcn@4.21.4 Base UI fixture, 2026-10 release.
// https://ui.shadcn.com/r/styles/base-nova/table.json. MIT, Copyright (c) 2023 shadcn.
"use client"

import * as React from "react"
import { cn } from "cn"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
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
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
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
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * `truncate` makes the cell one line with an ellipsis (D-1861): the children go in an inner block, because a td ignores max-width in an
 * auto-layout table. The block is bounded by `--table-cell-truncate-max` (default 16rem). The full text stays in `title`; a plain string
 * child is the default title.
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
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    >
      {truncate ? (
        <div
          data-slot="table-cell-truncate"
          className="overflow-hidden text-ellipsis whitespace-nowrap"
          style={{ maxWidth: "var(--table-cell-truncate-max, 16rem)" }}
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
      className={cn("mt-4 text-sm text-muted-foreground", className)}
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
