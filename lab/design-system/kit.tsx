import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

/* Theme: the page toggles `.dark` on <html>; embedded frames follow through postMessage. */
const listeners = new Set<() => void>();
export const isDark = () => document.documentElement.classList.contains('dark');
export function setDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem('gallery-dark', dark ? '1' : '0'); } catch { /* storage may be blocked */ }
  listeners.forEach(listener => listener());
}
export const useDark = () => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, isDark, () => false);

export type Locale = 'en' | 'fr';
const localeListeners = new Set<() => void>();
let currentLocale: Locale = 'en';
export const setLocale = (locale: Locale) => { currentLocale = locale; localeListeners.forEach(listener => listener()); };
export const useLocale = (): Locale => useSyncExternalStore(listener => { localeListeners.add(listener); return () => localeListeners.delete(listener); }, () => currentLocale, () => 'en');

/** Token names (`--x`) in mono; the words around them in the sans. */
export function Names({ text }: { readonly text: string }) {
  return <>{text.split(/(--[a-z0-9-]+)/).map((part, index) => index % 2 ? <code key={index}>{part}</code> : part)}</>;
}

/** A labelled slot: the block's name and the tokens it reads, so the page doubles as the index. */
export function Block({ name, tokens, note, children, className }: { readonly name: string; readonly tokens?: string; readonly note?: string; readonly children: ReactNode; readonly className?: string }) {
  return <section className={`gx-block ${className ?? ''}`} data-block={name}>
    <header>
      <span className="gx-name">{name}</span>
      {tokens ? <span className="gx-tokens">reads <Names text={tokens} /></span> : null}
      {note ? <span className="gx-tokens">{note}</span> : null}
    </header>
    <div className="gx-body"><Safe name={name}>{children}</Safe></div>
  </section>;
}

/** A block that cannot render standalone: said, with the reason, never faked. */
export function Placeholder({ name, tokens, reason }: { readonly name: string; readonly tokens?: string; readonly reason: string }) {
  return <Block name={name} {...(tokens ? { tokens } : {})}><div className="gx-placeholder" data-placeholder={name}><b>Placeholder.</b> {reason}</div></Block>;
}

/** A render error becomes a labelled placeholder with its reason. */
export class Safe extends Component<{ readonly name: string; readonly children: ReactNode }, { readonly error?: string }> {
  override state: { readonly error?: string } = {};
  static getDerivedStateFromError(error: unknown) { return { error: String((error as Error)?.message ?? error) }; }
  override componentDidCatch(error: unknown) { console.warn(`gallery: ${this.props.name} failed to render`, error); }
  override render() {
    return this.state.error ? <div className="gx-placeholder" data-placeholder-error={this.props.name}><b>Could not render standalone.</b> {this.state.error}</div> : this.props.children;
  }
}

export function Section({ id, title, lead, children, wide = false }: { readonly id: string; readonly title: string; readonly lead?: string; readonly children: ReactNode; readonly wide?: boolean }) {
  return <section id={id} className="gx-section"><h2>{title}</h2>{lead ? <p className="gx-lead">{lead}</p> : null}<div className={`gx-grid ${wide ? 'wide' : ''}`}>{children}</div></section>;
}

/**
 * A real, second copy of the page in an iframe, cut down to one demo (`#embed=<name>`): the shell, the dock and the phone layout read the
 * viewport (media queries, fixed positioning), so they need a viewport of their own. The frame reuses this page's inline style and script.
 */
export function Embed({ name, height, width, title }: { readonly name: string; readonly height: number; readonly width?: number; readonly title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [near, setNear] = useState(false);
  const dark = useDark();
  const locale = useLocale();
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setNear(true); }, { rootMargin: '800px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const srcDoc = useMemo(() => {
    if (!near) return undefined;
    const style = document.getElementById('gallery-css')?.outerHTML ?? '';
    const script = document.getElementById('gallery-js')?.textContent ?? '';
    return `<!doctype html><html lang="en" class="${isDark() ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${style}</head><body class="gx-embed"><div id="root"></div><script>window.__EMBED__=${JSON.stringify({ name, locale: currentLocale })};</script><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  }, [near, name]);
  useEffect(() => { frame.current?.contentWindow?.postMessage({ gallery: { dark, locale } }, '*'); }, [dark, locale, srcDoc]);
  return <div ref={host} className={`gx-frame ${width && width <= 420 ? 'gx-phone' : ''}`} style={{ height, ...(width ? { maxWidth: width } : {}) }} data-embed={name}>
    {srcDoc ? <iframe ref={frame} title={title} srcDoc={srcDoc} onLoad={() => frame.current?.contentWindow?.postMessage({ gallery: { dark: isDark(), locale: currentLocale } }, '*')} /> : null}
  </div>;
}
