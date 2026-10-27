'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { CheckIcon, CircleAlertIcon, RefreshCwIcon } from 'lucide-react';
import { CodeBlock } from '../pi-chat/code-block';
import { useChatText } from '../pi-chat/labels';
import type { ChatTextPart } from '../pi-chat/message';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';
/** A headless run as the host's `GET _agent/<name>/runs/<id>` returns it. */
export interface RunRecord {
  readonly id: string;
  readonly status: RunStatus;
  /** The structured result: shown as text (`renderText`) when it is text, as JSON otherwise. */
  readonly output?: unknown;
  /** The run's final text, shown when there is no `output`. */
  readonly text?: string | undefined;
  readonly error?: string | undefined;
  /** The agent's title. */
  readonly agent?: string | undefined;
  /** Epoch milliseconds or an ISO date. */
  readonly startedAt?: number | string | undefined;
  readonly finishedAt?: number | string | undefined;
}

const STATUSES: readonly RunStatus[] = ['queued', 'running', 'completed', 'failed'];
const time = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;
const optionalText = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

/** Reads a run record defensively (it comes over the network); undefined when it has no id or no known status. */
export function parseRun(value: unknown): RunRecord | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const { id, status } = record;
  if ((typeof id !== 'string' || !id) || typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) return undefined;
  const startedAt = time(record['startedAt']), finishedAt = time(record['finishedAt']);
  return { id, status: status as RunStatus, ...(record['output'] === undefined || record['output'] === null ? {} : { output: record['output'] }),
    ...(optionalText(record['text']) ? { text: record['text'] as string } : {}), ...(optionalText(record['error']) ? { error: record['error'] as string } : {}),
    ...(optionalText(record['agent']) ? { agent: record['agent'] as string } : {}), ...(startedAt === undefined ? {} : { startedAt }), ...(finishedAt === undefined ? {} : { finishedAt }) };
}

/** `42 s`, `3 min 5 s`, `1 h 2 min`. */
const span = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${seconds % 60 ? ` ${seconds % 60} s` : ''}`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
};

/**
 * A headless run (`POST _agent/<name>/runs` → `GET runs/<id>`) as a card: the agent's title, a status badge, a spinner while it is queued or
 * running with the elapsed time, then the duration and the output (or text, drawn by `renderText`: plain text, or `markdownText` of `pi-chat-markdown`), or the error. The host fetches: give `run` (a
 * record it keeps current), and optionally `fetchRun(id, signal)` to have the card poll every `pollMs` until the run settles and offer
 * Refresh. URLs are the host's (relative to its page). Render it from `renderTool` or `renderEntry`, or anywhere in the page.
 */
const plainRunText = ({ text }: ChatTextPart): ReactNode => <div data-testid="message-text" className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div>;

export function RunCard({ run: given, fetchRun, pollMs = 2000, now: clock = Date.now, renderText = plainRunText }: {
  readonly run: RunRecord;
  readonly fetchRun?: ((id: string, signal: AbortSignal) => Promise<unknown>) | undefined;
  readonly pollMs?: number;
  /** Draws the run's text. Default: plain text. */
  readonly renderText?: ((part: ChatTextPart) => ReactNode) | undefined;
  /** Test seam: the clock of the elapsed time. */
  readonly now?: () => number;
}) {
  const { labels } = useChatText();
  const [fetched, setFetched] = useState<RunRecord | undefined>();
  const [failed, setFailed] = useState(false);
  const run = fetched?.id === given.id ? fetched : given;
  const settled = run.status === 'completed' || run.status === 'failed';
  const [now, setNow] = useState(clock);
  const latest = useRef(fetchRun);
  useLayoutEffect(() => { latest.current = fetchRun; });

  const refresh = (signal: AbortSignal) => latest.current?.(given.id, signal).then(value => {
    if (signal.aborted) return;
    const parsed = parseRun(value);
    setFailed(!parsed);
    if (parsed?.id === given.id) setFetched(parsed);
  }).catch(() => { if (!signal.aborted) setFailed(true); });
  const polling = Boolean(fetchRun) && !settled;
  // The latest refresh, so polling restarts only when it starts, stops, or the run or interval changes.
  const refresher = useRef(refresh);
  useLayoutEffect(() => { refresher.current = refresh; });
  useEffect(() => {
    if (!polling) return;
    const abort = new AbortController();
    void refresher.current(abort.signal);
    const timer = setInterval(() => { void refresher.current(abort.signal); }, pollMs);
    return () => { abort.abort(); clearInterval(timer); };
  }, [polling, given.id, pollMs]);
  useEffect(() => {
    if (settled || run.startedAt === undefined) return;
    const timer = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(timer);
  }, [settled, run.startedAt, clock]);

  const started = time(run.startedAt), finished = time(run.finishedAt);
  const timing = started === undefined ? undefined : finished !== undefined ? labels.runDuration(span(finished - started)) : settled ? undefined : labels.runElapsed(span(now - started));
  const body = run.output !== undefined ? (typeof run.output === 'string' ? renderText({ text: run.output, streaming: false }) : <CodeBlock code={JSON.stringify(run.output, null, 2)} language="json" />)
    : run.text ? renderText({ text: run.text, streaming: false }) : undefined;

  return <Item variant="outline" size="sm" render={<section />} data-testid="run-card" data-state={run.status} data-run-id={run.id} aria-label={run.agent ?? labels.run} aria-busy={!settled} className="my-2 text-start">
    <ItemMedia variant="icon">
      {settled ? run.status === 'completed' ? <CheckIcon aria-hidden="true" /> : <CircleAlertIcon aria-hidden="true" /> : <Spinner data-testid="run-spinner" aria-label={labels.runStatus(run.status)} />}
    </ItemMedia>
    <ItemContent className="min-w-0 basis-0">
      <ItemTitle className="line-clamp-none [overflow-wrap:anywhere]">{run.agent ?? labels.run}</ItemTitle>
      <ItemDescription className="line-clamp-none flex flex-wrap items-center gap-2">
        <Badge data-testid="run-status" variant={run.status === 'failed' ? 'destructive' : run.status === 'completed' ? 'secondary' : 'outline'}>{labels.runStatus(run.status)}</Badge>
        {timing && <span data-testid="run-time">{timing}</span>}
      </ItemDescription>
    </ItemContent>
    {fetchRun && <Button variant="ghost" size="icon" data-testid="run-refresh" aria-label={labels.runRefresh} title={labels.runRefresh}
      onClick={() => { void refresh(new AbortController().signal); }}><RefreshCwIcon aria-hidden="true" /></Button>}
    {(body || run.error || failed) && <ItemFooter className="flex-col items-stretch">
      {body && <div data-testid="run-output" className="min-w-0">{body}</div>}
      {run.error && <Alert variant="destructive" data-testid="run-error"><AlertDescription>{run.error}</AlertDescription></Alert>}
      {failed && <p role="alert" className="m-0 text-sm text-destructive">{labels.runNotLoaded}</p>}
    </ItemFooter>}
  </Item>;
}
