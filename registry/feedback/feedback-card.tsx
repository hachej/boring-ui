'use client';

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
// Type-only: pi-chat has no alias for these chat types, so the card names them from the model SDK the host already installs.
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { FEEDBACK_ID, readableElement } from '@hachej/boring-feedback/format';
import { CheckIcon, LocateFixedIcon, MessageSquareTextIcon, ShieldAlertIcon } from 'lucide-react';
import type { ChatCard } from '../pi-chat/rows';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemHeader, ItemMedia, ItemTitle } from '@/components/ui/item';
import { cn } from '../utils/utils';

/*
 * The feedback card (FEEDBACK.md, "Activating it on an agent" and "UX"): `feedback` tool results in the transcript. A `list`
 * result is a list of reports with their element lines and placements; a `show` result is an OFFER for one element line. The
 * server-side tool never reveals anything: hovering (or focusing) an element line asks the host's page (`onShowFeedback`,
 * AmbientChat mounted in the subject's application page) to resolve it against the live page and highlight it, leaving the
 * line clears it (`onHideFeedback`), and clicking it does the same and lets the person choose among ambiguous candidates. The
 * card displays the host's honest result inline as a small badge (✓ only after the host reported a reveal; "2 matches · choose",
 * "confirm", "not on this page" or one short phrase otherwise, the host's full reason in its tooltip). Without the callback an offer
 * says `unavailable`: open the application page. Element lines read as `«Save profile» button  SettingsPage.jsx:65` (the readable
 * name, then the file basename; the full path in the tooltip). Everything shown is data, rendered as text.
 */
export const FEEDBACK_TOOL = 'feedback';

/** `intent`: a hover only highlights (an ambiguous placement is reported, not chosen); a click may ask the person to choose. */
export interface FeedbackShowRequest { readonly id: string; readonly anchor: number; readonly note?: string; readonly intent?: 'hover' | 'click' }
/**
 * What the host's page did, as a `PresentationResult` without a value. `detail` lets the card say it in a few words: `found`, `moved`
 * or `chosen` for a reveal; `choose` (with `matches`, the number of candidates) when a person must pick one, `missing` when nothing on
 * the page matches, `not-chosen` when the person picked none, `no-page` outside the application page. `reason` stays the full sentence.
 */
export type FeedbackShowDetail = 'found' | 'moved' | 'chosen' | 'choose' | 'missing' | 'not-chosen' | 'no-page';
export type FeedbackShowOutcome =
  | { readonly kind: 'applied'; readonly reason?: string; readonly detail?: FeedbackShowDetail }
  | { readonly kind: 'stale' | 'unavailable' | 'denied'; readonly reason: string; readonly detail?: FeedbackShowDetail; readonly matches?: number };
export interface FeedbackCardConfig {
  /** Resolve and reveal in the live page. Give it only where the chat is mounted in the subject's application page. */
  readonly onShowFeedback?: ((request: FeedbackShowRequest) => Promise<FeedbackShowOutcome>) | undefined;
  /** The pointer or focus left an element line: clear the highlight. */
  readonly onHideFeedback?: (() => void) | undefined;
}

/** `placement` is a short phrase, or undefined when there is nothing to say ("checked in the page": only the person's page can place it). */
export interface FeedbackAnchorView { readonly index: number; readonly kind: string; readonly fallback: string; readonly placement?: string; readonly placementDetail?: string; readonly source?: string }
export interface FeedbackItemView {
  readonly id: string; readonly title: string; readonly status: string; readonly author: string; readonly age: string; readonly subject: string;
  readonly anchors: readonly FeedbackAnchorView[]; readonly unavailable: boolean;
}
export type FeedbackResultView =
  | { readonly kind: 'list'; readonly items: readonly FeedbackItemView[]; readonly unprotected: boolean; readonly more: boolean }
  | { readonly kind: 'offer'; readonly id: string; readonly anchor: number; readonly note?: string; readonly fallback: string }
  | { readonly kind: 'refused'; readonly outcome: string; readonly reason: string };

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const MENTION = /(?:^|\/)([^/]+)\.md$/;

/** The report id of an `@<root><id>.md` mention, or undefined. The id is checked by `@hachej/boring-feedback/format`. */
export function feedbackMentionId(path: string): string | undefined {
  const id = MENTION.exec(path)?.[1];
  return id !== undefined && FEEDBACK_ID.test(id) ? id : undefined;
}

