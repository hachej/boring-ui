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
  /** Readings in time order, drawn as a small line under the value. Fewer than two finite readings draw nothing. The line is scaled to its own range; it carries no axis. */
  trend?: readonly number[];
  /** Says the trend in words (for example « Rising over 7 days »). Without it the line is decoration and hidden from a screen reader. */
  trendLabel?: string;
  className?: string;
};

export function KpiStat({ label, value, compare, trend, trendLabel, className }: KpiStatProps) {
  const change = compare ? kpiChange(compare.current, compare.previous) : null;
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-semibold tabular-nums">{value}</span>
      {change ? <KpiDelta change={change} /> : null}
      {trend ? <KpiTrend trend={trend} label={trendLabel} /> : null}
    </div>
  );
}

const TREND_W = 100;
const TREND_H = 24;
const TREND_PAD = 2;

/** The polyline points of a trend, or null when there is nothing to draw. A flat series sits mid-height. */
export function kpiTrendPoints(trend: readonly number[]): string | null {
  const values = trend.filter(Number.isFinite);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * TREND_W;
      const y = span === 0 ? TREND_H / 2 : TREND_H - TREND_PAD - ((v - min) / span) * (TREND_H - 2 * TREND_PAD);
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(' ');
}

function KpiTrend({ trend, label }: { trend: readonly number[]; label?: string }) {
  const points = kpiTrendPoints(trend);
  if (!points) return null;
  return (
    <svg data-testid="kpi-trend" viewBox={`0 0 ${TREND_W} ${TREND_H}`} preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="mt-1 h-6 w-full text-info">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function KpiDelta({ change }: { change: KpiChange }) {
  const up = change.direction === 'up';
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs tabular-nums', up ? 'text-success' : 'text-destructive')}>
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
