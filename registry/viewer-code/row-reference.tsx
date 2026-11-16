'use client';

import { createContext } from 'react';
import { AtIcon } from '../_shared/icons';
import type { MentionKind } from '../pi-chat/config';

/** One row of a table file, as the assistant receives it: the file, the row's number (the first row under the header is 1) and its cells by column. */
export interface RowReference {
  readonly path: string;
  readonly row: number;
  readonly cells: Readonly<Record<string, string>>;
}

/** What a table view needs to offer "reference this row": where the file is, the action's words and what a choice does. Absent: the table has no action. */
export interface RowReferenceTarget {
  readonly path: string;
  readonly label: string;
  readonly reference: (row: RowReference) => void;
}
export const RowReferenceContext = createContext<RowReferenceTarget | null>(null);

/** The mention prefix of a row reference: `@row:<path>#<row> <cells as JSON>` (a value with spaces is written in quotes, as any mention is). */
export const ROW_MENTION = 'row';
const VALUE = /^(.+?)#(\d+) (\{.*\})$/s;

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

/** The mention's value, without its `row:` prefix: what `MentionKind.label` receives and what the assistant parses back. */
export const rowReferenceValue = ({ path, row, cells }: RowReference): string => `${path}#${row} ${JSON.stringify(cells)}`;
/** The `@` mention text for a row reference, prefix included, ready for `mentionToken`. */
export const rowMentionPath = (reference: RowReference): string => `${ROW_MENTION}:${rowReferenceValue(reference)}`;

/** The reference a mention value (without its prefix) stands for; undefined when it is not a well-formed row reference. */
export function parseRowReference(value: string): RowReference | undefined {
  const match = VALUE.exec(value);
  if (!match) return undefined;
  try {
    const cells = JSON.parse(match[3]!) as unknown;
    if (typeof cells !== 'object' || cells === null || Array.isArray(cells) || !Object.values(cells).every(cell => typeof cell === 'string')) return undefined;
    return { path: match[1]!, row: Number(match[2]), cells: cells as Record<string, string> };
  } catch { return undefined; }
}

/** The chip's short words: « open-gaps.csv row 3: Card Harbor Garage, Jan 09 ». */
export function rowReferenceLabel(value: string): string {
  const reference = parseRowReference(value);
  if (!reference) return value;
  const file = reference.path.split('/').at(-1) ?? reference.path;
  const first = Object.values(reference.cells).filter(cell => cell.trim() !== '').slice(0, 2).join(', ');
  return `${file} row ${reference.row}${first ? `: ${first}` : ''}`;
}

/** The composer's chip and the sent message's mention for a row reference. The shell adds it to an app's `mentions.kinds` as `row`. */
export const rowMentionKind: MentionKind = {
  label: rowReferenceLabel,
  icon: <AtIcon className="size-4" aria-hidden="true" />,
};
