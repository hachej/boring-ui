'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

/** A CSV artifact as a table: the first row is the header. */
export function CsvView({ text }: CodeViewProps) {
  const [head = [], ...rows] = csvRows(text);
  return <Table data-testid="artifact-csv">
    <TableHeader><TableRow>{head.map((cell, i) => <TableHead key={i}>{cell}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{rows.map((row, i) => <TableRow key={i}>{row.map((cell, j) => <TableCell key={j} className="align-top">{cell}</TableCell>)}</TableRow>)}</TableBody>
  </Table>;
}
