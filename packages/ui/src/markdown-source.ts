import type { Editor, JSONContent } from '@tiptap/core';

type Node = Editor['state']['doc'];

interface SourceBlock { readonly start: number; readonly end: number; readonly nodes: readonly Node[] }
export interface MarkdownSource { readonly text: string; readonly blocks: readonly SourceBlock[] }
const children = (node: Node) => { const result: Node[] = []; node.forEach(child => result.push(child)); return result; };
const equal = (left: readonly Node[], right: readonly Node[]) => left.length === right.length && left.every((node, i) => node.eq(right[i]!));
const contentOnly = (node: JSONContent): JSONContent => {
  const { attrs, content, ...rest } = node;
  const attributes = attrs ? Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'markdownSource')) : {};
  return { ...rest, ...(Object.keys(attributes).length ? { attrs: attributes } : {}), ...(content ? { content: content.map(contentOnly) } : {}) };
};
const sameContent = (left: readonly Node[], right: readonly Node[]) => JSON.stringify(left.map(node => contentOnly(node.toJSON()))) === JSON.stringify(right.map(node => contentOnly(node.toJSON())));

/** Source spans belong to one native projection. The public lexer and schema verify the spans before they can preserve any bytes. */
export function captureMarkdownSource(editor: Editor, text: string): MarkdownSource | null {
  const manager = editor.markdown;
  if (!manager || /^(?:[ \t]*&nbsp;[ \t]*)+$/m.test(text)) return null;
  const lf = text.replace(/\r\n/g, '\n');
  const tokens = new manager.instance.Lexer(manager.instance.defaults).lex(lf);
  const nodes = children(editor.state.doc), blocks: SourceBlock[] = [];
  let offset = 0, index = 0;
  for (const token of tokens) {
    const raw = token.raw;
    if (lf.slice(offset, offset + raw.length) !== raw) return null;
    if (token.type !== 'space') {
      const body = raw.replace(/\n+$/, '');
      const parsed = children(editor.schema.nodeFromJSON(manager.parse(body)));
      // Native blank paragraphs between blocks are layout, not extra source text.
      while (index < nodes.length && nodes[index]!.type.name === 'paragraph' && nodes[index]!.content.size === 0 && !sameContent(parsed, nodes.slice(index, index + parsed.length))) {
        const previous = blocks.pop();
        if (!previous) return null;
        blocks.push({ ...previous, nodes: [...previous.nodes, nodes[index]!] }); index++;
      }
      if (!sameContent(parsed, nodes.slice(index, index + parsed.length))) return null;
      blocks.push({ start: offset, end: offset + body.length, nodes: nodes.slice(index, index + parsed.length) });
      index += parsed.length;
    }
    offset += raw.length;
  }
  if (blocks.length && index < nodes.length && nodes.slice(index).every(node => node.type.name === 'paragraph' && node.content.size === 0)) {
    const last = blocks.pop()!;
    blocks.push({ ...last, nodes: [...last.nodes, ...nodes.slice(index)] }); index = nodes.length;
  }
  if (index !== nodes.length || offset !== lf.length) return null;
  return { text: lf, blocks };
}

/** Reuse untouched spans; only the native changed block range is rendered. CRLF is a document encoding, not editor content. */
export function serializeMarkdownEdit(editor: Editor, source: MarkdownSource | null, previous: string): string | null {
  if (!source || !editor.markdown) return null;
  const nodes = children(editor.state.doc), blocks = source.blocks;
  let first = 0, left = 0, last = blocks.length, right = nodes.length;
  while (first < last && equal(blocks[first]!.nodes, nodes.slice(left, left + blocks[first]!.nodes.length))) {
    left += blocks[first]!.nodes.length; first++;
  }
  while (last > first && equal(blocks[last - 1]!.nodes, nodes.slice(right - blocks[last - 1]!.nodes.length, right))) {
    right -= blocks[last - 1]!.nodes.length; last--;
  }
  if (first === last && left === right) return previous;
  const start = blocks[first]?.start ?? blocks[blocks.length - 1]?.end ?? source.text.length;
  const end = last > first ? blocks[last - 1]!.end : start;
  const replacement = editor.markdown.serialize({ type: 'doc', content: nodes.slice(left, right).map(node => node.toJSON()) }).replace(/\n+$/, '');
  const before = source.text.slice(0, start), after = source.text.slice(end);
  const inserting = first === last;
  const leading = inserting && replacement && before && !/\n\n$/.test(before) ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const trailing = inserting && replacement && after && !after.startsWith('\n') ? '\n\n' : '';
  const joined = before + leading + replacement + trailing + after;
  return previous.includes('\r\n') ? joined.replace(/\n/g, '\r\n') : joined;
}
