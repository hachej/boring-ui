import { Node } from '@tiptap/core';
import { Marked } from 'marked';

const literalHtml = new Marked();

/** Literal Markdown, never HTML inserted into the host DOM. These atoms are host presentation, not Pi execution. */
export function preservedMarkdownNodes() {
  const block = Node.create({
    name: 'preservedBlock', group: 'block', atom: true,
    addAttributes: () => ({ raw: { default: '', rendered: false }, label: { default: 'HTML', rendered: false } }),
    parseHTML: () => [],
    renderHTML: ({ node }) => ['div', { class: 'boring-markdown-preserved', 'data-preserved': node.attrs['label'] },
      ['small', {}, String(node.attrs['label'])], ['pre', {}, String(node.attrs['raw'])]],
    markdownTokenName: 'preservedBlock',
    markdownTokenizer: {
      name: 'preservedBlock', level: 'block',
      start: source => { const index = source.search(/\n(?=---[ \t]*\n| {0,3}\[[^\]\n]+\]:| {0,3}<)/); return index < 0 ? -1 : index + 1; },
      tokenize(source, tokens) {
        if (/^ {0,3}</.test(source)) {
          const html = literalHtml.lexer(source)[0];
          if (html?.type === 'html') return { type: 'preservedBlock', raw: html.raw, label: 'HTML' };
        }
        const front = tokens.length === 0 && /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(source);
        const definition = /^ {0,3}\[[^\]\n]+\]:[^\n]*(?:\n(?:[ \t]+[^\n]*|(?=\n[ \t]+)\n))*\n?/.exec(source);
        const raw = front ? front[0] : definition?.[0];
        return raw ? { type: 'preservedBlock', raw, label: front ? 'Front matter' : definition![0].trimStart().startsWith('[^') ? 'Footnote' : 'Reference' } : undefined;
      },
    },
    parseMarkdown: token => ({ type: 'preservedBlock', attrs: { raw: token.raw?.replace(/\n+$/, ''), label: token['label'] } }),
    renderMarkdown: node => String(node.attrs?.['raw'] ?? '').replace(/\n$/, ''),
    addNodeView() {
      return ({ node, editor, getPos }) => {
        const dom = document.createElement('div'); dom.className = 'boring-markdown-preserved'; dom.dataset['preserved'] = String(node.attrs['label']);
        const label = document.createElement('small'); label.textContent = String(node.attrs['label']); dom.append(label);
        if (node.attrs['label'] !== 'Front matter') {
          const pre = document.createElement('pre'); pre.textContent = String(node.attrs['raw']); dom.append(pre);
          return { dom };
        }
        const code = document.createElement('pre'); code.textContent = String(node.attrs['raw']);
        code.contentEditable = editor.isEditable ? 'plaintext-only' : 'false'; code.setAttribute('role', 'textbox'); code.setAttribute('aria-label', 'Front matter code'); code.setAttribute('aria-multiline', 'true'); code.spellcheck = false;
        dom.append(code);
        const input = () => {
          const pos = getPos();
          if (!editor.isEditable || typeof pos !== 'number') return;
          const raw = code.textContent ?? '';
          if (code.children.length) code.replaceChildren(document.createTextNode(raw));
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, raw }));
        };
        const insertText = (event: ClipboardEvent | DragEvent) => {
          event.preventDefault();
          if (!editor.isEditable) return;
          const text = 'clipboardData' in event ? event.clipboardData?.getData('text/plain') : event.dataTransfer?.getData('text/plain');
          if (!text) return;
          const selection = dom.ownerDocument.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          const inserted = document.createTextNode(text);
          if (range && code.contains(range.commonAncestorContainer)) {
            range.deleteContents(); range.insertNode(inserted); range.setStartAfter(inserted); range.collapse(true);
            selection!.removeAllRanges(); selection!.addRange(range);
          } else code.append(inserted);
          code.dispatchEvent(new dom.ownerDocument.defaultView!.Event('input', { bubbles: true }));
        };
        code.addEventListener('input', input);
        code.addEventListener('paste', insertText);
        code.addEventListener('drop', insertText);
        return { dom, stopEvent: () => true, ignoreMutation: () => true,
          update(next) {
            if (next.type !== node.type) return false;
            node = next;
            if (code.textContent !== node.attrs['raw']) code.textContent = String(node.attrs['raw']);
            code.contentEditable = editor.isEditable ? 'plaintext-only' : 'false';
            return true;
          }, destroy: () => { code.removeEventListener('input', input); code.removeEventListener('paste', insertText); code.removeEventListener('drop', insertText); } };
      };
    },
  });
  const inline = Node.create({
    name: 'preservedInline', group: 'inline', inline: true, atom: true,
    addAttributes: () => ({ raw: { default: '', rendered: false } }),
    parseHTML: () => [],
    renderHTML: ({ node }) => ['span', { class: 'boring-markdown-preserved-inline' }, String(node.attrs['raw'])],
    markdownTokenName: 'preservedInline',
    markdownTokenizer: {
      name: 'preservedInline', level: 'inline', start: source => source.search(/[<\[]/),
      tokenize(source) {
        if (source.startsWith('<')) {
          const html = literalHtml.Lexer.lexInline(source, literalHtml.defaults)[0];
          if (html?.type === 'html') return { type: 'preservedInline', raw: html.raw };
        }
        const raw = /^\[(?:\^[^\]\s]+|[^\]\n]+)\](?:\[[^\]\n]*\])?(?!\()/.exec(source)?.[0];
        return raw ? { type: 'preservedInline', raw } : undefined;
      },
    },
    parseMarkdown: token => ({ type: 'preservedInline', attrs: { raw: token.raw } }),
    renderMarkdown: node => String(node.attrs?.['raw'] ?? ''),
  });
  const html = Node.create({
    name: 'preservedHtml', markdownTokenName: 'html', group: 'block', atom: true,
    parseHTML: () => [], renderHTML: () => ['div'],
    parseMarkdown: token => ({ type: token['block'] ? 'preservedBlock' : 'preservedInline', attrs: { raw: token.raw, label: 'HTML' } }),
  });
  return [block, inline, html];
}
