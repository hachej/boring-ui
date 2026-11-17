'use client';

import { useContext, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { AtIcon, CheckIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RowReferenceContext, columnNames, rowKey } from './row-reference';
import type { TableRow as TableRowData } from './row-reference';
import type { CodeViewProps } from './svg-view';

/** Rows of a CSV text (comma or semicolon separated, double-quoted cells with `""` escapes), at most 2000. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length && rows.length < 2000; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if ((cell || row.length) && rows.length < 2000) { row.push(cell); rows.push(row); }
  return rows;
}

const LONG_PRESS_MS = 500;
const INTERACTIVE = 'button, [role=checkbox], input, a';

/**
 * A CSV artifact as a table: the first row is the header. Inside a `RowReferenceContext` each row has an « @ » action that references it in the assistant
 * (a tooltip on hover and focus, « Referenced » once it is in the field), and rows can be selected together (a checkbox on hover or focus, Shift or Ctrl and
 * Cmd click, a long press on touch, or a plain click once one is checked) to reference them with one action.
 */
export function CsvView({ text }: CodeViewProps) {
  const [head = [], ...rows] = csvRows(text);
  const target = useContext(RowReferenceContext);
  const names = columnNames(head);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const anchor = useRef(0), press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | undefined>(undefined);
  const data = (at: number): TableRowData => ({ row: at + 1, cells: Object.fromEntries(names.map((name, j) => [name, rows[at]?.[j] ?? ''])) });
  const toggle = (at: number, on?: boolean) => setSelected(current => { const next = new Set(current); if (on ?? !next.has(at)) next.add(at); else next.delete(at); return next; });
  const choose = (event: MouseEvent, at: number) => {
    if ((event.target as Element).closest(INTERACTIVE)) return;
    if (event.shiftKey && selected.size > 0) {
      const [from, to] = [Math.min(anchor.current, at), Math.max(anchor.current, at)];
      setSelected(current => new Set([...current, ...Array.from({ length: to - from + 1 }, (_, k) => from + k)]));
    } else if (event.shiftKey || event.ctrlKey || event.metaKey || selected.size > 0) { toggle(at); anchor.current = at; }
  };
  const startPress = (event: PointerEvent, at: number) => {
    if (event.pointerType !== 'touch' || (event.target as Element).closest(INTERACTIVE)) return;
    const timer = setTimeout(() => { if (press.current) press.current.fired = true; toggle(at); anchor.current = at; }, LONG_PRESS_MS);
    press.current = { timer, fired: false };
  };
  const endPress = () => { if (press.current) clearTimeout(press.current.timer); };
  const count = selected.size;
  return <div data-testid="artifact-csv-view" className="relative">
    <Table data-testid="artifact-csv">
      <TableHeader><TableRow>
        {target && <TableHead className="w-8"><span className="sr-only">{target.words.selectRow}</span></TableHead>}
        {head.map((cell, i) => <TableHead key={i}>{cell}</TableHead>)}
        {target && <TableHead className="w-10"><span className="sr-only">{target.words.reference}</span></TableHead>}
      </TableRow></TableHeader>
      <TableBody>{rows.map((row, i) => {
        const done = target?.referenced.has(rowKey(target.path, i + 1)) ?? false;
        return <TableRow key={i} className="group/row" data-row={i + 1} data-selected={selected.has(i) || undefined}
          onClick={target ? event => choose(event, i) : undefined} onPointerDown={target ? event => startPress(event, i) : undefined}
          onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress} onContextMenu={target ? event => { if (press.current?.fired) { event.preventDefault(); press.current.fired = false; } } : undefined}>
          {target && <TableCell className="align-middle">
            <span className={count > 0 ? undefined : 'pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 max-md:hidden pointer-coarse:hidden'}>
              <Checkbox data-testid="csv-row-select" aria-label={`${target.words.selectRow} ${i + 1}`} checked={selected.has(i)} onCheckedChange={on => { toggle(i, on); anchor.current = i; }} />
            </span>
          </TableCell>}
          {row.map((cell, j) => <TableCell key={j} className="align-top">{cell}</TableCell>)}
          {target && <TableCell className="align-middle">
            <Tooltip>
              <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" data-testid="csv-row-reference" data-referenced={done || undefined} aria-pressed={done}
                aria-label={`${done ? target.words.referenced : target.words.reference} ${i + 1}`}
                className="pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[referenced]:opacity-100"
                onClick={() => { if (!done) target.reference([data(i)]); }} />}>
                {done ? <CheckIcon aria-hidden="true" /> : <AtIcon aria-hidden="true" />}
              </TooltipTrigger>
              <TooltipContent side="top">{done ? target.words.referenced : target.words.reference}</TooltipContent>
            </Tooltip>
          </TableCell>}
        </TableRow>;
      })}</TableBody>
    </Table>
    {target && count > 0 && <div role="toolbar" data-testid="csv-selection-bar" className="sticky bottom-0 flex items-center gap-2 bg-muted p-2">
      <Button type="button" size="sm" data-testid="csv-reference-selected"
        onClick={() => { target.reference([...selected].sort((a, b) => a - b).map(data)); setSelected(new Set()); }}>{target.words.referenceRows.replace('{n}', String(count))}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>{target.words.clearSelection}</Button>
    </div>}
  </div>;
}
