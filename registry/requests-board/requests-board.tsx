'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '../utils/utils';
import { compactRows, filterViews, requestCounts, requestFilters } from './requests';
import type { RequestAction, RequestFilter, RequestView } from './requests';
import { requestsLabelsFor } from './requests-labels';
import type { RequestsLabels, RequestsLocale } from './requests-labels';

export interface RequestsBoardProps {
  readonly views: readonly RequestView[];
  readonly mode: 'compact' | 'full';
  readonly repos?: readonly string[];
  readonly labels?: Partial<RequestsLabels>;
  readonly locale?: RequestsLocale;
  readonly changeToken?: string | number;
  /** Presentation only: the host must authorize every decision again. */
  readonly canApproveRelease?: boolean;
  readonly onOpenAll: () => void;
  readonly onOpen: (number: string) => void;
  readonly onAnswer?: (number: string, answer: string) => void;
  readonly onDecide?: (number: string, decision: 'approve' | 'later') => void;
  readonly onTry?: (number: string, action: RequestAction) => void;
}

/** Host presentation concern: no Pi execution, network, polling or subscription. Only local navigation and drafts live here. */
export function RequestsBoard(props: RequestsBoardProps) {
  const { views, mode, changeToken, onOpen, onOpenAll } = props;
  const labels = requestsLabelsFor(props.locale, props.labels);
  const [filter, setFilter] = useState<RequestFilter>('active');
  const [query, setQuery] = useState('');
  const [repo, setRepo] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const observed = useRef({ token: changeToken, views: views.map(view => ({ number: view.number, state: view.state, line: view.line, since: view.since })) });
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const returning = useRef<string | undefined>(undefined);
  const detail = views.find(view => view.number === selected);
  const shown = mode === 'compact' ? compactRows(views) : filterViews(views, filter, query, repo);
  const counts = requestCounts(views, query, repo);
  useEffect(() => {
    if (Object.is(observed.current.token, changeToken)) return;
    const previous = new Map(observed.current.views.map(view => [view.number, view]));
    const moved = views.filter(view => {
      const before = previous.get(view.number);
      return !before || before.state !== view.state || before.line !== view.line || before.since !== view.since;
    });
    setAnnouncement(moved.map(view => labels.changed(view.number, labels.states[view.state])).join('; '));
    observed.current = { token: changeToken, views: views.map(view => ({ number: view.number, state: view.state, line: view.line, since: view.since })) };
  }, [changeToken, views, labels]);
  useEffect(() => {
    if (detail) heading.current?.focus();
    else if (returning.current !== undefined) {
      (rows.current.get(returning.current) ?? rows.current.values().next().value)?.focus();
      returning.current = undefined;
    }
  }, [detail?.number]);
  const open = (number: string) => { if (mode === 'full') setSelected(number); onOpen(number); };
  const back = () => { returning.current = selected; setSelected(undefined); };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowDown' ? Math.min(shown.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? shown.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault(); rows.current.get(shown[next]!.number)?.focus();
  };
  const list = <ItemGroup aria-label={labels.title} data-testid="requests-list">
    {shown.map((view, index) => <Item key={view.number} role="listitem" variant={selected === view.number ? 'muted' : 'default'}>
      <ItemContent className="min-w-0">
        <Button ref={node => { if (node) rows.current.set(view.number, node); else rows.current.delete(view.number); }} variant="ghost" className="w-full justify-start whitespace-normal text-start"
          data-request={view.number} aria-current={selected === view.number ? 'true' : undefined} onKeyDown={event => navigate(event, index)} onClick={() => open(view.number)}>
          <span>{view.number} · {view.title}</span>
        </Button>
      </ItemContent>
      <Badge variant="secondary">{labels.states[view.state]}</Badge>
    </Item>)}
    {shown.length === 0 && <Empty><EmptyHeader><EmptyTitle>{labels.empty}</EmptyTitle><EmptyDescription>{labels.emptyDescription}</EmptyDescription></EmptyHeader></Empty>}
  </ItemGroup>;
  return <section data-boring="requests-board" data-mode={mode} className="flex h-full min-h-0 min-w-0 flex-col" aria-label={labels.title}>
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="requests-updates">{announcement}</div>
    {mode === 'compact' ? <>{list}<Button variant="link" onClick={onOpenAll}>{labels.openAll(views.length)}</Button></> : <>
      <div className={cn('min-w-0 flex-col gap-3 p-4', detail ? 'hidden md:flex' : 'flex')}>
        <div className="overflow-x-auto"><ToggleGroup value={[filter]} onValueChange={value => { if (value[0]) setFilter(value[0] as RequestFilter); }} aria-label={labels.title} variant="outline">
          {requestFilters.map(value => <ToggleGroupItem key={value} value={value} data-filter={value}>{labels.filters[value]} · {counts[value]}</ToggleGroupItem>)}
        </ToggleGroup></div>
        <Input aria-label={labels.search} placeholder={labels.search} value={query} onChange={event => setQuery(event.currentTarget.value)} />
        {!!props.repos?.length && <div className="overflow-x-auto"><ToggleGroup variant="outline" aria-label={labels.repositories} value={[repo === undefined ? 'all' : `repo:${repo}`]} onValueChange={value => setRepo(value[0]?.startsWith('repo:') ? value[0].slice(5) : undefined)}>
          <ToggleGroupItem value="all">{labels.allRepos}</ToggleGroupItem>
          {props.repos.map(value => <ToggleGroupItem value={`repo:${value}`} key={value}>{value}</ToggleGroupItem>)}
        </ToggleGroup></div>}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div data-testid="requests-list-pane" className={cn('min-h-0 w-full shrink-0 overflow-y-auto overscroll-contain md:w-80', detail ? 'hidden md:block' : 'block')}>{list}</div>
        <div data-testid="requests-detail-pane" className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4', detail ? 'block' : 'hidden md:block')}>
          {detail ? <>
            <div className="mb-4 md:hidden"><Button variant="ghost" onClick={back}>{labels.back}</Button></div>
            <h2 ref={heading} tabIndex={-1} className="m-0 mb-4 break-words">{detail.number} · {detail.title}</h2>
            <RequestDetail key={detail.number} view={detail} labels={labels} canApproveRelease={props.canApproveRelease ?? false} onOpen={open} onAnswer={props.onAnswer} onDecide={props.onDecide} onTry={props.onTry} />
          </> : <Empty><EmptyHeader><EmptyTitle>{labels.choose}</EmptyTitle></EmptyHeader></Empty>}
        </div>
      </div>
    </>}
  </section>;
}

