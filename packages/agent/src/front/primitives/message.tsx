"use client";

import { Button } from "@/front/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/front/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/front/ui/tooltip";
import { cn } from "@/front/lib";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactElement, ReactNode } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "./code-block";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    data-boring-agent-message-role={from}
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

// Default Shiki theme pair — [light, dark]. Streamdown auto-selects based on
// prefers-color-scheme. Consumers can override via the shikiTheme prop.
const DEFAULT_SHIKI_THEME = ["github-light", "github-dark-dimmed"] as unknown as [
  Parameters<typeof Streamdown>[0]["shikiTheme"] extends [infer A, infer _B] | undefined ? A : never,
  Parameters<typeof Streamdown>[0]["shikiTheme"] extends [infer _A, infer B] | undefined ? B : never,
];

// Route all fenced code blocks that appear inside assistant markdown messages
// through the canonical ai-elements <CodeBlock> primitive — so tool outputs
// and in-message code blocks share one implementation instead of looking
// subtly different.
function extractCodeBlockLanguage(children: unknown): string | undefined {
  if (!children) return undefined;
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (!c || typeof c !== "object") continue;
    const props = (c as { props?: Record<string, unknown> }).props;
    if (!props) continue;
    const cls = props.className;
    if (typeof cls !== "string") continue;
    const match = cls.match(/language-([\w-]+)/);
    if (match) return match[1];
  }
  return undefined;
}

function extractCodeBlockText(children: unknown): string {
  const walk = (node: unknown): string => {
    if (node == null || node === false) return "";
    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(walk).join("");
    if (typeof node === "object") {
      const props = (node as { props?: { children?: unknown } }).props;
      if (props && "children" in props) return walk(props.children);
    }
    return "";
  };
  return walk(children);
}

const MarkdownPre = ({ children }: { children?: unknown }) => {
  const code = extractCodeBlockText(children).replace(/\n$/, "");
  const language = extractCodeBlockLanguage(children);
  return (
    <CodeBlock code={code} language={language ?? "text"} className="my-3">
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename>{language ?? "text"}</CodeBlockFilename>
        </CodeBlockTitle>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
    </CodeBlock>
  );
};

// Inline code (not inside a fenced block) should stay inline-chip styled.
// Streamdown passes {inline} to `code` when it's inline; we forward fenced
// code rendering to MarkdownPre (above) and only skin inline code here.
const MarkdownCode = ({
  inline,
  className,
  children,
  ...props
}: {
  inline?: boolean;
  className?: string;
  children?: unknown;
} & Record<string, unknown>) => {
  if (inline === false) {
    // Fenced code block — let <pre> handle rendering via MarkdownPre.
    return (
      <code className={className} {...(props as Record<string, unknown>)}>
        {children as ReactNode}
      </code>
    );
  }
  return (
    <code
      className={cn(
        "rounded-sm border border-input bg-muted/80 px-1.5 py-[0.1em]",
        "font-mono text-[0.92em] font-medium text-foreground",
        className,
      )}
      {...(props as Record<string, unknown>)}
    >
      {children as ReactNode}
    </code>
  );
};

const markdownComponents = {
  pre: MarkdownPre,
  code: MarkdownCode,
} as unknown as ComponentProps<typeof Streamdown>["components"];

export const MessageResponse = memo(
  ({ className, shikiTheme, components, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      plugins={streamdownPlugins}
      shikiTheme={shikiTheme ?? DEFAULT_SHIKI_THEME}
      components={{ ...markdownComponents, ...(components ?? {}) }}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