const CHECKED_IN_THE_PAGE = 'checked in the page';
/** How a placement reads in the card: a short phrase (what it was evaluated against goes to the tooltip), or nothing to say. */
function placementOf(value: unknown): { readonly placement?: string; readonly placementDetail?: string } {
  if (typeof value === 'string') return value === CHECKED_IN_THE_PAGE ? {} : { placement: value };
  if (!isObject(value)) return { placement: 'not evaluated' };
  const detail = typeof value['evaluated'] === 'string' ? { placementDetail: value['evaluated'] } : {};
  switch (value['kind']) {
    case 'exact': return { placement: 'found', ...detail };
    case 'moved': return { placement: 'moved', ...detail };
    case 'ambiguous': return { placement: 'several matches', ...detail };
    case 'partial': return { placement: 'partly found', ...detail };
    case 'missing': return { placement: 'not found', ...detail };
    case 'unsupported': return { placement: 'unsupported', ...detail };
    default: return { placement: 'not evaluated' };
  }
}

/** The card's view of a `feedback` tool result, or undefined when it has no card (read, resolve, malformed, failed). */
export function feedbackResultView(call: ToolCall, result: ToolResultMessage | undefined): FeedbackResultView | undefined {
  if (call.name !== FEEDBACK_TOOL || !result || result.isError) return undefined;
  const part = result.content.find(item => item.type === 'text');
  let value: unknown;
  try { value = JSON.parse(part?.type === 'text' ? part.text : ''); } catch { return undefined; }
  if (!isObject(value)) return undefined;
  if (value['action'] === 'list' && value['kind'] === 'available' && Array.isArray(value['items'])) {
    const items = value['items'].flatMap((item): FeedbackItemView[] => {
      if (!isObject(item) || typeof item['id'] !== 'string' || !FEEDBACK_ID.test(item['id'])) return [];
      const anchors = Array.isArray(item['anchors']) ? item['anchors'].flatMap((anchor): FeedbackAnchorView[] => isObject(anchor) && Number.isInteger(anchor['index'])
        ? [{ index: anchor['index'] as number, kind: text(anchor['kind']), fallback: text(anchor['fallback'], 'an anchor'), ...placementOf(anchor['placement']),
          ...(isObject(anchor['signals']) && typeof anchor['signals']['source'] === 'string' ? { source: anchor['signals']['source'] } : {}) }] : []) : [];
      return [{ id: item['id'], title: text(item['title'], item['id']), status: text(item['status']), author: text(item['author']), age: text(item['age']), subject: text(item['subject']), anchors, unavailable: item['unavailable'] !== undefined }];
    });
    return { kind: 'list', items, unprotected: value['protection'] === 'unprotected', more: typeof value['cursor'] === 'string' };
  }
  if (value['action'] !== 'show') return undefined;
  if (value['kind'] === 'offered' && typeof value['id'] === 'string' && FEEDBACK_ID.test(value['id']) && Number.isInteger(value['anchor']) && (value['anchor'] as number) >= 0) {
    return { kind: 'offer', id: value['id'], anchor: value['anchor'] as number, fallback: text(value['fallback'], 'the place this feedback points at'), ...(typeof value['note'] === 'string' && value['note'] ? { note: value['note'] } : {}) };
  }
  if (typeof value['kind'] === 'string' && ['denied', 'unsupported', 'missing', 'unavailable'].includes(value['kind'])) return { kind: 'refused', outcome: value['kind'], reason: text(value['reason']) };
  return undefined;
}

const OUTCOME_KINDS = ['applied', 'stale', 'unavailable', 'denied'] as const;
const DETAILS: readonly FeedbackShowDetail[] = ['found', 'moved', 'chosen', 'choose', 'missing', 'not-chosen', 'no-page'];
const NO_PAGE: FeedbackShowOutcome = { kind: 'unavailable', reason: 'Open the application page to see where this feedback points.', detail: 'no-page' };

/**
 * The few words an outcome reads as in the card, from what the host reported (never more): ✓ only for `applied`; candidates to
 * choose from as "2 matches · choose" (one candidate: "confirm"); nothing matching as "not on this page"; otherwise one short phrase.
 */
