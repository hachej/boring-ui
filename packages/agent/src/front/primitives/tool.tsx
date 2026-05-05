"use client";

import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@boring/ui";
import { cn } from "@/front/lib";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement, useEffect, useRef, useState } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    data-boring-agent-part="tool-card"
    className={cn(
      // Lighter card — inside a group it reads as a sub-item, not a standalone.
      // Thin inset border, almost-transparent bg, no outer shadow.
      "group not-prose my-1.5 w-full min-w-0 rounded-[var(--radius-md)] bg-card/30",
      "shadow-[inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.4)]",
      "overflow-hidden",
      className,
    )}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: ReactNode;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Done",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-3 text-accent" />,
  "approval-responded": <CheckCircleIcon className="size-3 text-accent" />,
  "input-available": <ClockIcon className="size-3 animate-pulse text-muted-foreground" />,
  "input-streaming": <CircleIcon className="size-3 text-muted-foreground" />,
  "output-available": <CheckCircleIcon className="size-3 text-accent" />,
  "output-denied": <XCircleIcon className="size-3 text-destructive" />,
  "output-error": <XCircleIcon className="size-3 text-destructive" />,
};

function ElapsedSeconds({ isRunning }: { isRunning: boolean }) {
  const startRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isRunning) return
    if (startRef.current === null) startRef.current = Date.now()
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current!) / 1000))
    }, 1000)
    return () => clearInterval(tick)
  }, [isRunning])

  if (!isRunning || elapsed === 0) return null
  return <span className="tabular-nums opacity-50">{elapsed}s</span>
}

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge
    className="gap-1 rounded-full px-1.5 py-0 text-[10px] leading-5"
    variant="secondary"
  >
    {statusIcons[status]}
    {statusLabels[status]}
    {status === "input-available" && <ElapsedSeconds isRunning={true} />}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-3 px-2.5 py-2",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
        <span className="truncate font-medium text-[13px]">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "overflow-hidden data-[state=closed]:animate-[boring-collapse-close_150ms_ease] data-[state=open]:animate-[boring-collapse-open_150ms_ease]",
      "space-y-2.5 border-t border-border/30 p-2.5 text-popover-foreground outline-none",
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("overflow-hidden rounded-sm", className)} {...props}>
    <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
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

  let Output: ReactNode = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="text" />;
  }

  return (
    <div data-boring-agent-part="tool-result" className={cn("min-w-0 overflow-hidden", className)} {...props}>
      <div
        className={cn(
          "max-h-72 overflow-x-hidden overflow-y-auto rounded-sm text-xs",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "",
        )}
      >
        {errorText && <div className="p-2 font-mono text-[11px]">{errorText}</div>}
        {!errorText && Output}
      </div>
    </div>
  );
};
