// Ported from spike/canvas-board, examples/canvas-board/mockup-frame.ts (3b838e3a5).
import { z } from 'zod';

const rectangle = z.object({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000), w: z.number().finite().min(0).max(10000), h: z.number().finite().min(0).max(10000) });
const message = z.object({ type: z.enum(['mockup:pick', 'mockup:layout']), selector: z.string().max(300).regex(/^:root(?: > :nth-child\([1-9]\d{0,3}\)){1,12}$/), rect: rectangle });
export type MockupPick = z.infer<typeof message>;
export function readMockupPick(data: unknown): MockupPick | undefined {
  const parsed = message.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

// No text or form values cross the frame boundary. The host's proxy element passes through the normal feedback privacy policy.
const PICK = `<script>(() => {
  let picking = false;
  const picked = new Map();
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || event.data.type !== 'mockup:pick-mode') return;
    picking = event.data.on === true;
    const theme = event.data.theme;
    if (theme && typeof theme.variables === 'string') {
      document.getElementById('mockup-theme').textContent = ':root{' + theme.variables + ';color-scheme:' + (theme.dark ? 'dark' : 'light') + '}';
      document.documentElement.classList.toggle('dark', theme.dark === true);
    }
    document.documentElement.style.cursor = picking ? 'crosshair' : '';
  });
  const selectorOf = element => {
    const parts = [];
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      if (parts.length >= 12) return '';
      let index = 1; for (let sibling = node; (sibling = sibling.previousElementSibling);) index++;
      parts.unshift(':nth-child(' + index + ')');
    }
    return [':root', ...parts].join(' > ');
  };
  const send = (type, selector, element) => {
    const r = element.getBoundingClientRect();
    parent.postMessage({ type, selector, rect: { x: r.x, y: r.y, w: r.width, h: r.height } }, '*');
  };
  addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (link && !link.getAttribute('href').startsWith('#')) event.preventDefault();
    if (!picking) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const element = event.target, selector = selectorOf(element);
    if (!selector || (!picked.has(selector) && picked.size >= 50)) return;
    picked.set(selector, element);
    send('mockup:pick', selector, element);
  }, true);
  const layout = () => picked.forEach((element, selector) => send('mockup:layout', selector, element));
  addEventListener('scroll', layout, true);
  addEventListener('resize', layout);
})();</script>`;

/** InteractiveFrame adds the existing policy before these styles, script and artifact bytes. */
export function mockupContent(html: string, css: string): string {
  return `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.replace(/<\/style/gi, '<\\/style')}</style><style id="mockup-theme"></style>${PICK}</head><body class="bg-background text-foreground">${html}</body></html>`;
}