export function outcomeBadge(outcome: FeedbackShowOutcome): string {
  if (outcome.kind === 'applied') return outcome.detail === 'moved' ? '✓ moved' : outcome.detail === 'chosen' ? '✓ chosen' : '✓';
  if (outcome.kind === 'denied') return 'no access';
  switch (outcome.detail) {
    case 'choose': return outcome.matches === 1 ? 'confirm' : outcome.matches !== undefined && outcome.matches > 1 ? `${outcome.matches} matches · choose` : 'several matches · choose';
    case 'missing': return 'not on this page';
    case 'not-chosen': return 'none chosen';
    case 'no-page': return 'open the app page to see it';
    default: return outcome.kind === 'stale' ? 'changed since' : 'can’t show it here';
  }
}

/** Ask the host page, and keep only an outcome it really reported. A throw or an unknown value is `unavailable`. */
async function askPage(onShow: NonNullable<FeedbackCardConfig['onShowFeedback']>, request: FeedbackShowRequest): Promise<FeedbackShowOutcome> {
  try {
    const outcome: unknown = await onShow(request);
    if (isObject(outcome) && (OUTCOME_KINDS as readonly unknown[]).includes(outcome['kind'])) {
      const reason = text(outcome['reason']);
      const detail = (DETAILS as readonly unknown[]).includes(outcome['detail']) ? { detail: outcome['detail'] as FeedbackShowDetail } : {};
      const matches = Number.isInteger(outcome['matches']) && (outcome['matches'] as number) >= 0 ? { matches: outcome['matches'] as number } : {};
      return outcome['kind'] === 'applied' ? { kind: 'applied', ...(reason ? { reason } : {}), ...detail }
        : { kind: outcome['kind'] as 'stale' | 'unavailable' | 'denied', reason: reason || 'No reason given', ...detail, ...matches };
    }
    return { kind: 'unavailable', reason: 'The page reported no recognised result' };
  } catch { return { kind: 'unavailable', reason: 'The page could not show it' }; }
}

/**
 * One element line: hover or focus highlights it in the page through the host, leaving clears it, click does the same and may let the
 * person choose among candidates. The outcome is stated inline. Without the host callback the line is plain text.
 */
function ElementLine({ request, label, source, onShowFeedback, onHideFeedback, initial, onOutcome, children }: {
  readonly request: Omit<FeedbackShowRequest, 'intent'>; readonly label: string; readonly source?: string | undefined;
  readonly onShowFeedback: FeedbackCardConfig['onShowFeedback']; readonly onHideFeedback: FeedbackCardConfig['onHideFeedback'];
  readonly initial?: FeedbackShowOutcome | undefined; readonly onOutcome?: ((outcome: FeedbackShowOutcome | undefined) => void) | undefined; readonly children?: ReactNode;
}) {
  const [state, setState] = useState<FeedbackShowOutcome | 'showing' | undefined>(initial);
  const asked = useRef(0);
  // A click keeps what it showed (and any choice it asked for) after the pointer or focus leaves, until the next hover; a hover is transient.
  const kept = useRef(false);
  const show = async (intent: 'hover' | 'click') => {
    if (!onShowFeedback) return;
    kept.current = intent === 'click';
    const ask = ++asked.current;
    setState('showing');
    const outcome = await askPage(onShowFeedback, { ...request, intent });
    // A later hover or click wins; an earlier answer never overwrites it.
    if (ask !== asked.current) return;
    setState(outcome);
    onOutcome?.(outcome);
  };
  const hide = () => {
    if (kept.current) return;
    asked.current++; setState(current => current === 'showing' ? undefined : current); onHideFeedback?.();
  };
  const outcome = typeof state === 'object' ? state : undefined;
  const readable = readableElement(label, source);
  const badge = state === 'showing' ? <span data-testid="feedback-outcome" role="status" className="shrink-0 text-xs text-muted-foreground">looking…</span>
    : outcome ? <Badge data-testid="feedback-outcome" role="status" title={outcome.reason ?? 'Shown in the page.'} data-outcome={outcome.kind} variant={outcome.kind === 'applied' ? 'secondary' : 'outline'}>
      {outcome.kind === 'applied' ? <><CheckIcon aria-hidden="true" />{outcomeBadge(outcome).slice(1).trim() || <span className="sr-only">shown in the page</span>}</> : outcomeBadge(outcome)}</Badge>
      : children;
  const text = <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
    <span data-testid="feedback-fallback" className="font-semibold [overflow-wrap:anywhere]">{readable.name}</span>
    {readable.file && <span data-testid="feedback-source" title={readable.path ?? readable.file} className="font-mono text-xs font-normal text-muted-foreground">{readable.file}</span>}
    {badge}</span>;
  return <span className="block" data-outcome={outcome?.kind}>
    {onShowFeedback
      ? <Button variant="ghost" data-testid="feedback-element" data-feedback-id={request.id} data-anchor={request.anchor} title={`${label}${readable.path ? ` · ${readable.path}` : ''}\nHover to see it on the page; click to choose if it matches several places`}
        onMouseEnter={() => { void show('hover'); }} onFocus={() => { void show('hover'); }} onMouseLeave={hide} onBlur={hide} onClick={() => { void show('click'); }}
        className="h-auto w-full justify-start whitespace-normal text-left">{text}</Button>
      : <span data-testid="feedback-element" data-feedback-id={request.id} data-anchor={request.anchor} title={label} className="block">{text}</span>}
  </span>;
}

