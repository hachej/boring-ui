'use client';

import { Button } from '@/components/ui/button';
import { cn } from '../utils/utils';
import { RefreshCwIcon } from '../_shared/icons';

/** A link inside the sentence. The host decides what opening it means: an app, a task, or both. */
export type StatusLink = { label: string; app?: string; task?: string };
/** Plain text (code-made or model-made) or a link. */
export type StatusSegment = string | StatusLink;

export type StatusNarrativeLabels = { needsYou: (count: number) => string; refresh: string };

export const statusNarrativeLabels: StatusNarrativeLabels = {
  needsYou: count => (count === 1 ? '1 needs you' : `${count} need you`),
  refresh: 'Refresh status',
};

export type StatusNarrativeProps = {
  /** The paragraph as parts, in order. Strings are shown as is; link parts become buttons that call `onOpen`. */
  segments: readonly StatusSegment[];
  /** When the status was made, already formatted by the host ("2 min ago", "on open"). The block reads no clock. */
  at?: string;
  /** What wrote it, small, after the text ("router", "meta agent"). */
  by?: string;
  /** The one number of things waiting on the person: tasks waiting + open gates + critical security alerts. Hidden at 0 or when omitted. */
  needsYou?: number;
  /** A link part was tapped. */
  onOpen?: (link: StatusLink) => void;
  /** Shows a refresh button when given. */
  onRefresh?: () => void;
  labels?: Partial<StatusNarrativeLabels>;
  className?: string;
};

const tap = 'min-h-11 md:min-h-6';

/** The status paragraph of a home or a chat: two or three sentences, links inside, the time and the author underneath. Flat, no border. */
export function StatusNarrative({ segments, at, by, needsYou, onOpen, onRefresh, labels, className }: StatusNarrativeProps) {
  const t = { ...statusNarrativeLabels, ...labels };
  const waiting = needsYou !== undefined && needsYou > 0;
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-(--radius) bg-muted p-3 text-sm', className)}>
      <p className="min-w-0 break-words">
        {segments.map((part, index) =>
          typeof part === 'string' ? (
            <span key={index}>{part}</span>
          ) : onOpen ? (
            <Button key={index} variant="link" className="inline h-auto align-baseline" onClick={() => onOpen(part)}>
              {part.label}
            </Button>
          ) : (
            <span key={index} className="font-medium">{part.label}</span>
          ),
        )}
      </p>
      <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
        {waiting ? <span className="rounded-(--radius) bg-warning-soft px-2 text-warning-soft-foreground">{t.needsYou(needsYou)}</span> : null}
        {by ? <span className="truncate">{by}</span> : null}
        {at ? <span className="truncate">{at}</span> : null}
        {onRefresh ? (
          <Button variant="ghost" size="icon-sm" className={cn('ml-auto', tap)} aria-label={t.refresh} onClick={onRefresh}>
            <RefreshCwIcon aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
