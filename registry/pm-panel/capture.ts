import { PAGE_LIMITS, serializeElement } from '@hachej/boring-feedback/page';
import type { AppDomNode, PrivacyPolicy } from '@hachej/boring-feedback/page';

/** Rasterize the policy-filtered DOM at its observed layout. Never copy HTML, URLs, media, canvas pixels or form values. */
export function captureElement(element: Element, policy: PrivacyPolicy): { readonly mimeType: 'image/png'; readonly data: string } {
  // Anchor metadata's 2 KiB/50-node budget is not an image budget: ordinary cards exceed it.
  const snapshot = serializeElement(element, policy, { subtreeLimit: PAGE_LIMITS.maxNodes, maxDepth: PAGE_LIMITS.maxDepth, maxBytes: PAGE_LIMITS.maxBytes });
  if (!snapshot.root || snapshot.truncated) throw new Error('La capture de cet élément est indisponible.');
  const box = element.getBoundingClientRect();
  const canvas = element.ownerDocument.createElement('canvas');
  const scale = Math.min(1, 720 / Math.max(1, box.width), 480 / Math.max(1, box.height));
  canvas.width = Math.max(1, Math.ceil(box.width * scale)); canvas.height = Math.max(1, Math.ceil(box.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('La capture de cet élément est indisponible.');
  context.scale(scale, scale);
  context.fillStyle = getComputedStyle(element.ownerDocument.documentElement).getPropertyValue('--background');
  context.fillRect(0, 0, box.width, box.height);
  const draw = (live: Element, node: AppDomNode) => {
    const rect = live.getBoundingClientRect(), style = getComputedStyle(live);
    const x = rect.left - box.left, y = rect.top - box.top;
    context.fillStyle = style.backgroundColor; context.fillRect(x, y, rect.width, rect.height);
    const strokeWidth = parseFloat(style.borderTopWidth) || 0;
    if (strokeWidth) { context.lineWidth = strokeWidth; context.strokeStyle = style.borderTopColor; context.strokeRect(x + strokeWidth / 2, y + strokeWidth / 2, Math.max(0, rect.width - strokeWidth), Math.max(0, rect.height - strokeWidth)); }
    if (node.text) {
      context.fillStyle = style.color; context.font = style.font; context.textBaseline = 'top';
      const padding = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
      const width = Math.max(1, rect.width - padding - (parseFloat(style.paddingRight) || 0));
      let line = '', offset = 0;
      for (const word of node.text.split(' ')) {
        if (line && context.measureText(`${line} ${word}`).width > width) { context.fillText(line, x + padding, y + top + offset, width); line = word; offset += parseFloat(style.lineHeight) || parseFloat(style.fontSize); }
        else line += `${line ? ' ' : ''}${word}`;
      }
      if (line) context.fillText(line, x + padding, y + top + offset, width);
    }
    for (const child of node.children) {
      const match = [...live.children].filter(candidate => candidate.localName === child.tag)[child.index];
      if (match) draw(match, child);
    }
  };
  draw(element, snapshot.root);
  return { mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1]! };
}
