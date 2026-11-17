'use client';

import { createContext } from 'react';
import { mentionedPaths } from '@hachej/boring-ui-kit/chat-text';
import { TableIcon } from '../_shared/icons';
import type { MentionKind } from '../pi-chat/config';

/** One row of a table file: its number (the first row under the header is 1) and its cells by column. */
export interface TableRow {
  readonly row: number;
  readonly cells: Readonly<Record<string, string>>;
}

/** What the assistant receives for one mention: a file and the rows of it the person referenced, in the order they were chosen. */
export interface RowReference {
  readonly path: string;
  readonly rows: readonly TableRow[];
}

/** The action's words (the shell's, in the app's language) and what a table view needs to offer « reference in the assistant ». Absent: the table has no action. */
export interface RowReferenceWords {
  readonly reference: string;
  readonly referenced: string;
  /** `{n}` is the number of rows. */
  readonly referenceRows: string;
  readonly selectRow: string;
  readonly clearSelection: string;
}
export interface RowReferenceTarget {
  readonly path: string;
  readonly words: RowReferenceWords;
  /** The `rowKey`s already in the assistant's field: their buttons read as referenced. */
  readonly referenced: ReadonlySet<string>;
  /** Adds the rows to the field, after what is there. */
  readonly reference: (rows: readonly TableRow[]) => void;
}
export const RowReferenceContext = createContext<RowReferenceTarget | null>(null);

/** The mention prefix of a row reference: `@row:<path>#<rows> <cells as JSON>` (a value with spaces is written in quotes, as any mention is). */
export const ROW_MENTION = 'row';
/** More new rows than this go to the field as one grouped chip; up to this many get a chip each. */
export const GROUP_AFTER = 3;
const VALUE = /^(.+?)#(\d+(?:,\d+)*) (\{.*\}|\[.*\])$/s;

export const rowKey = (path: string, row: number): string => `${path}#${row}`;

/** A header row's names, each made unique so two columns called alike keep both cells. */
export function columnNames(head: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return head.map((cell, at) => {
    const name = cell.trim() || `column ${at + 1}`;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

/** The mention's value without its `row:` prefix: the rows' numbers, then the cells (one object for one row, an array of objects, in the same order, for several). */
export const rowReferenceValue = ({ path, rows }: RowReference): string =>
  `${path}#${rows.map(item => item.row).join(',')} ${JSON.stringify(rows.length === 1 ? rows[0]!.cells : rows.map(item => item.cells))}`;
/** The `@` mention text for a row reference, prefix included, ready for `mentionToken`. */
export const rowMentionPath = (reference: RowReference): string => `${ROW_MENTION}:${rowReferenceValue(reference)}`;

const isCells = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(cell => typeof cell === 'string');

/** The reference a mention value (without its prefix) stands for; undefined when it is not a well-formed row reference. */
export function parseRowReference(value: string): RowReference | undefined {
  const match = VALUE.exec(value);
  if (!match) return undefined;
  try {
    const numbers = match[2]!.split(',').map(Number), parsed = JSON.parse(match[3]!) as unknown;
    const all = numbers.length === 1 && isCells(parsed) ? [parsed] : Array.isArray(parsed) && parsed.length === numbers.length && parsed.every(isCells) ? parsed as Record<string, string>[] : undefined;
    return all ? { path: match[1]!, rows: numbers.map((row, at) => ({ row, cells: all[at]! })) } : undefined;
  } catch { return undefined; }
}

/** The `rowKey` of every row the text's `row` mentions cover. */
export function referencedRows(text: string): Set<string> {
  const keys = new Set<string>();
  for (const value of mentionedPaths(text)) {
    const reference = value.startsWith(`${ROW_MENTION}:`) ? parseRowReference(value.slice(ROW_MENTION.length + 1)) : undefined;
    for (const item of reference?.rows ?? []) keys.add(rowKey(reference!.path, item.row));
  }
  return keys;
}

const fileName = (path: string) => path.split('/').at(-1) ?? path;
const filled = (cells: Readonly<Record<string, string>>) => Object.values(cells).filter(cell => cell.trim() !== '');
const rowsBadge = (rows: readonly TableRow[]) => rows.length === 1 ? `row ${rows[0]!.row}` : `rows ${rows.map(item => item.row).join(', ')}`;

/** The chip's identity and summary: « open-gaps.csv » with a « row 3 » badge, then « Card Harbor Garage · Jan 09 · $12.00 » (a group lists each row's first cell). */
export function rowReferenceChip(value: string): { readonly title: string; readonly badge?: string; readonly description?: string } {
  const reference = parseRowReference(value);
  if (!reference) return { title: value };
  const first = reference.rows.length === 1 ? filled(reference.rows[0]!.cells).slice(0, 3).join(' · ') : reference.rows.map(item => filled(item.cells)[0]).filter(Boolean).join(', ');
  return { title: fileName(reference.path), badge: rowsBadge(reference.rows), ...(first ? { description: first } : {}) };
}

/** The words of the mention in a sent message and in a name: « open-gaps.csv row 3: Card Harbor Garage, Jan 09 ». */
export function rowReferenceLabel(value: string): string {
  const reference = parseRowReference(value);
  if (!reference) return value;
  const first = reference.rows.length === 1 ? filled(reference.rows[0]!.cells).slice(0, 2).join(', ') : '';
  return `${fileName(reference.path)} ${rowsBadge(reference.rows)}${first ? `: ${first}` : ''}`;
}

/** The composer's chip and the sent message's mention for a row reference. The shell adds it to an app's `mentions.kinds` as `row`. */
export const rowMentionKind: MentionKind = {
  label: rowReferenceLabel,
  present: rowReferenceChip,
  icon: <TableIcon className="size-4" aria-hidden="true" />,
};
