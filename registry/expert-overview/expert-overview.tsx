'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '../utils/utils';
import { ChevronLeftIcon, ChevronRightIcon } from '../_shared/icons';

/** A step of the track, in the app's words (for Studio: Framed, Proven, Rehearsed, Accepted). */
export type ExpertStep = { id: string; label: string };

/** One thing that needs the person: a sentence, one gesture and, when `later` is given, a quiet « Later ». The app orders the items; the block shows the first three. */
export type ExpertItem = { id: string; text: string; action: { label: string; onAction: () => void }; later?: { label?: string; onLater: () => void } };

/** One line per app. A caret and a button only when `onOpen` is given. `unreadable` shows `labels.unreadable` in place of `line`; a row with neither throws. */
export type ExpertApp = { id: string; name: string; line?: string; unreadable?: boolean; onOpen?: () => void };

/** Finished work, folded until the person opens it. */
export type ExpertDone = { label: string; items: readonly { id: string; title: string; meta?: string }[]; onOpenItem?: (id: string) => void };

/** `reached` steps are done. `turn` says who acts at the step `reached`: the person, the agents, or nobody (the feature waits). */
export type ExpertFeature = { id: string; title: string; status: string; reached: 0 | 1 | 2 | 3 | 4; turn: 'person' | 'agents' | 'nobody'; line?: string; action?: { label: string; onAction: () => void } };

export type ExpertOverviewLabels = {
  inProgress: string; later: string; show: string; hide: string; unreadable: string; calmHeading: string; back: string;
  /** The said form of a feature's track, for example « 3 of 4 steps done ». */
  progress: (reached: number, total: number) => string;
};

export const expertOverviewLabels: ExpertOverviewLabels = {
  inProgress: 'In progress', later: 'Later', show: 'Show', hide: 'Hide', unreadable: 'Status unreadable', calmHeading: 'Nothing needs you', back: 'Back',
  progress: (reached, total) => `${reached} of ${total} steps done`,
};

export type ExpertOverviewProps = {
  heading: string;
  intro?: string;
  /** At most three are shown; the app orders them. */
  needsYou: readonly ExpertItem[];
  apps: readonly ExpertApp[];
  done?: ExpertDone;
  /** Shown in place of `heading` and `intro` when `needsYou` is empty. */
  calm?: { heading: string; text?: string };
  labels?: Partial<ExpertOverviewLabels>;
  className?: string;
};

export type ExpertTrackProps = {
  title: string;
  subtitle?: string;
  /** Exactly four: any other length throws. */
  steps: readonly ExpertStep[];
  note?: string;
  features: readonly ExpertFeature[];
  done?: ExpertDone;
  extra?: { label: string; onAction: () => void };
  onBack?: () => void;
  labels?: Partial<ExpertOverviewLabels>;
  className?: string;
};

const MOST_SHOWN = 3;
const STEP_COUNT = 4;
const tap = 'min-h-11 md:min-h-8';
// A row is a ghost Button (layout classes only: the app's own button look) inside a list that bleeds 10px (the Button's padding), so row text lines up with the heading.
const row = 'h-auto min-h-11 w-full min-w-0 justify-start gap-3 whitespace-normal text-left';
const flat = 'flex min-w-0 items-start gap-3 px-2.5';
const quiet = 'text-sm text-muted-foreground';
// One calm colour per step, from the theme's info, success and warning tokens and their mixes (never red); both themes flip with the tokens. The word uses the soft-foreground tokens, which keep 4.5:1 text contrast.
const STEP_TONES = [
  { bar: 'bg-info', word: 'text-info-soft-foreground' },
  { bar: 'bg-[color-mix(in_oklab,var(--info),var(--success))]', word: 'text-[color-mix(in_oklab,var(--info-soft-foreground),var(--success-soft-foreground))]' },
  { bar: 'bg-success', word: 'text-success-soft-foreground' },
  { bar: 'bg-[color-mix(in_oklab,var(--success),var(--warning))]', word: 'text-[color-mix(in_oklab,var(--success-soft-foreground),var(--warning-soft-foreground))]' },
] as const;
const list = '-mx-2.5 flex flex-col divide-y divide-border';