/** A report title (the person's note): two lines at most, with a toggle to read the rest. */
function ClampedTitle({ text: title }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  const long = title.length > 110 || title.includes('\n');
  return <span className="block">
    <span data-testid="feedback-title" className={cn('block whitespace-pre-line [overflow-wrap:anywhere]', !open && 'line-clamp-2')}>{title}</span>
    {long && <Button variant="link" size="xs" data-testid="feedback-title-more" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'less' : 'more'}</Button>}
  </span>;
}

function Offer({ view, onShowFeedback, onHideFeedback }: { readonly view: Extract<FeedbackResultView, { kind: 'offer' }>; readonly onShowFeedback: FeedbackCardConfig['onShowFeedback']; readonly onHideFeedback: FeedbackCardConfig['onHideFeedback'] }) {
  const [outcome, setOutcome] = useState<FeedbackShowOutcome | undefined>(onShowFeedback ? undefined : NO_PAGE);
  return <Item variant="outline" size="sm" render={<section />} data-testid="feedback-card" data-kind="offer" data-feedback-id={view.id} data-outcome={outcome?.kind} aria-label="Feedback offer" className="my-2 max-w-md">
    <ItemMedia variant="icon"><LocateFixedIcon aria-hidden="true" /></ItemMedia>
    <ItemContent className="min-w-0 basis-0">
      <ItemDescription>Feedback {view.id}</ItemDescription>
      <ElementLine request={{ id: view.id, anchor: view.anchor, ...(view.note === undefined ? {} : { note: view.note }) }} label={view.fallback}
        onShowFeedback={onShowFeedback} onHideFeedback={onHideFeedback} initial={onShowFeedback ? undefined : NO_PAGE} onOutcome={next => setOutcome(next)} />
      {view.note && <ItemDescription data-testid="feedback-note" className="line-clamp-none [overflow-wrap:anywhere]">{view.note}</ItemDescription>}
    </ItemContent>
  </Item>;
}

