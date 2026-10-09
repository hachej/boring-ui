import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import type { Editor, Extensions, JSONContent } from '@tiptap/core';
import { createMarkdownParser } from './markdown-parser.js';

type TextEncoder = (text: string, node: { marks?: readonly unknown[] }, parent: { type?: string } | null) => string;

/**
 * The serialiser HTML-encodes text (`&` becomes `&amp;`), which rewrites ordinary prose such as "Notes & Highlights". The parser
 * here reads text back as plain characters, so only the backslash escapes for Markdown syntax are kept.
 */
const PlainTextMarkdown = Markdown.extend({
  onBeforeCreate() {
    (this.parent as (() => void) | undefined)?.();
    const manager = (this.editor as unknown as { markdown?: { encodeTextForMarkdown: TextEncoder; escapeMarkdownSyntax: (text: string) => string } }).markdown;
    if (!manager) return;
    const encode = manager.encodeTextForMarkdown.bind(manager);
    manager.encodeTextForMarkdown = (text, node, parent) => {
      const encoded = encode(text, node, parent);
      // Code is returned untouched by the original; for other text, replace its entity encoding by the plain characters.
      return encoded === text ? text : manager.escapeMarkdownSyntax(text);
    };
  },
});

type Schema = Editor['schema'];

/**
 * A GFM table keeps the exact text it was written in (unpadded `|a|b|`, `:---:` alignment rows, `_emphasis_`, escaped pipes, empty
 * cells) while its content is unchanged: parsing records the source and the canonical JSON of the rows it produced, and rendering
 * writes the source back when the rows are still identical. An edited table (a cell, a row, a column, an alignment) is rendered by
 * the native serialiser, which writes padded GFM with the column alignments. The source is never rendered into the HTML, so a
 * copied or pasted table is serialised normally.
 */
function createSourceTable(schema: () => Schema | undefined) {
  return Table.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        markdownSource: { default: null, rendered: false, parseHTML: () => null },
      };
    },
    parseMarkdown(token, helpers) {
      const parsed = this.parent!(token, helpers) as JSONContent;
      const current = schema();
      const raw = typeof token.raw === 'string' ? token.raw.replace(/\n+$/, '') : '';
      if (!current || !raw || Array.isArray(parsed)) return parsed;
      try {
        const rows = JSON.stringify(current.nodeFromJSON({ type: 'table', content: parsed.content ?? [] }).toJSON().content ?? []);
        return { ...parsed, attrs: { ...parsed.attrs, markdownSource: { raw, rows } } };
      } catch { return parsed; }
    },
    renderMarkdown(node, helpers, context) {
      const source = node.attrs?.['markdownSource'] as { raw?: unknown; rows?: unknown } | null | undefined;
      if (source && typeof source.raw === 'string' && source.rows === JSON.stringify(node.content ?? [])) return `\n${source.raw}\n`;
      return this.parent!(node, helpers, context);
    },
  });
}

/** Maps an image address in the document to a URL the browser may load, or `undefined` to keep the image inert. */
export type MarkdownImageResolver = (source: string) => string | undefined;

/** Only an image carried inside the document itself loads by default. Anything else needs the host's resolver. */
export const inlineImagesOnly: MarkdownImageResolver = source => /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(source) ? source : undefined;

export interface MarkdownExtensionOptions {
  readonly placeholder?: string;
  readonly images?: () => MarkdownImageResolver | undefined;
}

/**
 * The Markdown constructs the rich editor can keep exactly: StarterKit (headings, lists, quotes, code, rules, bold, italic,
 * strike, links), task lists, GFM tables, images and highlight. Underline is off because Markdown has no underline.
 * Images are inert: without a host resolver they render as a labelled placeholder and never make a request.
 */
export function createMarkdownExtensions({ placeholder, images }: MarkdownExtensionOptions = {}): Extensions {
  const InertImage = Image.extend({
    renderHTML({ node }) {
      const source = String(node.attrs['src'] ?? '');
      const alt = String(node.attrs['alt'] ?? '');
      const title = node.attrs['title'] ? String(node.attrs['title']) : undefined;
      const resolved = (images?.() ?? inlineImagesOnly)(source);
      return resolved
        ? ['img', { src: resolved, alt, ...(title ? { title } : {}), 'data-boring-image': 'loaded' }]
        : ['span', { class: 'boring-markdown-image', 'data-boring-image': 'inert', role: 'img', 'aria-label': alt || 'Image', ...(title ? { title } : {}) }, alt || 'Image'];
    },
  });
  let schema: Schema | undefined;
  const SourceTable = createSourceTable(() => schema).extend({
    onBeforeCreate() { (this.parent as (() => void) | undefined)?.(); schema = this.editor.schema; },
  });
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: false, linkOnPaste: false }, underline: false }),
    TaskList, TaskItem.configure({ nested: true }),
    SourceTable.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    InertImage.configure({ inline: false, allowBase64: true }),
    Highlight,
    Placeholder.configure({ placeholder: placeholder ?? 'Start writing' }),
    PlainTextMarkdown.configure({ marked: createMarkdownParser(), markedOptions: { gfm: true, breaks: false } }),
  ];
}
