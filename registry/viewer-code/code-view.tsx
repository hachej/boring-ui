'use client';

import { useMemo } from 'react';
import { cn } from '../utils/utils';
import { tokenLines } from './highlight';
import type { TokenKind } from './highlight';
import type { CodeViewProps } from './svg-view';

const TONE: Readonly<Record<TokenKind, string>> = {
  comment: 'text-muted-foreground italic',
  string: 'text-success-soft-foreground',
  number: 'text-warning-soft-foreground',
  keyword: 'text-info-soft-foreground font-medium',
};

/**
 * A code file read as text, with its comments, strings, numbers and keywords coloured (theme tokens, so light and dark follow the page) and
 * its lines numbered. Display only: the text is rendered as text nodes, never as markup, never evaluated. Long lines wrap on a phone and
 * scroll beside the numbers from `md` up.
 */
export function CodeView({ text, artifact }: CodeViewProps) {
  const language = artifact.title.includes('.') ? artifact.title.split('.').pop()!.toLowerCase() : undefined;
  const lines = useMemo(() => tokenLines(text, language), [text, language]);
  const digits = String(lines.length).length;
  return <div data-testid="artifact-code" data-language={language} className="min-h-0 overflow-x-auto text-xs leading-5">
    <ol className="m-0 min-w-fit list-none p-0">
      {lines.map((line, index) => <li key={index} className="flex">
        <span aria-hidden="true" data-mono-id className="font-mono sticky left-0 shrink-0 select-none bg-card pr-3 text-right text-muted-foreground tabular-nums" style={{ minWidth: `${digits + 1}ch` }}>{index + 1}</span>
        <code className="min-w-0 font-mono break-words whitespace-pre-wrap md:break-normal md:whitespace-pre">{line.length ? line.map((token, at) => token.kind ? <span key={at} className={cn(TONE[token.kind])}>{token.text}</span> : token.text) : '\n'}</code>
      </li>)}
    </ol>
  </div>;
}
