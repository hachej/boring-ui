import { useMemo, useState } from 'react';
import type { MarkdownProposal } from './markdown.js';

type DiffLine = { readonly kind: 'same' | 'add' | 'remove'; readonly value: string };
type Fold = { readonly kind: 'fold'; readonly index: number; readonly lines: readonly DiffLine[] };
type Review = { readonly lines: readonly DiffLine[]; readonly fallback: boolean };

const maxMatrixCells = 250_000;
const contextLines = 2;

function lineAt(values: readonly string[], index: number): string {
  const value = values[index];
  if (value === undefined) throw new RangeError('Line index is outside the comparison');
  return value;
}

function scoreAt(values: Uint32Array, index: number): number {
  const value = values[index];
  if (value === undefined) throw new RangeError('Comparison index is outside the matrix');
  return value;
}

function lines(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      result.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) result.push(text.slice(start));
  return result;
}

function review(before: string, after: string): Review {
  const left = lines(before), right = lines(after);
  let start = 0, endLeft = left.length, endRight = right.length;
  while (start < endLeft && start < endRight && left[start] === right[start]) start++;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft--;
    endRight--;
  }
  const result: DiffLine[] = left.slice(0, start).map(value => ({ kind: 'same', value }));
  const middleLeft = endLeft - start, middleRight = endRight - start;
  const fallback = middleLeft > 0 && middleRight > 0 && middleLeft + 1 > Math.floor(maxMatrixCells / (middleRight + 1));
  if (fallback || middleLeft === 0 || middleRight === 0) {
    for (let index = start; index < endLeft; index++) result.push({ kind: 'remove', value: lineAt(left, index) });
    for (let index = start; index < endRight; index++) result.push({ kind: 'add', value: lineAt(right, index) });
  } else {
    const width = middleRight + 1;
    const matches = new Uint32Array((middleLeft + 1) * width);
    for (let leftIndex = middleLeft - 1; leftIndex >= 0; leftIndex--) {
      for (let rightIndex = middleRight - 1; rightIndex >= 0; rightIndex--) {
        const offset = leftIndex * width + rightIndex;
        matches[offset] = lineAt(left, start + leftIndex) === lineAt(right, start + rightIndex)
          ? scoreAt(matches, offset + width + 1) + 1
          : Math.max(scoreAt(matches, offset + width), scoreAt(matches, offset + 1));
      }
    }
    let leftIndex = 0, rightIndex = 0;
    while (leftIndex < middleLeft || rightIndex < middleRight) {
      if (leftIndex < middleLeft && rightIndex < middleRight && lineAt(left, start + leftIndex) === lineAt(right, start + rightIndex)) {
        result.push({ kind: 'same', value: lineAt(left, start + leftIndex) });
        leftIndex++;
        rightIndex++;
      } else if (leftIndex < middleLeft && (rightIndex === middleRight
        || scoreAt(matches, (leftIndex + 1) * width + rightIndex) >= scoreAt(matches, leftIndex * width + rightIndex + 1))) {
        result.push({ kind: 'remove', value: lineAt(left, start + leftIndex) });
        leftIndex++;
      } else {
        result.push({ kind: 'add', value: lineAt(right, start + rightIndex) });
        rightIndex++;
      }
    }
  }
  for (let index = endLeft; index < left.length; index++) result.push({ kind: 'same', value: lineAt(left, index) });
  return { lines: result, fallback };
}

function entries(diff: readonly DiffLine[]): readonly (DiffLine | Fold)[] {
  const visible = new Set<number>();
  for (let index = 0; index < diff.length; index++) {
    if (diff[index]?.kind === 'same') continue;
    for (let nearby = Math.max(0, index - contextLines); nearby <= Math.min(diff.length - 1, index + contextLines); nearby++) visible.add(nearby);
  }
  const result: (DiffLine | Fold)[] = [];
  for (let index = 0; index < diff.length;) {
    const line = diff[index];
    if (line?.kind !== 'same' || visible.has(index)) {
      if (line) result.push(line);
      index++;
      continue;
    }
    const start = index;
    while (index < diff.length && diff[index]?.kind === 'same' && !visible.has(index)) index++;
    result.push({ kind: 'fold', index: start, lines: diff.slice(start, index) });
  }
  return result;
}

function DiffRow({ line }: { readonly line: DiffLine }) {
  const terminated = line.value.endsWith('\n');
  const display = terminated ? line.value.slice(0, -1) : line.value;
  return <div data-diff={line.kind} data-line-ending={terminated ? 'lf' : 'none'}>
    <span>{line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}</span>
    <span data-diff-text="">{display}</span>
    {line.kind !== 'same' && line.value.endsWith('\r\n') && <span data-diff-crlf=""> CRLF line ending</span>}
    {!terminated && <span data-diff-no-newline=""> No newline at end</span>}
  </div>;
}

export function MarkdownProposalDiff({ proposal }: { readonly proposal: MarkdownProposal }) {
  const diff = useMemo(() => review(proposal.before, proposal.after), [proposal.before, proposal.after]);
  const shown = useMemo(() => entries(diff.lines), [diff]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  return <div data-boring="proposal-diff" role="group" aria-label="Proposed line changes">
    {diff.fallback && <p role="status" data-diff-fallback="">Detailed line alignment unavailable; showing changed block.</p>}
    {proposal.before === proposal.after && <p>No text changes</p>}
    <div style={{ overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{shown.map((entry, index) => entry.kind === 'fold' ? <div key={`fold-${entry.index}`}>
      <button type="button" data-diff-fold="" aria-expanded={expanded.has(entry.index)} onClick={() => setExpanded(current => {
        const next = new Set(current);
        if (next.has(entry.index)) next.delete(entry.index);
        else next.add(entry.index);
        return next;
      })}>{expanded.has(entry.index) ? 'Hide' : 'Show'} {entry.lines.length} unchanged lines</button>
      {expanded.has(entry.index) && entry.lines.map((line, lineIndex) => <DiffRow key={lineIndex} line={line} />)}
    </div> : <DiffRow key={`line-${index}`} line={entry} />)}</div>
  </div>;
}
