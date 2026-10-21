const formatting = new Set(['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'kbd', 'samp', 'var', 'mark', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'br', 'hr']);
const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const prefix = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="format-detection" content="telephone=no,email=no,address=no"><title>HTML preview</title></head><body>';

export function passiveHtml(source: string, document: Document): string {
  if (source.length > 262_144) throw new RangeError('HTML preview source exceeds its limit');
  const template = document.createElement('template');
  template.innerHTML = source;
  let nodes = 0, length = prefix.length;
  const output: string[] = [prefix];
  function emit(text: string): void {
    length += text.length;
    if (length > 1_048_576) throw new RangeError('HTML preview output exceeds its limit');
    output.push(text);
  }
  function visit(node: Node, depth: number): void {
    if (++nodes > 20_000 || depth > 128) throw new RangeError('HTML preview structure exceeds its limit');
    if (node.nodeType === 3) {
      emit((node.textContent ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
      return;
    }
    if (node.nodeType !== 1 || !('namespaceURI' in node) || node.namespaceURI !== htmlNamespace || !('localName' in node) || typeof node.localName !== 'string') return;
    if (node.localName === 'html' || node.localName === 'head' || node.localName === 'body') {
      for (let child = node.firstChild; child; child = child.nextSibling) visit(child, depth + 1);
      return;
    }
    const tag = node.localName === 'a' ? 'span' : node.localName;
    if (!formatting.has(tag)) return;
    emit('<' + tag + '>');
    if (tag === 'br' || tag === 'hr') return;
    if (tag === 'pre') emit('\n');
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child, depth + 1);
    emit('</' + tag + '>');
  }
  for (let child = template.content.firstChild; child; child = child.nextSibling) visit(child, 0);
  emit('</body></html>');
  return output.join('');
}