function Dot() {
  return <span aria-hidden className="mt-4 size-2 shrink-0 rounded-(--radius) bg-warning" />;
}

function Item({ item, laterLabel }: { item: ExpertItem; laterLabel: string }) {
  const sentence = useId();
  if (!item.later) {
    return (
      <Button variant="ghost" className={cn(row, 'items-start')} aria-label={item.action.label} aria-describedby={sentence} data-testid="expert-item" onClick={item.action.onAction}>
        <Dot />
        <span id={sentence} className="min-w-0 flex-1 py-2 text-base font-normal leading-snug [overflow-wrap:anywhere]">{item.text}</span>
        <ChevronRightIcon aria-hidden className="mt-4 size-4 shrink-0 text-muted-foreground" />
      </Button>
    );
  }
  const { onLater, label } = item.later;
  return (
    <div className={cn(flat, 'py-1')} data-testid="expert-item">
      <Dot />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="py-2 text-base leading-snug [overflow-wrap:anywhere]">{item.text}</span>
        <div className="-ml-2.5 flex gap-2">
          <Button variant="ghost" size="sm" className={tap} onClick={item.action.onAction}><span className="font-semibold">{item.action.label}</span></Button>
          <Button variant="ghost" size="sm" className={tap} onClick={onLater}><span className="text-muted-foreground">{label ?? laterLabel}</span></Button>
        </div>
      </div>
    </div>
  );
}