function List({ view, onShowFeedback, onHideFeedback }: { readonly view: Extract<FeedbackResultView, { kind: 'list' }>; readonly onShowFeedback: FeedbackCardConfig['onShowFeedback']; readonly onHideFeedback: FeedbackCardConfig['onHideFeedback'] }) {
  return <Item variant="outline" size="sm" render={<section />} data-testid="feedback-card" data-kind="list" aria-label="Feedback" className="my-2 max-w-xl flex-col items-stretch">
    <ItemHeader>
      <ItemTitle><MessageSquareTextIcon className="size-4" aria-hidden="true" />Feedback · {view.items.length}{view.more ? '+' : ''}</ItemTitle>
      {view.unprotected && <Badge variant="secondary" data-testid="feedback-unprotected"><ShieldAlertIcon aria-hidden="true" />Unprotected store</Badge>}
    </ItemHeader>
    {view.items.length === 0 && <ItemDescription>No feedback.</ItemDescription>}
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {view.items.map(item => <Item key={item.id} variant="muted" size="xs" render={<li />} data-testid="feedback-item" data-feedback-id={item.id} data-status={item.status}>
        <ItemContent className="min-w-0 basis-0">
          <ClampedTitle text={item.title} />
          <ItemDescription data-testid="feedback-meta" className="line-clamp-none">{[item.status, item.author, item.age, item.unavailable ? 'unavailable' : ''].filter(Boolean).join(' · ')}</ItemDescription>
          {item.anchors.length > 0 && <ul className="m-0 list-none p-0">
            {item.anchors.map(anchor => <li key={anchor.index} data-testid="feedback-anchor" className="[overflow-wrap:anywhere]">
              <ElementLine request={{ id: item.id, anchor: anchor.index }} label={anchor.fallback} source={anchor.source}
                onShowFeedback={anchor.kind === 'app.element@1' ? onShowFeedback : undefined} onHideFeedback={onHideFeedback}>
                {anchor.placement && <Badge variant="outline" data-testid="feedback-placement" title={anchor.placementDetail}>{anchor.placement}</Badge>}
              </ElementLine></li>)}
          </ul>}
        </ItemContent>
      </Item>)}
    </ul>
  </Item>;
}

/** One `feedback` tool result: a list, an offer, or a refusal stated as such. Element lines highlight in the page on hover. */
export function FeedbackCard({ view, onShowFeedback, onHideFeedback }: { readonly view: FeedbackResultView; readonly onShowFeedback?: FeedbackCardConfig['onShowFeedback']; readonly onHideFeedback?: FeedbackCardConfig['onHideFeedback'] }) {
  if (view.kind === 'list') return <List view={view} onShowFeedback={onShowFeedback} onHideFeedback={onHideFeedback} />;
  if (view.kind === 'offer') return <Offer view={view} onShowFeedback={onShowFeedback} onHideFeedback={onHideFeedback} />;
  return <Item variant="muted" size="sm" render={<section />} data-testid="feedback-card" data-kind="refused" data-outcome={view.outcome} aria-label="Feedback" className="my-2 max-w-md">
    <ItemContent className="min-w-0 basis-0"><ItemDescription className="line-clamp-none">Feedback not shown ({view.outcome}){view.reason ? `: ${view.reason}` : ''}</ItemDescription></ItemContent></Item>;
}

/** An `@<root><id>.md` mention of a report in a sent message. */
export function FeedbackMention({ path, id, onOpen }: { readonly path: string; readonly id: string; readonly onOpen?: ((path: string) => void) | undefined }) {
  const body = <><MessageSquareTextIcon aria-hidden="true" />{id}</>;
  return onOpen
    ? <Button variant="outline" size="xs" data-testid="feedback-mention" data-path={path} aria-label={`Open feedback ${id}`} onClick={() => onOpen(path)}>{body}</Button>
    : <Badge variant="outline" data-testid="feedback-mention" data-path={path} title={`Feedback ${id}`}>{body}</Badge>;
}

/**
 * The `mentions.render` of a pi-chat host (`MentionsConfig`): `@<root><id>.md` report mentions in sent messages become feedback chips,
 * any other mention keeps pi-chat's default. `onOpen` (the chat's `mentions.open`) makes a chip a button.
 */
export function feedbackMentionRenderer(onOpen?: ((path: string) => void) | undefined): (path: string) => ReactNode | undefined {
  return path => {
    const id = feedbackMentionId(path);
    return id === undefined ? undefined : <FeedbackMention path={path} id={id} onOpen={onOpen} />;
  };
}

/**
 * A `renderTool` for `PiChat` or `AmbientChat`: cards for `feedback` list results, offers and refusals, `inline` so they
 * stay in the transcript in expert mode. Memoize it; compose with another renderer as `(c, r) => feedback(c, r) ?? mine(c, r)`.
 */
export function feedbackRenderTool(config: FeedbackCardConfig = {}): (call: ToolCall, result: ToolResultMessage | undefined) => ChatCard | undefined {
  return (call, result) => {
    const view = feedbackResultView(call, result);
    return view ? { content: <FeedbackCard view={view} onShowFeedback={config.onShowFeedback} onHideFeedback={config.onHideFeedback} />, inline: true } : undefined;
  };
}
