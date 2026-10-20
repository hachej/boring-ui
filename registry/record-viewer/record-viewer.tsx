'use client';

import { useMemo } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Rows3Icon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemGroup } from '@/components/ui/item';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatRecordValue, isRecordsPath, parseRecords, recordValue } from './records';
import type { RecordAction, RecordColumn, RecordRow, RecordStatus, RecordTone } from './records';
import { recordsLabelsFor } from './records-labels';
import type { RecordsLabels, RecordsLocale } from './records-labels';

export { formatRecordValue, isRecordsPath, parseRecords } from './records';
export type { RecordAction, RecordColumn, RecordColumnType, RecordRow, RecordStatus, RecordTone, RecordValue, RecordsFile, RecordsParse } from './records';
export { defaultRecordsLabels, frenchRecordsLabels, recordsLabelsFor } from './records-labels';
export type { RecordsLabels, RecordsLocale } from './records-labels';

const variants = { ok: 'default', warn: 'secondary', error: 'destructive', info: 'outline', neutral: 'secondary' } as const satisfies Record<RecordTone, string>;
function Status({ status }: { readonly status: RecordStatus }) {
  return <Badge data-record-status={status.tone} variant={variants[status.tone]}>{status.label}</Badge>;
}
function NoRecords({ label }: { readonly label: string }) {
  return <Empty><EmptyHeader><EmptyTitle>{label}</EmptyTitle></EmptyHeader></Empty>;
}
interface Words {
  readonly locale?: RecordsLocale | undefined;
  readonly labels?: Partial<RecordsLabels> | undefined;
}
export interface RecordTableProps extends Words {
  readonly columns: readonly RecordColumn[];
  readonly rows: readonly RecordRow[];
  readonly groupBy?: string | undefined;
  readonly onAction?: ((action: RecordAction, row: RecordRow) => void) | undefined;
}

/** Groups retain their first-seen order; the key is the typed raw value, never its rounded display label. */
function groupsOf(rows: readonly RecordRow[], columns: readonly RecordColumn[], groupBy: string | undefined, locale: RecordsLocale | undefined, labels: RecordsLabels) {
  const column = columns.find(column => column.key === groupBy);
  if (!column) return [{ key: '', label: undefined, rows }];
  const groups = new Map<string, { key: string; label: string; rows: RecordRow[] }>();
  for (const row of rows) {
    const value = recordValue(row, column.key), key = JSON.stringify(value !== null && typeof value === 'object' ? [value.tone, value.label] : value);
    let group = groups.get(key);
    if (!group) { group = { key, label: `${column.label}: ${formatRecordValue(value, column.type, locale, labels.missing)}`, rows: [] }; groups.set(key, group); }
    group.rows.push(row);
  }
  return [...groups.values()];
}

/** A typed table of app data. Actions call the host only; their file metadata grants no permission. */
export function RecordTable({ columns, rows, groupBy, onAction, locale, labels: given }: RecordTableProps) {
  const labels = recordsLabelsFor(locale, given);
  const groups = groupsOf(rows, columns, groupBy, locale, labels);
  const actions = rows.some(row => row.actions?.length);
  if (!rows.length) return <NoRecords label={labels.empty} />;
  return <div data-boring="record-table" className="min-w-0 overflow-auto"><Table aria-label={labels.kind}>
    <TableHeader><TableRow>{columns.map(column => <TableHead key={column.key} scope="col" className={column.type === 'number' ? 'text-right' : undefined}>{column.label}</TableHead>)}{actions && <TableHead scope="col">{labels.actions}</TableHead>}</TableRow></TableHeader>
    {groups.map(group => <TableBody key={group.key}>
      {group.label !== undefined && <TableRow><TableHead data-record-group={group.key} scope="rowgroup" colSpan={columns.length + Number(actions)}>{group.label}</TableHead></TableRow>}
      {group.rows.map(row => <TableRow key={row.id} data-record-row={row.id}>{columns.map(column => {
        const value = recordValue(row, column.key);
        return <TableCell key={column.key} className={column.type === 'number' ? 'text-right' : undefined}>{column.type === 'status' && value !== null && typeof value === 'object' ? <Status status={value} /> : formatRecordValue(value, column.type, locale, labels.missing)}</TableCell>;
      })}{actions && <TableCell><div className="flex flex-wrap gap-2">{row.actions?.map(action => <Button key={action.id} variant="outline" className="min-h-11" disabled={!onAction} onClick={() => onAction?.(action, row)}>{action.label}</Button>)}</div></TableCell>}</TableRow>)}
    </TableBody>)}
  </Table></div>;
}

