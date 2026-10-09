'use client';

import { createElement, Fragment, memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Marked } from 'marked';
import { decodeHTML } from 'entities';
import { CodeBlock } from './code-block';
import { useChatText } from './labels';
import type { ChatLabels } from './labels';

/*
 * Safe Markdown for model output. Tokens are mapped to React elements one by one: raw HTML is shown as text, images are
 * shown as their alt text (nothing is fetched), and a link is only rendered when it is a plain http(s) URL.
 * Ported from the v4 `@hachej/boring-ui-kit` chat markdown renderer; the styling is Tailwind and fenced code gets a code block card.
 */
export interface CommandMention { readonly name: string; readonly behavior: 'execute' | 'insert' }
export interface CommandMentions {
  readonly commands: readonly CommandMention[];
  readonly onActivate: (command: CommandMention) => void;
}

const markdown = new Marked({ gfm: true, breaks: false, pedantic: false });

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function visible(value: unknown): string {
  if (!isRecord(value)) return '';
  if (value['type'] === 'br') return '\n';
  if (Array.isArray(value['tokens'])) return value['tokens'].map(visible).join('');
  const content = text(value['text']);
  return value['type'] === 'text' && value['escaped'] !== true ? decodeHTML(content) : content;
}
function containsHtml(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value['type'] === 'html' || Array.isArray(value['tokens']) && value['tokens'].some(containsHtml);
}
function literal(value: string): ReactNode { return <span className="whitespace-pre-wrap">{value}</span>; }

interface Context { readonly mentions: CommandMentions | undefined; readonly onCopy: ((text: string) => Promise<void>) | undefined; readonly labels: ChatLabels }

function children(value: unknown, context: Context, before = '', after = '', inline = false): ReactNode {
  if (!Array.isArray(value)) return null;
  if (!context.mentions) return value.map((token: unknown, index) => <Fragment key={index}>{renderToken(token, context)}</Fragment>);
  const shown = value.map(visible), source = before + shown.join('') + after;
  const active = inline && value.some(containsHtml) ? { ...context, mentions: undefined } : context;
  let position = before.length;
  return value.map((token: unknown, index) => {
    const start = position;
    position += shown[index]?.length ?? 0;
    return <Fragment key={index}>{renderToken(token, active, source.slice(0, start), source.slice(position))}</Fragment>;
  });
}

