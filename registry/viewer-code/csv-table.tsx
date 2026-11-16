'use client';

import { useContext } from 'react';
import { AtIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RowReferenceContext, columnNames } from './row-reference';
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

/** A CSV artifact as a table: the first row is the header. Inside a `RowReferenceContext` each row has an « @ » action that references it in the assistant. */
export function CsvView({ text }: CodeViewProps) {
  const [head = [], ...rows] = csvRows(text);
  const target = useContext(RowReferenceContext);
  const names = columnNames(head);
  return <Table data-testid="artifact-csv">
    <TableHeader><TableRow>{head.map((cell, i) => <TableHead key={i}>{cell}</TableHead>)}{target && <TableHead className="w-10"><span className="sr-only">{target.label}</span></TableHead>}</TableRow></TableHeader>
    <TableBody>{rows.map((row, i) => <TableRow key={i} className="group/row" data-row={i + 1}>
      {row.map((cell, j) => <TableCell key={j} className="align-top">{cell}</TableCell>)}
      {target && <TableCell className="align-middle">
        <Button type="button" variant="ghost" size="icon-sm" data-testid="csv-row-reference" aria-label={`${target.label} ${i + 1}`}
          className="pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 focus-visible:opacity-100"
          onClick={() => target.reference({ path: target.path, row: i + 1, cells: Object.fromEntries(names.map((name, j) => [name, row[j] ?? ''])) })}><AtIcon aria-hidden="true" /></Button>
      </TableCell>}
    </TableRow>)}</TableBody>
  </Table>;
}
