import { cn } from '../utils/utils';

/** ok = working, warn = needs attention (sign-in, error), unknown = could not be read. */
export type WiringState = 'ok' | 'warn' | 'unknown';
/** `state` is required: a host that could not read the state says `'unknown'`, never ok by omission. */
export type WiringChip = { label: string; state: WiringState };

export type WiringChipsProps = {
  chips: readonly WiringChip[];
  /** The state word read by assistive tech (the dot alone is colour). Put the state in the chip text too when it matters to sighted people, as in "Calendar needs sign-in". */
  labels?: Partial<Record<WiringState, string>>;
  className?: string;
};

const defaults: Record<WiringState, string> = { ok: 'ok', warn: 'needs attention', unknown: 'not readable' };
const dot: Record<WiringState, string> = { ok: 'bg-success', warn: 'bg-warning', unknown: 'bg-muted-foreground' };

/** What an app is wired to (domain, repo, channels, connections), one small chip each with a state dot. */
export function WiringChips({ chips, labels, className }: WiringChipsProps) {
  const t = { ...defaults, ...labels };
  return (
    <ul className={cn('flex min-w-0 flex-wrap gap-1', className)}>
      {chips.map((chip, index) => {
        const state = chip.state ?? 'unknown'; // a missing state (untyped host) reads as unknown, never ok
        return (
          <li key={index} className="flex min-w-0 items-center gap-1 rounded-(--radius) bg-muted px-2 py-1 text-xs">
            <span aria-hidden className={cn('size-2 shrink-0 rounded-(--radius)', dot[state])} />
            <span className="truncate">{chip.label}</span>
            {state === 'ok' ? null : <span className="sr-only">{t[state]}</span>}
          </li>
        );
      })}
    </ul>
  );
}