const mentionPattern = /(^|[\s(\[{"'“‘])\/([A-Za-z0-9_][A-Za-z0-9_-]*)(?=$|\s|[.,;!?)}\]"'”’]+(?=$|\s))/g;
function mentionText(value: string, mentions: CommandMentions | undefined, before: string, after: string, labels: ChatLabels): ReactNode {
  if (!mentions?.commands.length || !value.includes('/')) return value;
  const commands = new Map(mentions.commands.filter(item => /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(item.name)
    && (item.behavior === 'execute' || item.behavior === 'insert')).map(item => [item.name, item]));
  if (!commands.size) return value;
  const source = before + value + after, start = before.length, end = start + value.length;
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const match of source.matchAll(mentionPattern)) {
    if (match.index === undefined) continue;
    const boundary = match[1] ?? '', name = match[2];
    if (!name) continue;
    const offset = match.index + boundary.length, limit = offset + name.length + 1;
    const command: CommandMention | undefined = commands.get(name);
    if (!command || offset < start || limit > end || offset - start < cursor) continue;
    const selected = { name: command.name, behavior: command.behavior };
    const at = offset - start;
    if (at > cursor) pieces.push(value.slice(cursor, at));
    pieces.push(<button key={at} type="button" data-testid="command-mention" aria-label={labels.runCommand(selected.name, selected.behavior === 'execute')}
      className="cursor-pointer rounded bg-muted px-1 font-mono text-[0.92em] text-foreground hover:bg-accent" onClick={() => mentions.onActivate(selected)}>/{selected.name}</button>);
    cursor = limit - start;
  }
  if (!pieces.length) return value;
  if (cursor < value.length) pieces.push(value.slice(cursor));
  return pieces;
}

function linkTarget(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const decoded = decodeHTML(value);
  if (!/^https?:\/\//i.test(decoded) || /[\u0000- \u007f-\u009f\\]/.test(decoded)) return undefined;
  const authority = /^https?:\/\/([^/?#]*)/i.exec(decoded)?.[1];
  if (!authority || authority.includes('@')) return undefined;
  try {
    const url = new URL(decoded);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

function cells(value: unknown, header: boolean, context: Context): ReactNode {
  if (!Array.isArray(value)) return null;
  return value.map((cell: unknown, index) => {
    if (!isRecord(cell)) return null;
    const alignment = cell['align'];
    const textAlign = alignment === 'left' || alignment === 'center' || alignment === 'right' ? alignment : undefined;
    return createElement(header ? 'th' : 'td', { key: index, style: { textAlign }, className: header ? 'px-3 py-1.5 font-semibold' : 'px-3 py-1.5', ...(header ? { scope: 'col' } : {}) },
      children(cell['tokens'], context, '', '', true));
  });
}

const HEADINGS: Record<number, string> = {
  1: 'mt-6 mb-2 text-xl font-semibold tracking-tight', 2: 'mt-5 mb-2 text-base font-semibold tracking-tight', 3: 'mt-4 mb-1.5 text-[0.9375rem] font-semibold',
  4: 'mt-4 mb-1 text-sm font-semibold', 5: 'mt-3 mb-1 text-sm font-medium', 6: 'mt-3 mb-1 text-sm font-medium text-muted-foreground',
};

// Marked's extension token includes arbitrary fields. Narrow those fields here before creating React nodes.
function renderToken(value: unknown, context: Context, before = '', after = ''): ReactNode {
  if (!isRecord(value)) return null;
  const raw = text(value['raw']), content = text(value['text']), mentions = context.mentions;
  switch (value['type']) {
    case 'space': case 'def': return null;
    case 'paragraph': return <p className="my-3 first:mt-0 last:mb-0">{children(value['tokens'], context, '', '', true)}</p>;
    case 'heading': {
      const depth = value['depth'];
      return typeof depth === 'number' && Number.isInteger(depth) && depth >= 1 && depth <= 6
        ? createElement(`h${depth}`, { className: `${HEADINGS[depth]} first:mt-0` }, children(value['tokens'], context, '', '', true)) : literal(raw);
    }
    case 'text': return Array.isArray(value['tokens']) ? children(value['tokens'], context, before, after, true)
      : value['escaped'] === true ? literal(content) : mentionText(decodeHTML(content), mentions, before, after, context.labels);
    case 'escape': return content;
    case 'strong': return <strong className="font-semibold text-foreground">{children(value['tokens'], context, before, after, true)}</strong>;
    case 'em': return <em>{children(value['tokens'], context, before, after, true)}</em>;
    case 'del': return <del className="text-muted-foreground">{children(value['tokens'], context, before, after, true)}</del>;
    case 'blockquote': return <blockquote className="my-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-muted-foreground [&_p]:my-1">{children(value['tokens'], context)}</blockquote>;
    case 'br': return <br />;
    case 'hr': return <hr className="my-5 border-border" />;
    case 'codespan': return <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] whitespace-pre-wrap">{content}</code>;
    case 'code': return <CodeBlock code={content} {...(typeof value['lang'] === 'string' && value['lang'] ? { language: value['lang'] } : {})} {...(context.onCopy ? { onCopy: context.onCopy } : {})} />;
    case 'html': return value['block'] === true ? <pre className="my-3 overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">{raw}</pre> : literal(raw);
    case 'image': return literal(decodeHTML(content) || raw);
    case 'link': {
      const href = linkTarget(value['href']), title = typeof value['title'] === 'string' ? decodeHTML(value['title']) : undefined;
      return href ? <a href={href} title={title} target="_blank" rel="noopener noreferrer"
        className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground">{children(value['tokens'], context)}</a> : children(value['tokens'], context);
    }
    case 'list': {
      const start = value['start'];
      return value['ordered'] === true
        ? <ol start={typeof start === 'number' && Number.isSafeInteger(start) ? start : undefined} className="my-3 list-decimal ps-6 marker:text-muted-foreground">{children(value['items'], context)}</ol>
        : <ul className="my-3 list-disc ps-6 marker:text-muted-foreground">{children(value['items'], context)}</ul>;
    }
    case 'list_item': return <li className="ps-1 [&+li]:mt-1 [&>p]:my-1 [&>ol]:my-1 [&>ul]:my-1">{children(value['tokens'], context, '', '', true)}</li>;
    case 'checkbox': return <input type="checkbox" checked={value['checked'] === true} disabled readOnly aria-label={context.labels.taskStatus} className="me-1.5 align-middle accent-foreground" />;
    case 'table': return <div className="my-3 overflow-x-auto rounded-lg border border-border"><table className="w-full border-collapse text-left tabular-nums">
      <thead className="bg-muted/50">{<tr>{cells(value['header'], true, context)}</tr>}</thead>
      <tbody className="[&_tr]:border-t [&_tr]:border-border">{Array.isArray(value['rows']) ? value['rows'].map((row: unknown, index) => <tr key={index}>{cells(row, false, context)}</tr>) : null}</tbody></table></div>;
    default: return literal(raw);
  }
}

/** One top-level block; unchanged blocks skip re-rendering while a long answer streams. */
const Block = memo(function Block({ token, context }: { readonly token: unknown; readonly context: Context }) {
  return <>{renderToken(token, context)}</>;
}, (a, b) => isRecord(a.token) && isRecord(b.token) && a.token['raw'] === b.token['raw'] && a.token['type'] === b.token['type'] && a.context.mentions === b.context.mentions && a.context.onCopy === b.context.onCopy && a.context.labels === b.context.labels);

export const Markdown = memo(function Markdown({ text: source, commandMentions, onCopy, streaming = false }: {
  readonly text: string; readonly commandMentions?: CommandMentions; readonly onCopy?: (text: string) => Promise<void>; readonly streaming?: boolean;
}) {
  const tokens = useMemo(() => { try { return markdown.lexer(source); } catch { return null; } }, [source]);
  const mentions = source.includes('/') && commandMentions?.commands.length ? commandMentions : undefined;
  const { labels } = useChatText();
  const context = useMemo<Context>(() => ({ mentions, onCopy, labels }), [mentions, onCopy, labels]);
  const body = useMemo(() => {
    if (!tokens) return literal(source);
    // With mentions enabled, positions are relative to the whole text, so render the token list as one unit.
    if (mentions) return children(tokens, context);
    return tokens.map((token, index) => <Block key={index} token={token} context={context} />);
  }, [tokens, source, mentions, context]);
  return <div data-testid="message-text" data-streaming={streaming ? 'true' : undefined} className="min-w-0 text-[0.9375rem] leading-[1.65] [overflow-wrap:anywhere]">
    {body}
  </div>;
});
