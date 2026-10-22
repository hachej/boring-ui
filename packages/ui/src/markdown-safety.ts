import { Editor } from '@tiptap/core';
import { createMarkdownExtensions } from './markdown-extensions.js';
import { captureMarkdownSource } from './markdown-source.js';

export type MarkdownRichSafety = { readonly safe: true } | { readonly safe: false; readonly reasons: readonly string[] };

const FENCE = /^ {0,3}(```|~~~)/;

/** Blank-line runs outside fenced code collapse to one blank line, and the ends are trimmed: the only whitespace the rich editor may normalise. */
export function normalizeMarkdownWhitespace(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: string | undefined;
  for (let line of lines) {
    const opened = FENCE.exec(line);
    if (opened && (!fence || opened[1] === fence)) fence = fence ? undefined : opened[1];
    if (!fence && !opened && !/^ {4}|^\t/.test(line) && /^(?:[ \t]*&nbsp;[ \t]*)+$/.test(line)) line = '';
    if (!fence && !opened && line.trim() === '' && out.length > 0 && out[out.length - 1]!.trim() === '') continue;
    out.push(line);
  }
  return out.join('\n').replace(/^\s+/, '').trimEnd();
}

const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])(\s|$)/;
/** A line that starts its own block instead of continuing the paragraph above it. */
const BLOCK_START = /^\s*([-*+]\s|\d{1,9}[.)]\s|#{1,6}(\s|$)|>|\||```|~~~|(\*\s*){3,}$|(-\s*){3,}$|(_\s*){3,}$)/;

/**
 * The comparison form for the round trip: whitespace normalised, and blank lines beside an ATX heading dropped (the serialiser always
 * puts one there, and "# Title" directly above a paragraph means the same document). Blank lines inside fenced code are kept. The
 * indentation of a wrapped line that continues a list item's paragraph is dropped too: it is a lazy continuation line, the same
 * paragraph however far it is indented, and the serialiser writes it unindented. A line that starts a block keeps its indentation, so
 * a change of nesting is still a rewrite. A list may interrupt a paragraph, so the blank line the serialiser puts between a top-level
 * paragraph and the list right under it is dropped; between list items it stays, since it makes the list loose.
 */
function comparableMarkdown(text: string): string {
  const lines = normalizeMarkdownWhitespace(text).split('\n');
  const out: string[] = [];
  let fence: string | undefined;
  let itemParagraph = false, topParagraph = false;
  lines.forEach((line, index) => {
    const opened = FENCE.exec(line);
    if (opened && (!fence || opened[1] === fence)) fence = fence ? undefined : opened[1];
    const blank = line.trim() === '' && !fence && !opened;
    const afterParagraph = topParagraph;
    topParagraph = false;
    if (fence || opened || blank) itemParagraph = false;
    else if (LIST_ITEM.test(line)) itemParagraph = true;
    else if (itemParagraph && !BLOCK_START.test(line)) line = line.trimStart();
    else { itemParagraph = false; topParagraph = !/^\s/.test(line) && !BLOCK_START.test(line); }
    if (blank && (HEADING.test(lines[index - 1] ?? '') || HEADING.test(lines[index + 1] ?? ''))) return;
    if (blank && afterParagraph && LIST_ITEM.test(lines[index + 1] ?? '') && !/^\s/.test(lines[index + 1] ?? '')) return;
    out.push(line);
  });
  return out.join('\n');
}

/** What follows the last visible character, so a rich edit keeps the document's own final newline. */
export function trailingWhitespace(text: string): string { return /\s*$/.exec(text)?.[0] ?? ''; }

/** The text a rich edit publishes: the serialised document, whitespace normalised, with the original's trailing newline. */
export function finishRichMarkdown(serialized: string, previous: string): string {
  const body = normalizeMarkdownWhitespace(serialized);
  return body === '' ? '' : body + (trailingWhitespace(previous) || '');
}

/** Encodings that cannot be represented by a single LF editor view. */
function namedReasons(text: string): string[] {
  const reasons: string[] = [];
  if (/\r(?!\n)/.test(text)) reasons.push('bare carriage returns');
  if (text.includes('\r\n') && /(^|[^\r])\n/.test(text)) reasons.push('mixed line endings');
  if (text.includes('\0')) reasons.push('NUL characters');
  return reasons;
}

const cache = new Map<string, MarkdownRichSafety>();

/**
 * Verifies a native projection and its exact source spans. Unchanged blocks retain their source, and unsupported constructs are
 * inert atoms. The legacy whitespace comparison remains for empty/nbsp-only layout. Without a DOM only encoding can be checked.
 */
export function checkMarkdownRichSafety(text: string): MarkdownRichSafety {
  if (text === '') return { safe: true };
  const known = cache.get(text);
  if (known) return known;
  const reasons = namedReasons(text);
  if (reasons.length === 0 && typeof document !== 'undefined') {
    let editor: Editor | undefined;
    try {
      editor = new Editor({ element: document.createElement('div'), extensions: createMarkdownExtensions({ source: () => text }), content: '' });
      editor.commands.setContent(text.replace(/\r\n/g, '\n'), { contentType: 'markdown', emitUpdate: false });
      if (!captureMarkdownSource(editor, text) && comparableMarkdown(editor.getMarkdown()) !== comparableMarkdown(text)) reasons.push('blocks whose source spans the rich editor cannot retain');
    } catch { reasons.push('content the rich editor cannot read'); }
    finally { editor?.destroy(); }
  }
  const result: MarkdownRichSafety = reasons.length ? { safe: false, reasons } : { safe: true };
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  if (typeof document !== 'undefined') cache.set(text, result);
  return result;
}

export function describeUnsafe(safety: MarkdownRichSafety): string {
  if (safety.safe) return '';
  return `Rich editing is off because this document contains ${safety.reasons.join(', ')}, which it could not keep exactly. You can still edit the Markdown source.`;
}