export interface RecordListItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly status?: RecordStatus | undefined;
  readonly action?: RecordAction | undefined;
  /** Extra actions when projecting a row with more than one action into a list. */
  readonly actions?: readonly RecordAction[] | undefined;
}
export interface RecordListProps extends Words {
  readonly items: readonly RecordListItem[];
  readonly onAction?: ((action: RecordAction, item: RecordListItem) => void) | undefined;
}

/** A compact status list. Detail remains wrapping text rather than a line-clamped shadcn description. */
export function RecordList({ items, onAction, locale, labels: given }: RecordListProps) {
  const labels = recordsLabelsFor(locale, given);
  if (!items.length) return <NoRecords label={labels.empty} />;
  return <ItemGroup data-boring="record-list" aria-label={labels.kind}>{items.map(item => {
    const actions = [...(item.action ? [item.action] : []), ...(item.actions ?? [])];
    return <Item key={item.id} role="listitem" data-record-item={item.id} variant="outline" className="min-w-0">
      <ItemContent className="min-w-0"><div className="whitespace-normal wrap-anywhere">{item.title}</div>
        {item.detail && <div className="whitespace-pre-wrap wrap-anywhere">{item.detail}</div>}
        {item.status && <div className="max-w-full overflow-auto"><Status status={item.status} /></div>}
      </ItemContent>
      {!!actions.length && <ItemActions className="max-w-full flex-wrap overflow-auto">{actions.map(action => <Button key={action.id} variant="outline" className="min-h-11" disabled={!onAction} onClick={() => onAction?.(action, item)}>{action.label}</Button>)}</ItemActions>}
    </Item>;
  })}</ItemGroup>;
}

export interface RecordsViewerProps extends Words {
  readonly text: string;
  readonly onAction?: RecordTableProps['onAction'];
}

/** The phone projection preserves every column and action; domain status meaning stays with the app. */
export function RecordsViewer({ text, onAction, locale, labels: given }: RecordsViewerProps) {
  const parsed = useMemo(() => parseRecords(text), [text]);
  const labels = recordsLabelsFor(locale, given);
  if (parsed.kind !== 'ok') return <section data-boring="records-viewer" data-state="invalid" className="flex min-w-0 flex-col gap-3 p-3">
    <Alert data-testid="records-invalid"><AlertTitle>{labels.invalidTitle}</AlertTitle><AlertDescription>{labels.invalidNote}</AlertDescription></Alert>
    <pre data-testid="records-raw" className="overflow-auto whitespace-pre-wrap wrap-anywhere">{text}</pre>
  </section>;
  const { columns, rows, groupBy } = parsed.records;
  const groups = groupsOf(rows, columns, groupBy, locale, labels);
  const first = columns[0]!;
  return <section data-boring="records-viewer" data-state="ok" aria-label={labels.kind} className="min-w-0 p-3">
    <div className="hidden sm:block"><RecordTable columns={columns} rows={rows} groupBy={groupBy} onAction={onAction} locale={locale} labels={given} /></div>
    <div data-testid="records-phone" className="flex flex-col gap-4 sm:hidden">{!rows.length ? <NoRecords label={labels.empty} /> : groups.map(group => {
      const items = group.rows.map(row => ({ id: row.id, title: formatRecordValue(recordValue(row, first.key), first.type, locale, labels.missing),
        detail: columns.slice(1).map(column => `${column.label}: ${formatRecordValue(recordValue(row, column.key), column.type, locale, labels.missing)}`).join('\n'),
        status: columns.filter(column => column.type === 'status').map(column => recordValue(row, column.key)).find((value): value is RecordStatus => value !== null && typeof value === 'object'), actions: row.actions }));
      return <div key={group.key} className="flex min-w-0 flex-col gap-2">{group.label !== undefined && <h3 data-record-list-group={group.key}>{group.label}</h3>}
        <RecordList items={items} locale={locale} labels={given} onAction={onAction ? (action, item) => { const row = group.rows.find(row => row.id === item.id); if (row) onAction(action, row); } : undefined} />
      </div>;
    })}</div>
  </section>;
}

export interface RecordsKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: { readonly text: string }) => ReactNode;
}
export function createRecordsKind(options: Words & { readonly onAction?: RecordTableProps['onAction'] } = {}): RecordsKind {
  return { match: target => isRecordsPath(target.resource.path), label: recordsLabelsFor(options.locale, options.labels).kind, icon: Rows3Icon,
    renderer: ({ text }) => <RecordsViewer text={text} {...options} /> };
}
export const recordsKind: RecordsKind = createRecordsKind();
