"use client";

import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@boring/ui";
import { cn } from "@/front/lib";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
import type { ComponentProps, ElementType, ReactNode } from "react";
import { isValidElement, useEffect, useRef, useState } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    data-boring-agent-part="tool-card"
    className={cn(
      "group not-prose my-3 w-full rounded-[var(--radius-lg)] bg-card/60",
      "shadow-[0_1px_0_oklch(0_0_0/0.02),0_1px_2px_-1px_oklch(0_0_0/0.04),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.55)]",
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

const TOOL_ICONS: Record<string, ElementType> = {
  bash: TerminalIcon,
  read: FileTextIcon,
  write: FilePlusIcon,
  edit: FilePenIcon,
  grep: SearchIcon,
  find: FolderSearchIcon,
  ls: FolderOpenIcon,
  exec_ui: ZapIcon,
  get_ui_state: ZapIcon,
};

export const getToolIcon = (toolName: string): ElementType =>
  TOOL_ICONS[toolName] ?? WrenchIcon;

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-3.5 text-accent" />,
  "approval-responded": <CheckCircleIcon className="size-3.5 text-accent" />,
  "input-available": <ClockIcon className="size-3.5 animate-pulse text-muted-foreground" />,
  "input-streaming": <CircleIcon className="size-3.5 text-muted-foreground" />,
  "output-available": <CheckCircleIcon className="size-3.5 text-accent" />,
  "output-denied": <XCircleIcon className="size-3.5 text-destructive" />,
  "output-error": <XCircleIcon className="size-3.5 text-destructive" />,
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
  return <span className="tabular-nums text-muted-foreground/50">{elapsed}s</span>
}

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full px-2 py-0.5 text-[11px]" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
    {status === "input-available" && (
      <ElapsedSeconds isRunning={true} />
    )}
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

  const Icon = getToolIcon(derivedName);

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground/70" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
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
  input: ToolPart["input"];
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
    <div data-boring-agent-part="tool-result" className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/30 text-foreground",
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
