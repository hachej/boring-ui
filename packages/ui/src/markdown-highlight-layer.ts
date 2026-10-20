import type { Editor, JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { finishRichMarkdown } from './markdown-safety.js';
import { captureMarkdownQuote, markdownQuoteResolution, type MarkdownQuoteAnchor, type MarkdownQuoteRange } from './markdown-quote.js';
import type { MarkColour } from './mark-store.js';

export interface MarkdownDecoration { readonly id: string; readonly anchor: MarkdownQuoteAnchor; readonly colour: MarkColour; readonly confirmed?: { readonly source: string; readonly range: MarkdownQuoteRange } }
export type MarkdownQuoteCapture = ReturnType<typeof captureMarkdownQuote>;
const key = new PluginKey('boring-markdown-highlights');
const left = 'BORINGQUOTELEFTBOUNDARY', right = 'BORINGQUOTERIGHTBOUNDARY';

/** The native serializer proves the complete source unchanged after removing two sentinels.
 * If syntax/escaping/normalization changes, there is no source projection. */
export function markdownTextProjection(editor: Editor, source: string): readonly { readonly rich: number; readonly source: MarkdownQuoteRange }[] {
  if (!editor.markdown || source.includes(left) || source.includes(right) || finishRichMarkdown(editor.getMarkdown(), source) !== source) return [];
  const leaves: { position: number; text: string }[] = [];
  editor.state.doc.descendants((node, position) => { if (node.isText && node.text) leaves.push({ position, text: node.text }); });
  return leaves.flatMap((leaf, index) => {
    const json = editor.state.doc.toJSON() as JSONContent;
    let count = 0;
    const insert = (node: JSONContent) => { if (node.type === 'text') { if (count === index) node.text = left + node.text + right; count++; } node.content?.forEach(insert); };
    insert(json);
    const marked = finishRichMarkdown(editor.markdown!.serialize(json), source);
    const start = marked.indexOf(left), end = marked.indexOf(right);
    if (start < 0 || end < start || marked.indexOf(left, start + left.length) !== -1 || marked.indexOf(right, end + right.length) !== -1) return [];
    if (marked.slice(0, start) + marked.slice(start + left.length, end) + marked.slice(end + right.length) !== source
      || marked.slice(start + left.length, end) !== leaf.text) return [];
    return [{ rich: leaf.position, source: { start, end: end - left.length } }];
  });
}
export function captureRichMarkdownQuote(editor: Editor, source: string): MarkdownQuoteCapture {
  const selection = editor.state.selection;
  const mapped = markdownTextProjection(editor, source).find(p => selection.from >= p.rich && selection.to <= p.rich + p.source.end - p.source.start);
  return mapped ? captureMarkdownQuote(source, { start: mapped.source.start + selection.from - mapped.rich, end: mapped.source.start + selection.to - mapped.rich })
    : { kind: 'refused', reason: 'This rich selection has no exact source projection. Select the Markdown source instead.' };
}
export function installMarkdownHighlights(editor: Editor, source: string, marks: readonly MarkdownDecoration[], activate?: (id: string) => void): () => void {
  const doc = editor.state.doc, projection = markdownTextProjection(editor, source), decorations: Decoration[] = [];
  for (const mark of marks) {
    if (!['accent', 'primary', 'muted'].includes(mark.colour)) continue;
    const placed = markdownQuoteResolution.resolve(mark.anchor, source, source);
    const confirmed = mark.confirmed;
    const range = confirmed?.source === source && placed.kind === 'ambiguous'
      && placed.candidates.some(candidate => candidate.start === confirmed.range.start && candidate.end === confirmed.range.end)
      ? confirmed.range : placed.kind === 'exact' || placed.kind === 'moved' ? placed.range : null;
    if (!range) continue;
    for (const leaf of projection) {
      const from = Math.max(leaf.source.start, range.start), to = Math.min(leaf.source.end, range.end);
      if (from < to) decorations.push(Decoration.inline(leaf.rich + from - leaf.source.start, leaf.rich + to - leaf.source.start,
        { 'data-mark-id': mark.id, 'data-mark-colour': mark.colour, role: 'button', tabindex: '0', 'aria-label': mark.anchor.fallback, style: `background-color:var(--${mark.colour});color:var(--${mark.colour}-foreground)` }));
    }
  }
  const activateElement = (event: Event) => {
    const element = event.target as Element | null;
    const id = element?.closest?.('[data-mark-id]')?.getAttribute('data-mark-id');
    if (!id) return false;
    activate?.(id); return true;
  };
  const decorationSet = DecorationSet.create(doc, decorations);
  editor.registerPlugin(new Plugin({ key, props: {
    decorations: state => state.doc === doc ? decorationSet : DecorationSet.empty,
    handleDOMEvents: { click: (_view, event) => activateElement(event), contextmenu: (_view, event) => { if (!activateElement(event)) return false; event.preventDefault(); return true; },
      keydown: (_view, event) => { if (event.key !== 'Enter' && event.key !== ' ') return false; if (!activateElement(event)) return false; event.preventDefault(); return true; } },
  } }));
  return () => { if (!editor.isDestroyed) editor.unregisterPlugin(key); };
}
