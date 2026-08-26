import { ComponentProps, MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { copyTextToClipboard } from "../clipboard";
import { cn } from "../lib";

/**
 * Hover/focus affordances for URLs rendered inside chat markdown (#1395):
 * Copy writes the raw href; Open mirrors the anchor's own navigation
 * semantics. The anchor itself keeps its href untouched — actions are
 * additive siblings inside an inline group so text flow is preserved.
 */
export const MarkdownLink = ({ href, children, ...props }: ComponentProps<"a">) => {
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
      if (!href) return;
      if (await copyTextToClipboard(href)) markCopied();
    },
    [href, markCopied],
  );

  const handleOpen = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!href) return;
      window.open(href, "_blank", "noopener,noreferrer");
    },
    [href],
  );

  return (
    <span className="group">
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
      <span
        className="inline-flex shrink-0 items-center gap-px opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
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
    </span>
  );
};

