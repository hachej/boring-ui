"use client";

/**
 * Adapted from ai-elements (vercel/ai-elements) v1.9.0. This is the canonical
 * shadcn-styled Tool primitive — header with icon + title + status badge +
 * chevron, collapsible content with <ToolInput> / <ToolOutput> sections.
 * Keeping it 1:1 with upstream so the "Vercel template" look/feel lands
 * without local invention.
 */
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@hachej/boring-ui-kit";
import { cn } from "@/front/lib";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    data-boring-agent-part="tool-card"
    className={cn(
      // Inset-border + micro-shadow surface, matching the chat panel's
      // own card and the workspace shell. No `border` utility — the
      // 1px hairline lives inside `shadow` so the element's box metrics
      // don't shift between :hover and :focus states.
      "group not-prose my-3 w-full rounded-[var(--radius-lg)] bg-card/60",
      "shadow-[0_1px_0_oklch(0_0_0/0.02),0_1px_2px_-1px_oklch(0_0_0/0.04),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.55)]",
      "overflow-hidden",
      className,
    )}
    {...props}
  />
);

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-denied"
  | "output-error"
  | "aborted";

export type ToolPart = {
  type: `tool-${string}` | "dynamic-tool" | "tool-call";
  state: ToolState;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type ToolHeaderProps = {
  title?: ReactNode;
  className?: string;
  icon?: ReactNode;
  type: ToolPart["type"];
  state: ToolState;
  toolName?: string;
};

const statusLabels: Record<ToolState, string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
  aborted: "Aborted",
};

const statusIcons: Record<ToolState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-accent" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-accent" />,
  "input-available": <ClockIcon className="size-4 animate-pulse text-muted-foreground" />,
  "input-streaming": <CircleIcon className="size-4 text-muted-foreground" />,
  "output-available": <CheckCircleIcon className="size-4 text-accent" />,
  "output-denied": <XCircleIcon className="size-4 text-destructive" />,
  "output-error": <XCircleIcon className="size-4 text-destructive" />,
  aborted: <XCircleIcon className="size-4 text-muted-foreground" />,
};

export const getStatusBadge = (status: ToolState) => (
  <Badge className="shrink-0 gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  icon,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" || type === "tool-call" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      data-boring-agent-part="tool-header"
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-3 p-3 text-left",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon ?? <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />}
        <span data-boring-agent-part="tool-title" className="min-w-0 flex-1 truncate text-sm font-medium">
          {title ?? derivedName}
        </span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon
        data-boring-agent-part="tool-chevron"
        className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output: ReactNode = null;

  if (!errorText) {
    if (typeof output === "object" && !isValidElement(output)) {
      Output = (
        <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
      );
    } else if (typeof output === "string") {
      Output = <CodeBlock code={output} language="text" />;
    } else if (output) {
      Output = <div>{output as ReactNode}</div>;
    }
  }

  return (
    <div data-boring-agent-part="tool-result" className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "rounded-md text-xs [&_table]:w-full",
          errorText
            ? "overflow-hidden border border-destructive/20 bg-destructive/10 text-destructive"
            : "overflow-x-auto bg-muted/30 text-foreground",
        )}
      >
        {errorText ? (
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-[12px] leading-5 [overflow-wrap:anywhere]">
            {errorText}
          </pre>
        ) : null}
        {Output}
      </div>
    </div>
  );
};
