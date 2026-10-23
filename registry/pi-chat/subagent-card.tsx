'use client';

import { useEffect, useState } from 'react';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { ArrowDownIcon, ArrowUpIcon, BotIcon, CheckIcon, CircleAlertIcon, CircleSlashIcon, ClockIcon, WrenchIcon } from 'lucide-react';
import { useChatText } from './labels';

/** `DELEGATE_DETAILS_KIND` of `@hachej/boring-agent/agents` (a contract test keeps them equal). */
export const DELEGATE_DETAILS_KIND = 'boring.delegate';
export type SubagentStatus = 'running' | 'done' | 'failed' | 'cancelled';
/** A delegate call's details (`DelegateDetails` of `@hachej/boring-agent/agents`, version 1) as the card reads them. */
export interface SubagentDetails {
  readonly agent: string;
  /** The child conversation (Pi's conversation id). */
  readonly conversationId: number;
  readonly status: SubagentStatus;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly toolCalls: number;
  readonly tokens: { readonly input: number; readonly output: number };
  readonly error?: string;
}

const STATUSES: readonly SubagentStatus[] = ['running', 'done', 'failed', 'cancelled'];
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * Reads a delegate call's details defensively (they come from the conversation): undefined unless they are version 1
 * `DelegateDetails`. With the call's `result`, a value still `running` is settled from it: Pi writes the result of a stopped call
 * from the last running details, so a settled `running` reads as `cancelled` (or `failed` with the result's text when it is not
 * an abort), with the duration up to the result.
 */
export function parseDelegateDetails(value: unknown, result?: Pick<ToolResultMessage, 'isError' | 'timestamp' | 'content'>): SubagentDetails | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record['kind'] !== DELEGATE_DETAILS_KIND || record['version'] !== 1) return undefined;
  const { agent, conversationId, status } = record;
  const tokens = record['tokens'] !== null && typeof record['tokens'] === 'object' ? record['tokens'] as Record<string, unknown> : {};
  const startedAt = count(record['startedAt']), durationMs = count(record['durationMs']), toolCalls = count(record['toolCalls']);
  const input = count(tokens['input']), output = count(tokens['output']);
  if (typeof agent !== 'string' || count(conversationId) === undefined || typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)
    || startedAt === undefined || durationMs === undefined || toolCalls === undefined || input === undefined || output === undefined) return undefined;
  const error = typeof record['error'] === 'string' && record['error'] ? record['error'] : undefined;
  const details: SubagentDetails = { agent, conversationId: conversationId as number, status: status as SubagentStatus, startedAt, durationMs, toolCalls, tokens: { input, output }, ...(error ? { error } : {}) };
  if (!result || details.status !== 'running') return details;
  const text = result.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n').trim();
  const ended = Math.max(details.durationMs, typeof result.timestamp === 'number' ? result.timestamp - details.startedAt : 0);
  if (!result.isError) return { ...details, status: 'done', durationMs: ended };
  return /\babort/i.test(text) || !text ? { ...details, status: 'cancelled', durationMs: ended } : { ...details, status: 'failed', durationMs: ended, error: text };
}

/** `42 s`, `3 min 5 s`, `1 h 2 min` (under a second: `0.4 s`). */
const span = (ms: number): string => {
  if (ms < 1000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${seconds % 60 ? ` ${seconds % 60} s` : ''}`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
};
const compact = (value: number): string => value < 1000 ? String(value) : value < 1_000_000 ? `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k` : `${(value / 1_000_000).toFixed(1)}M`;

/**
 * A sub-agent (`delegate`) call as a card: the child agent, its status, the time it has run, its tool calls and tokens, and the
 * child conversation's id; the error when it failed. The chat renders it for any tool call whose details are `DelegateDetails`,
 * live while the child runs. `onOpen(conversationId)` makes the id a button that opens the child conversation.
 */
export function SubagentCard({ details, onOpen, now: clock = Date.now }: {
  readonly details: SubagentDetails;
  readonly onOpen?: ((conversationId: number) => void) | undefined;
  /** Test seam: the clock of the elapsed time. */
  readonly now?: () => number;
}) {
  const { labels } = useChatText();
  const running = details.status === 'running';
  const [now, setNow] = useState(clock);
  useEffect(() => {
    if (!running) return;
    setNow(clock());
    const timer = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(timer);
  }, [running, clock]);
  const elapsed = running ? Math.max(details.durationMs, now - details.startedAt) : details.durationMs;
  const conversation = labels.subagentConversation(details.conversationId);
  return <Item variant="outline" size="sm" render={<section />} data-testid="subagent-card" data-state={details.status} data-conversation-id={details.conversationId}
    aria-label={details.agent} aria-busy={running} className="my-2 text-start">
    <ItemMedia variant="icon">
      {running ? <Spinner data-testid="subagent-spinner" aria-label={labels.subagentStatus('running')} />
        : details.status === 'done' ? <CheckIcon aria-hidden="true" /> : details.status === 'failed' ? <CircleAlertIcon aria-hidden="true" /> : <CircleSlashIcon aria-hidden="true" />}
    </ItemMedia>
    <ItemContent className="min-w-0 basis-0">
      <ItemTitle className="line-clamp-none [overflow-wrap:anywhere]"><BotIcon aria-hidden="true" className="size-4 text-muted-foreground" />{details.agent}</ItemTitle>
      <ItemDescription className="line-clamp-none flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
        <Badge data-testid="subagent-status" variant={details.status === 'failed' ? 'destructive' : details.status === 'done' ? 'secondary' : 'outline'}>{labels.subagentStatus(details.status)}</Badge>
        <span data-testid="subagent-time" className="inline-flex items-center gap-1" title={labels.subagentTime} aria-label={`${labels.subagentTime}: ${span(elapsed)}`}><ClockIcon aria-hidden="true" className="size-3.5" />{span(elapsed)}</span>
        <span data-testid="subagent-tool-calls" data-count={details.toolCalls} className="inline-flex items-center gap-1" title={labels.subagentToolCalls(details.toolCalls)} aria-label={labels.subagentToolCalls(details.toolCalls)}><WrenchIcon aria-hidden="true" className="size-3.5" />{details.toolCalls}</span>
        <span data-testid="subagent-tokens" className="inline-flex items-center gap-1" title={labels.subagentTokens(details.tokens.input, details.tokens.output)} aria-label={labels.subagentTokens(details.tokens.input, details.tokens.output)}>
          <ArrowUpIcon aria-hidden="true" className="size-3.5" />{compact(details.tokens.input)}<ArrowDownIcon aria-hidden="true" className="size-3.5" />{compact(details.tokens.output)}
        </span>
        {onOpen
          ? <Button variant="link" size="xs" data-testid="subagent-open" title={conversation} aria-label={conversation} onClick={() => onOpen(details.conversationId)}>#{details.conversationId}</Button>
          : <span data-testid="subagent-conversation" className="font-mono text-xs" title={conversation}>#{details.conversationId}</span>}
      </ItemDescription>
    </ItemContent>
    {details.status === 'failed' && details.error && <ItemFooter className="flex-col items-stretch">
      <Alert variant="destructive" data-testid="subagent-error"><AlertDescription className="[overflow-wrap:anywhere]">{details.error}</AlertDescription></Alert>
    </ItemFooter>}
  </Item>;
}
