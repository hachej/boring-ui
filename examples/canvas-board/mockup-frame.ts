// An HTML mock-up (`*.mockup.html`, written freely by an agent) as the sandboxed frame's document. It reuses the html viewer's sandbox
// (registry/viewers/interactive-html: `sandbox="allow-scripts"` only, opaque origin, the same Content-Security-Policy with no allowed
// origins) and adds, before the page: the app's theme tokens, Tailwind's preflight and the utilities the page uses (compiled by the host
// from the page's class names, so the agent can use any Tailwind class), and a small host-written pick script that answers "comment
// mode" by posting what was clicked to the parent. Everything the frame posts is untrusted data: the parent checks the sender and bounds it.
import { interactivePolicy } from '../../registry/viewers/interactive-html';

/** The CSS sources the host hands to the compiler: the registry theme tokens and Tailwind's own theme, preflight and utilities. */
export interface MockupCss { readonly tokens: string; readonly theme: string; readonly preflight: string; readonly utilities: string }

let compiler: Promise<{ build: (candidates: string[]) => string }> | undefined;
/** Tailwind v4's compiler, loaded on first use (a lazy chunk: plain chat and the board never pay for it). */
async function tailwind(css: MockupCss) {
  compiler ??= import('tailwindcss').then(({ compile }) => compile(
    `@layer theme, base, components, utilities;\n@import "theme" layer(theme);\n@import "preflight" layer(base);\n@import "utilities" layer(utilities);\n${css.tokens}`,
    { base: '/', loadStylesheet: async (id: string) => ({ path: id, base: '/', content: id === 'theme' ? css.theme : id === 'preflight' ? css.preflight : css.utilities }) }));
  return compiler;
}

/** Class-like tokens of the page (Tailwind ignores what is not a utility), as the studio's own build scans its sources. */
const candidates = (html: string) => [...new Set(html.split(/[\s"'`<>=]+/).filter(Boolean))];

/** The pick script: host code, but it runs inside the sandbox with the page, so it gets no more power than the page has. */
const PICK = `<script>(() => {
  let picking = false;
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || event.data.type !== 'board:pick-mode') return;
    picking = event.data.on === true;
    document.documentElement.style.cursor = picking ? 'crosshair' : '';
  });
  const selectorOf = element => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && node !== document.body && parts.length < 6; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      let index = 1; for (let sibling = node; (sibling = sibling.previousElementSibling);) if (sibling.tagName === node.tagName) index++;
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
    }
    return parts.join(' > ');
  };
  addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (link && !link.getAttribute('href').startsWith('#')) event.preventDefault();
    if (!picking) return;
    event.preventDefault(); event.stopPropagation();
    const element = event.target, rect = element.getBoundingClientRect();
    parent.postMessage({ type: 'board:pick', selector: selectorOf(element), text: (element.innerText || element.textContent || '').trim().slice(0, 200),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }, '*');
  }, true);
})();</script>`;

/** The frame's whole document: policy first (as the html viewer does), then theme and utilities, the pick script, then the page. */
export async function mockupDocument(html: string, css: MockupCss, { dark = false } = {}): Promise<string> {
  const styles = (await tailwind(css)).build(candidates(`${html} bg-background text-foreground antialiased dark`));
  const policy = interactivePolicy([]).replaceAll('"', '&quot;');
  return `<!doctype html><html class="${dark ? 'dark' : ''}"><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`
    + `<style>${styles.replaceAll('</style', '<\\/style')}</style>${PICK}</head><body class="bg-background text-foreground antialiased">${html}</body></html>`;
}

/** A pick from inside a frame, read defensively: only from that frame's window, only the expected fields, bounded. */
export interface Pick { readonly selector: string; readonly text: string; readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } }
export function readPick(data: unknown): Pick | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (value['type'] !== 'board:pick' || typeof value['selector'] !== 'string' || typeof value['text'] !== 'string') return null;
  const rect = (value['rect'] && typeof value['rect'] === 'object' ? value['rect'] : {}) as Record<string, unknown>;
  const n = (key: string) => typeof rect[key] === 'number' && Number.isFinite(rect[key]) ? Math.max(-1e4, Math.min(1e4, rect[key] as number)) : 0;
  return { selector: value['selector'].slice(0, 300), text: value['text'].slice(0, 200), rect: { x: n('x'), y: n('y'), w: n('w'), h: n('h') } };
}
