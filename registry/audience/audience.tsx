'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { audienceLabelsFor } from './audience-labels';
import type { AudienceLabels, AudienceLocale } from './audience-labels';
import { dayRows, outreachShare, refRows, usageOf } from './audience-model';
import type { AccessRequestRow, AudienceData } from './audience-model';

export interface AudienceRequests {
  readonly items: readonly AccessRequestRow[];
  readonly onGrant: (email: string) => void;
  readonly onDismiss: (email: string) => void;
}

export interface AudienceProps {
  /** Null while loading. */
  readonly data: AudienceData | null;
  readonly error?: boolean;
  /** Access requests with their actions; absent: the screen says they are handled in the hub. */
  readonly requests?: AudienceRequests;
  readonly labels?: Partial<AudienceLabels>;
  readonly locale?: AudienceLocale;
  readonly onRetry?: () => void;
}

interface BarRow { readonly key: string; readonly name: string; readonly visits: number; readonly share: number }

/** A name, a bar against the busiest row, and the count. */
function BarTable({ head, rows, labels }: { head: string; rows: readonly BarRow[]; labels: AudienceLabels }) {
  return <Table>
    <TableHeader>
      <TableRow>
        <TableHead>{head}</TableHead>
        <TableHead className="w-1/2"><span className="sr-only">{labels.visits}</span></TableHead>
        <TableHead className="text-end">{labels.visits}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row) => <TableRow key={row.key}>
        <TableCell>{row.name}</TableCell>
        <TableCell><Progress value={row.share} aria-label={`${row.name}: ${row.visits}`} /></TableCell>
        <TableCell className="text-end tabular-nums">{row.visits}</TableCell>
      </TableRow>)}
    </TableBody>
  </Table>;
}

function Placeholder({ title, description }: { title: string; description: string }) {
  return <Empty><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>;
}

function Visits({ data, labels }: { data: AudienceData; labels: AudienceLabels }) {
  if (!data.landing) return <Placeholder title={labels.visitsTitle} description={labels.unavailable} />;
  if (!data.landing.total) return <Placeholder title={labels.noVisits} description={labels.noVisitsDescription} />;
  const rows = dayRows(data.landing, 14).map((d) => ({ key: d.day, name: labels.formatDay(d.day), visits: d.visits, share: d.share }));
  return <Card>
    <CardHeader>
      <CardTitle>{labels.visitsTitle} <Badge variant="secondary">{data.landing.total}</Badge></CardTitle>
      <CardDescription>{labels.visitsLast(rows.length)} · {labels.totalsOnly}</CardDescription>
    </CardHeader>
    <CardContent><BarTable head={labels.day} rows={rows} labels={labels} /></CardContent>
  </Card>;
}

function Outreach({ data, labels }: { data: AudienceData; labels: AudienceLabels }) {
  const rows = refRows(data.landing).map((r) => ({ key: r.ref, name: r.ref, visits: r.visits, share: r.share }));
  const hint = rows.length ? labels.outreachShare(outreachShare(data.landing)) : labels.outreachHint;
  return <Card>
    <CardHeader><CardTitle>{labels.outreachTitle}</CardTitle><CardDescription>{hint}</CardDescription></CardHeader>
    <CardContent>
      {rows.length ? <BarTable head={labels.ref} rows={rows} labels={labels} /> : <p className="text-sm text-muted-foreground">{labels.noRefs}</p>}
    </CardContent>
  </Card>;
}

function RequestRow({ item, requests, labels }: { item: AccessRequestRow; requests: AudienceRequests; labels: AudienceLabels }) {
  return <TableRow>
    <TableCell>{item.email}{item.revokedBefore && <> <Badge variant="outline">{labels.revokedBefore}</Badge></>}</TableCell>
    <TableCell className="whitespace-normal">{item.note}</TableCell>
    <TableCell className="text-end">
      <Button size="sm" onClick={() => requests.onGrant(item.email)}>{labels.grant}</Button>{' '}
      <Button size="sm" variant="ghost" onClick={() => requests.onDismiss(item.email)}>{labels.dismiss}</Button>
    </TableCell>
  </TableRow>;
}

function Requests({ requests, labels }: { requests?: AudienceRequests; labels: AudienceLabels }) {
  const count = requests?.items.length ?? 0;
  return <Card>
    <CardHeader>
      <CardTitle>{labels.requestsTitle}{count > 0 && <> <Badge>{count}</Badge></>}</CardTitle>
      {!requests && <CardDescription>{labels.requestsInHub}</CardDescription>}
    </CardHeader>
    {requests && <CardContent>
      {count ? <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.email}</TableHead>
            <TableHead>{labels.note}</TableHead>
            <TableHead><span className="sr-only">{labels.grant}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{requests.items.map((item) => <RequestRow key={item.email} item={item} requests={requests} labels={labels} />)}</TableBody>
      </Table> : <p className="text-sm text-muted-foreground">{labels.requestsEmpty}</p>}
    </CardContent>}
  </Card>;
}

function Usage({ data, labels }: { data: AudienceData; labels: AudienceLabels }) {
  const count = (kind: string, name: string) => <TableRow>
    <TableCell>{name}</TableCell>
    <TableCell className="text-end tabular-nums">{usageOf(data.usage, kind)}</TableCell>
  </TableRow>;
  return <Card>
    <CardHeader><CardTitle>{labels.usageTitle}</CardTitle><CardDescription>{data.usage ? labels.usageHint : labels.noUsage}</CardDescription></CardHeader>
    {data.usage && <CardContent><Table><TableBody>{count('sample', labels.sample)}{count('own_file', labels.ownFile)}</TableBody></Table></CardContent>}
  </Card>;
}

/** The Audience screen: presentation only. The app loads `/api/audience` (server/src/audience.ts) and hands the answer in; the host decides who may read it. */
export function Audience(props: AudienceProps) {
  const labels = audienceLabelsFor(props.locale, props.labels);
  const { data, error } = props;
  if (error) {
    return <Empty>
      <EmptyHeader><EmptyTitle>{labels.failed}</EmptyTitle></EmptyHeader>
      {props.onRetry && <Button variant="outline" onClick={props.onRetry}>{labels.retry}</Button>}
    </Empty>;
  }
  if (!data) return <p className="text-sm text-muted-foreground" role="status">{labels.loading}</p>;
  return <section aria-label={labels.title} className="flex flex-col gap-4" data-testid="audience">
    <Visits data={data} labels={labels} />
    <Outreach data={data} labels={labels} />
    <Requests requests={props.requests} labels={labels} />
    <Usage data={data} labels={labels} />
  </section>;
}