function Fold({ done, labels }: { done: ExpertDone; labels: ExpertOverviewLabels }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" className={cn(tap, 'w-full justify-between')} aria-expanded={open} aria-controls={panel} onClick={() => setOpen(value => !value)}>
        <span>{done.label}</span><span aria-hidden>{open ? labels.hide : labels.show}</span>
      </Button>
      {open ? (
        <ul id={panel} className={list}>
          {done.items.map(item => (
            <li key={item.id}>
              {done.onOpenItem ? (
                <Button variant="ghost" className={cn(row, 'justify-between')} onClick={() => done.onOpenItem?.(item.id)}>
                  <Done title={item.title} meta={item.meta} /><ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Button>
              ) : <div className={cn(flat, 'min-h-11 items-center')}><Done title={item.title} meta={item.meta} /></div>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Done({ title, meta }: { title: string; meta?: string | undefined }): ReactNode {
  return <span className="flex min-w-0 flex-col"><span className="text-sm font-medium">{title}</span>{meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}</span>;
}

function AppRow({ app, labels }: { app: ExpertApp; labels: ExpertOverviewLabels }) {
  if (!app.line && !app.unreadable) throw new Error(`ExpertOverview: the app "${app.id}" needs a \`line\` or \`unreadable\``);
  const body = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 text-left">
      <span className="text-base font-semibold">{app.name}</span>
      <span className={quiet}>{app.unreadable ? labels.unreadable : app.line}</span>
    </span>
  );
  if (!app.onOpen) return <div className={cn(flat, 'items-center')} data-testid="expert-app">{body}</div>;
  return (
    <Button variant="ghost" className={cn(row, 'items-center')} data-testid="expert-app" onClick={app.onOpen}>
      {body}<ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Button>
  );
}

/** What needs the person, and what the agents are doing, on one quiet page. The block takes every sentence, count and day from the app and writes none: it fetches nothing, reads no clock and stores nothing. At most three items are shown; with none, the calm state. */
export function ExpertOverview({ heading, intro, needsYou, apps, done, calm, labels, className }: ExpertOverviewProps) {
  const t = { ...expertOverviewLabels, ...labels };
  const items = needsYou.slice(0, MOST_SHOWN);
  const quietPage = items.length === 0;
  return (
    <div className={cn('flex min-w-0 flex-col gap-6 text-foreground', className)}>
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{quietPage ? calm?.heading ?? t.calmHeading : heading}</h1>
        {quietPage ? (calm?.text ? <p className="text-base text-muted-foreground">{calm.text}</p> : null) : intro ? <p className="text-base text-muted-foreground">{intro}</p> : null}
      </header>
      {items.length ? <ul className={list}>{items.map(item => <li key={item.id}><Item item={item} laterLabel={t.later} /></li>)}</ul> : null}
      {apps.length ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.inProgress}</h2>
          <ul className={list}>{apps.map(app => <li key={app.id}><AppRow app={app} labels={t} /></li>)}</ul>
        </section>
      ) : null}
      {done ? <Fold done={done} labels={t} /> : null}
    </div>
  );
}

function Track({ feature, labels }: { feature: ExpertFeature; labels: ExpertOverviewLabels }) {
  const { title, status, reached, turn, line, action } = feature;
  return (
    <div role="group" aria-label={`${title}: ${status}, ${labels.progress(reached, STEP_COUNT)}`} className="flex flex-col gap-2 rounded-(--radius) bg-card px-4 py-3 text-card-foreground" data-testid="expert-feature">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{title}</span>
        <span className={cn('shrink-0 text-sm', turn === 'person' ? 'text-warning-soft-foreground' : 'text-muted-foreground')}>{status}</span>
      </div>
      <div aria-hidden className="grid grid-cols-4 gap-1">
        {Array.from({ length: STEP_COUNT }, (_, index) => (
          <span key={index} data-segment={index} className={cn('h-1.5 rounded-(--radius)', index < reached ? STEP_TONES[index]?.bar : index === reached && turn === 'person' ? 'bg-warning-soft' : index === reached && turn === 'agents' ? 'bg-muted-foreground' : 'bg-border')} />
        ))}
      </div>
      {line ? <span className={quiet}>{line}</span> : null}
      {action ? (
        <Button variant="ghost" className={cn(tap, '-ml-2.5 self-start')} onClick={action.onAction}>
          <span className="font-semibold">{action.label}</span><ChevronRightIcon aria-hidden className="size-4 shrink-0" />
        </Button>
      ) : null}
    </div>
  );
}

/** One app's track: the four steps and one row per feature. Colour is never the only sign: each row says its status and how far it is. */
export function ExpertTrack({ title, subtitle, steps, note, features, done, extra, onBack, labels, className }: ExpertTrackProps) {
  const t = { ...expertOverviewLabels, ...labels };
  if (steps.length !== STEP_COUNT) throw new Error(`ExpertTrack: \`steps\` must hold exactly ${STEP_COUNT} steps, got ${steps.length}`);
  return (
    <div className={cn('flex min-w-0 flex-col gap-5 text-foreground', className)}>
      {onBack ? <Button variant="ghost" className={cn(tap, '-ml-2.5 self-start')} onClick={onBack}><ChevronLeftIcon aria-hidden className="size-4" /><span className="text-muted-foreground">{t.back}</span></Button> : null}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className={quiet}>{subtitle}</p> : null}
      </header>
      <div className="flex flex-col gap-2">
        <ol className="grid grid-cols-4 gap-1 text-center text-xs font-semibold">{steps.map((step, index) => <li key={step.id} data-step={index} className={STEP_TONES[index]?.word}>{step.label}</li>)}</ol>
        {note ? <p className="text-center text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <div className="flex flex-col gap-2.5">{features.map(feature => <Track key={feature.id} feature={feature} labels={t} />)}</div>
      {done ? <Fold done={done} labels={t} /> : null}
      {extra ? <Button variant="outline" className={cn(tap, 'w-full')} onClick={extra.onAction}>{extra.label}</Button> : null}
    </div>
  );
}
