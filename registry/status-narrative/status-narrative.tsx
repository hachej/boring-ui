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
  /** The paragraph as parts, in order. Strings are shown as is; link parts become inline text links (anchors with `href="#"` and `preventDefault`, so they break across lines like text; exempt from the 44px rule) that call `onOpen`. */
  segments: readonly StatusSegment[];
  /** When the status was made. A string is shown as is, already formatted by the host ("2 min ago", "on open"). A `Date` is shown short in the browser's locale ("6 Nov", "6 nov."), with the year added when it is not the current year, as a `<time>` whose title holds the full date and time. */
  at?: string | Date;
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

/** A date as the short day and month in the browser's locale; the year joins it when it differs from this year, so an old date never reads as this year's. */
function ShortDate({ date }: { date: Date }) {
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const short = new Intl.DateTimeFormat(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(date);
  return <time dateTime={date.toISOString()} title={full} className="truncate">{short}</time>;
}

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
            <a
              key={index}
              href="#"
              className="cursor-pointer rounded-sm font-medium text-link underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={event => {
                event.preventDefault();
                onOpen(part);
              }}
            >
              {part.label}
            </a>
          ) : (
            <span key={index} className="font-medium">{part.label}</span>
          ),
        )}
      </p>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {waiting ? <span className="rounded-(--radius) bg-warning-soft px-2 text-warning-soft-foreground">{t.needsYou(needsYou)}</span> : null}
        {by ? <span className="truncate">{by}</span> : null}
        {at instanceof Date ? <ShortDate date={at} /> : at ? <span className="truncate">{at}</span> : null}
        {onRefresh ? (
          <Button variant="ghost" size="icon-sm" className={cn('ml-auto', tap)} aria-label={t.refresh} onClick={onRefresh}>
            <RefreshCwIcon aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
