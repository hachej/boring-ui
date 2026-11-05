import type { ReactNode } from 'react';
import { cn } from '../utils/utils';
import { ArrowDown, ArrowUp } from '../_shared/icons';

/** A change between two readings. `null` says nothing: equal values, no base to compare with, or a change that rounds to 0%. */
export type KpiChange = { direction: 'up' | 'down'; percent: number };

export function kpiChange(current: number, previous: number): KpiChange | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0 || current === previous) return null;
  const percent = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (percent === 0) return null;
  return { direction: current > previous ? 'up' : 'down', percent };
}

export type KpiStatProps = {
  label: string;
  /** Already formatted by the caller (currency, locale, unit). */
  value: string;
  /** The delta shows only when the two readings differ. */
  compare?: { current: number; previous: number };
  className?: string;
};

export function KpiStat({ label, value, compare, className }: KpiStatProps) {
  const change = compare ? kpiChange(compare.current, compare.previous) : null;
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-sm font-semibold tabular-nums">{value}</span>
      {change ? <KpiDelta change={change} /> : null}
    </div>
  );
}

function KpiDelta({ change }: { change: KpiChange }) {
  const up = change.direction === 'up';
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono text-xs tabular-nums', up ? 'text-success' : 'text-destructive')}>
      <Arrow aria-hidden className="size-3" />
      <span className="sr-only">{up ? 'Up' : 'Down'} </span>
      {up ? '+' : '−'}
      {Math.abs(change.percent)}%
    </span>
  );
}

export type KpiRowProps = { children: ReactNode; className?: string };

/** One surface holds the whole row of stats; never one card per stat. */
export function KpiRow({ children, className }: KpiRowProps) {
  return (
    <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-x-6 gap-y-4 rounded-(--radius) bg-card p-4', className)}>
      {children}
    </div>
  );
}
