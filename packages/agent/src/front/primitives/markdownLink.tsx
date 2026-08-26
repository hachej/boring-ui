import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { copyTextToClipboard } from "../clipboard";
import { cn } from "../lib";

const LINK_ACTIONS_TAG = "boring-link-actions";
const INCOMPLETE_LINK_HREF = "streamdown:incomplete-link";

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * Decorate markdown links without replacing Streamdown's anchor renderer.
 * Keeping the original `a` node means Streamdown continues to own URL
 * transformation, incomplete-link behavior, styling, and linkSafety.
 */
function decorateLinks(node: HastNode): void {
  if (!node.children) return;

  for (const child of node.children) decorateLinks(child);

  node.children = node.children.flatMap((child) => {
    if (child.type !== "element" || child.tagName !== "a") return [child];

    const href = child.properties?.href;
    if (typeof href !== "string" || href === INCOMPLETE_LINK_HREF) return [child];

    return [{
      type: "element",
      tagName: "span",
      properties: {
        className: ["group/markdown-link"],
        "data-boring-agent-part": "chat-url-group",
      },
      children: [
        child,
        {
          type: "element",
          tagName: LINK_ACTIONS_TAG,
          properties: { href },
          children: [],
        },
      ],
    }];
  });
}

/** Rehype plugin installed by MessageResponse for chat URL affordances. */
export const rehypeMarkdownLinkActions = () => (tree: HastNode) => {
  decorateLinks(tree);
};

type MarkdownLinkActionsProps = {
  href?: string;
  node?: unknown;
};

/**
 * Action controls paired with the preceding Streamdown link. Open delegates
 * to that link's click behavior so linkSafety remains the single policy owner.
 */
export const MarkdownLinkActions = ({ href }: MarkdownLinkActionsProps) => {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  const markCopied = useCallback(() => {
    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, []);

  const handleCopy = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (href && await copyTextToClipboard(href)) markCopied();
    },
    [href, markCopied],
  );

  const handleOpen = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget
      .closest('[data-boring-agent-part="chat-url-group"]')
      ?.querySelector<HTMLElement>('[data-streamdown="link"]')
      ?.click();
  }, []);

  return (
    <span
      className={cn(
        "pointer-events-none inline-flex shrink-0 items-center gap-px opacity-0 transition-opacity duration-150",
        "group-hover/markdown-link:pointer-events-auto group-hover/markdown-link:opacity-100",
        "group-focus-within/markdown-link:pointer-events-auto group-focus-within/markdown-link:opacity-100",
      )}
      data-boring-agent-part="chat-url-actions"
    >
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy URL"
        title={copied ? "Copied" : "Copy URL"}
        className={cn(
          "inline-flex size-4 items-center justify-center rounded-[2px]",
          "text-muted-foreground/70 transition-colors duration-150",
          "hover:bg-foreground/[0.06] hover:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/40",
        )}
      >
        {copied ? <CheckIcon className="size-3" aria-hidden="true" /> : <CopyIcon className="size-3" aria-hidden="true" />}
      </button>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Open URL in new tab"
        title="Open URL in new tab"
        className={cn(
          "inline-flex size-4 items-center justify-center rounded-[2px]",
          "text-muted-foreground/70 transition-colors duration-150",
          "hover:bg-foreground/[0.06] hover:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/40",
        )}
      >
        <ExternalLinkIcon className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
};

export const markdownLinkComponents = {
  [LINK_ACTIONS_TAG]: MarkdownLinkActions,
};
