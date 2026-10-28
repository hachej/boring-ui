import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { Node as TiptapNode } from '@tiptap/core';
import type { Editor, Extensions, JSONContent } from '@tiptap/core';
import { createMarkdownParser } from './markdown-parser.js';
import { preservedMarkdownNodes } from './markdown-preserved.js';

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

function sourceBlock(extension: TiptapNode, schema: () => Editor['schema'] | undefined) {
  return extension.extend({
    addAttributes() { return { ...this.parent?.(), markdownSource: { default: null, rendered: false, parseHTML: () => null } }; },
    parseMarkdown(token, helpers) {
      const parsed = this.parent!(token, helpers) as JSONContent, current = schema();
      if (!current || !token.raw || Array.isArray(parsed) || /^(?:[ \t]*&nbsp;[ \t]*)+$/.test(token.raw.trim())) return parsed;
      const snapshot = current.nodeFromJSON(parsed).toJSON();
      return { ...parsed, attrs: { ...parsed.attrs, markdownSource: { raw: token.raw.replace(/\n+$/, ''), snapshot: JSON.stringify(snapshot) } } };
    },
    renderMarkdown(node, helpers, context) {
      const original = node.attrs?.['markdownSource'] as { raw?: unknown; snapshot?: unknown } | null;
      const snapshot = { ...node, attrs: { ...node.attrs, markdownSource: null } };
      if (original && typeof original.raw === 'string' && original.snapshot === JSON.stringify(snapshot)) return original.raw;
      return this.parent!(node, helpers, context);
    },
  });
}

function sourceStarterKit(source: () => string, schema: () => Editor['schema'] | undefined) {
  return StarterKit.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map(extension => {
        if (extension instanceof TiptapNode && extension.name === 'paragraph') return sourceBlock(extension.extend({ renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? []) }), schema);
        if (extension.name === 'bold' || extension.name === 'italic') return extension.extend({ renderMarkdown: (node, helpers, context) => {
          const text = typeof context.meta?.['markText'] === 'string' ? context.meta['markText'] : '';
          const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const prose = source().replace(/[*_]/g, '');
          const intraword = text === '' || !prose.includes(text) || new RegExp(`(?:[\\p{L}\\p{N}]${escaped}|${escaped}[\\p{L}\\p{N}])`, 'u').test(prose);
          const marker = extension.name === 'bold' ? (!intraword && /__\S/.test(source()) ? '__' : '**') : (!intraword && /(?:^|\s)_\S/.test(source()) ? '_' : '*');
          return marker + helpers.renderChildren(node) + marker;
        } });
        if (extension instanceof TiptapNode && extension.name === 'listItem') return extension.extend({
          addAttributes() { return { ...this.parent?.(), markdownSource: { default: null, rendered: false, parseHTML: () => null } }; },
          parseMarkdown(token, helpers) {
            const parsed = this.parent!(token, helpers) as JSONContent;
            const current = schema();
            if (!current || !token.raw || Array.isArray(parsed)) return parsed;
            const content = current.nodeFromJSON(parsed).toJSON().content ?? [];
            return { ...parsed, attrs: { ...parsed.attrs, markdownSource: { raw: token.raw.replace(/\n$/, ''), content: JSON.stringify(content) } } };
          },
          renderMarkdown(node, helpers, context) {
            const original = node.attrs?.['markdownSource'] as { raw?: unknown; content?: unknown } | null;
            if (original && typeof original.raw === 'string' && original.content === JSON.stringify(node.content ?? [])) return original.raw;
            const rendered = this.parent!(node, helpers, context);
            const bullet = /^ {0,3}([-*+])\s/m.exec(source())?.[1] ?? '-';
            return context.parentType === 'bulletList' ? rendered.replace(/^- /, `${bullet} `) : rendered;
          },
        });
        if (extension instanceof TiptapNode && extension.name === 'horizontalRule') return extension.extend({ renderMarkdown: () => /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/m.exec(source())?.[0] ?? '---' });
        if (extension instanceof TiptapNode && extension.name === 'heading') return sourceBlock(extension.extend({
          addAttributes() { return { ...this.parent?.(), markdownHeadingStyle: { default: 'atx', rendered: false, parseHTML: () => 'atx' } }; },
          parseMarkdown(token, helpers) {
            const parsed = this.parent!(token, helpers) as JSONContent;
            return { ...parsed, attrs: { ...parsed.attrs, markdownHeadingStyle: /^ {0,3}#{1,6}(?:\s|$)/.test(token.raw ?? '') ? 'atx' : 'setext' } };
          },
          renderMarkdown(node, helpers, context) {
            const text = helpers.renderChildren(node.content ?? []), level = Number(node.attrs?.['level']);
            return level <= 2 && node.attrs?.['markdownHeadingStyle'] === 'setext' ? `${text}\n${(level === 1 ? '=' : '-').repeat(Math.max(3, text.length))}` : this.parent!(node, helpers, context);
          },
        }), schema);
        return extension;
      });
    },
  });
}

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
  readonly preservedLabels?: Parameters<typeof preservedMarkdownNodes>[0];
  readonly source?: () => string;
}

/**
 * The Markdown constructs the rich editor can keep exactly: StarterKit (headings, lists, quotes, code, rules, bold, italic,
 * strike, links), task lists, GFM tables, images and highlight. Underline is off because Markdown has no underline.
 * Images are inert: without a host resolver they render as a labelled placeholder and never make a request.
 */
export function createMarkdownExtensions({ placeholder, images, preservedLabels, source = () => '' }: MarkdownExtensionOptions = {}): Extensions {
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
    sourceStarterKit(source, () => schema).configure({ link: { openOnClick: false, autolink: false, linkOnPaste: false }, underline: false }),
    ...preservedMarkdownNodes(preservedLabels),
    TaskList, TaskItem.configure({ nested: true }),
    SourceTable.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    InertImage.configure({ inline: false, allowBase64: true }),
    Highlight,
    Placeholder.configure({ placeholder: placeholder ?? 'Start writing' }),
    PlainTextMarkdown.configure({ marked: createMarkdownParser(), markedOptions: { gfm: true, breaks: false }, indentation: { style: 'space', size: /^ {4}[-*+]\s/m.test(source()) ? 4 : 2 } }),
  ];
}