function RequestDetail({ view, labels, canApproveRelease, onOpen, onAnswer, onDecide, onTry }: {
  readonly view: RequestView; readonly labels: RequestsLabels; readonly canApproveRelease: boolean;
  readonly onOpen: (number: string) => void;
  readonly onAnswer: RequestsBoardProps['onAnswer']; readonly onDecide: RequestsBoardProps['onDecide']; readonly onTry: RequestsBoardProps['onTry'];
}) {
  const question = view.question && (view.question.kind !== 'release' || canApproveRelease) ? view.question : undefined;
  return <div className="flex min-w-0 flex-col gap-4">
    <Item variant="outline"><ItemContent className="min-w-0"><ItemTitle><Badge variant="secondary">{labels.states[view.state]}</Badge></ItemTitle>
      <ItemDescription>{view.line}</ItemDescription><ItemDescription>{labels.since} <time dateTime={view.since}>{view.since}</time>{view.waitsOn && ` · ${labels.waitsOn} ${view.waitsOn}`}</ItemDescription>
      {view.repo && <ItemDescription>{view.repo}</ItemDescription>}
      {view.master && <ItemDescription>{labels.master} · {view.master}</ItemDescription>}
    </ItemContent></Item>
    {view.action && <div><Button disabled={!onTry} onClick={() => { if (view.action) onTry?.(view.number, view.action); }}>{labels.tryVersion}</Button></div>}
    {question && <Question key={`${question.kind}:${question.text}`} view={view} labels={labels} onAnswer={onAnswer} onDecide={onDecide} />}
    <Card><CardHeader><CardTitle>{labels.history}</CardTitle></CardHeader><CardContent>
      <ItemGroup>{view.history.map((event, index) => <Item key={index} role="listitem"><ItemContent><ItemTitle>{event.text}</ItemTitle><ItemDescription><time dateTime={event.at}>{event.at}</time></ItemDescription></ItemContent></Item>)}</ItemGroup>
    </CardContent></Card>
    {view.links.length > 0 && <Card><CardHeader><CardTitle>{labels.related}</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">
      {view.links.map(link => <Button variant="link" key={`${link.kind}:${link.number}`} onClick={() => onOpen(link.number)}>{labels.links[link.kind]} · {link.number}</Button>)}
    </CardContent></Card>}
  </div>;
}
function Question({ view, labels, onAnswer, onDecide }: { readonly view: RequestView; readonly labels: RequestsLabels; readonly onAnswer: RequestsBoardProps['onAnswer']; readonly onDecide: RequestsBoardProps['onDecide'] }) {
  const [text, setText] = useState('');
  return <Card data-testid="request-question"><CardHeader><CardDescription>{labels.states.question}</CardDescription><CardTitle>{view.question!.text}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-3">
      {view.question!.kind === 'answer' ? <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); if (text.trim()) onAnswer?.(view.number, text.trim()); }}>
        <Textarea aria-label={labels.yourAnswer} value={text} disabled={!onAnswer} onChange={event => setText(event.currentTarget.value)} />
        <div><Button type="submit" disabled={!onAnswer || !text.trim()}>{labels.answer}</Button></div>
      </form> : <div><Button disabled={!onDecide} onClick={() => onDecide?.(view.number, 'approve')}>{labels.approve}</Button></div>}
      <div><Button variant="outline" disabled={!onDecide} onClick={() => onDecide?.(view.number, 'later')}>{labels.later}</Button></div>
    </CardContent>
  </Card>;
}
