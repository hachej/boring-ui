import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '../utils/utils';
import { MoonIcon, MessageCircleQuestionIcon } from '../_shared/icons';

/** What the space is doing. `'unknown'` means the status could not be read: never shown as quiet. */
export type SpaceActivity = { working: number; waiting: number } | 'unknown';

export type SpaceCardLabels = { working: string; waiting: string; quiet: string; unknown: string; lastShip: string };

export const spaceCardLabels: SpaceCardLabels = {
  working: 'working', waiting: 'wait on you', quiet: 'Quiet', unknown: 'Status unreadable. Not the same as quiet.', lastShip: 'Last ship',
};

export type SpaceCardProps = {
  name: string;
  /** A logo or avatar. Defaults to the first letter of the name. */
  leading?: ReactNode;
  activity: SpaceActivity;
  /** When the space last shipped, already formatted ("2h ago"). Optional; hidden when unknown. */
  lastShip?: string;
  /** Makes the card a button. */
  onOpen?: () => void;
  labels?: Partial<SpaceCardLabels>;
  className?: string;
};

const box = 'flex h-auto min-h-11 w-full min-w-0 flex-col items-stretch justify-start gap-2 rounded-(--radius) px-3 py-3 text-left whitespace-normal bg-card text-card-foreground';
const hoverFill = 'hover:bg-accent';

/** One app or space at a glance: working and waiting counts, Quiet when both are 0, "unreadable" when the status could not be read. */
export function SpaceCard({ name, leading, activity, lastShip, onOpen, labels, className }: SpaceCardProps) {
  const t = { ...spaceCardLabels, ...labels };
  const unknown = activity === 'unknown';
  const quiet = !unknown && activity.working === 0 && activity.waiting === 0;
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-(--radius) bg-secondary text-xs font-semibold text-secondary-foreground group-hover/button:bg-card group-hover/button:text-card-foreground">{leading ?? name.slice(0, 1)}</span>
        <span className="truncate text-sm font-medium">{name}</span>
      </span>
      {unknown ? (
        <span className="flex items-start gap-2 text-xs text-muted-foreground"><MessageCircleQuestionIcon aria-hidden className="mt-0.5 size-4 shrink-0" /><span>{t.unknown}</span></span>
      ) : quiet ? (
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><MoonIcon aria-hidden className="size-4 shrink-0" /><span>{t.quiet}</span></span>
      ) : (
        <span className="flex gap-4 text-xs text-muted-foreground">
          <Count value={activity.working} label={t.working} />
          <Count value={activity.waiting} label={t.waiting} attention={activity.waiting > 0} />
        </span>
      )}
      {lastShip && !unknown ? <span className="truncate text-xs text-muted-foreground">{t.lastShip} {lastShip}</span> : null}
    </>
  );
  if (onOpen) return <Button variant="secondary" className={cn(box, hoverFill, className)} onClick={onOpen}>{content}</Button>;
  return <div className={cn(box, className)}>{content}</div>;
}

function Count({ value, label, attention }: { value: number; label: string; attention?: boolean }) {
  return (
    <span className="flex flex-col">
      <b className={cn('text-sm font-semibold tabular-nums', attention ? 'text-warning-soft-foreground' : 'text-foreground')}>{value}</b>
      <span>{label}</span>
    </span>
  );
}
