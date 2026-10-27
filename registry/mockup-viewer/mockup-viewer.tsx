'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { MessageSquarePlusIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { InteractiveFrame } from '../viewer-frame/interactive-html';
import { mockupContent, readMockupPick } from './mockup-frame';
import type { MockupPick } from './mockup-frame';

import { mockupTarget } from './mockup-path';
export { isMockupPath, mockupTarget } from './mockup-path';

/** Structurally the feedback item's usePointComments. Picks are host-owned proxy elements, never frame DOM. */
export interface MockupComments {
  readonly active: boolean;
  readonly picking?: boolean | undefined;
  readonly point: () => void;
  readonly pins: readonly { readonly number: number; readonly target: string }[];
  readonly pick?: ((element: Element) => void) | undefined;
  readonly reposition?: (() => void) | undefined;
}

export interface MockupViewerProps {
  readonly text: string;
  readonly path?: string | undefined;
  readonly comments?: MockupComments | undefined;
  readonly locale?: 'en' | 'fr' | undefined;
  readonly onReady?: (() => void) | undefined;
  /**
   * Render the frame with this shadcn theme instead of the host's (a look being compared): shadcn's own `cssVars` shape, variable names
   * without `--`. Its variables are applied after the host's, so a look that names only some of them keeps the host's others.
   */
  readonly themeOverride?: ShadcnTheme | undefined;
  /** Force light or dark in the frame; absent: follow the host. */
  readonly mode?: 'light' | 'dark' | undefined;
  /** The frame's accessible name (several frames side by side need distinct names). */
  readonly title?: string | undefined;
}

/** A shadcn theme as the shadcn registry writes it (`cssVars`): `theme` (fonts, radius steps), `light` (:root) and `dark` (.dark). */
export interface ShadcnTheme {
  readonly theme?: Readonly<Record<string, string>> | undefined;
  readonly light?: Readonly<Record<string, string>> | undefined;
  readonly dark?: Readonly<Record<string, string>> | undefined;
}

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const VALUE = /^[^;{}<>\\]{1,240}$/;

/** The declarations a shadcn theme gives the frame in one mode. Names and values that could leave the declaration list are dropped. */
export function themeDeclarations(theme: ShadcnTheme, dark: boolean): string {
  const entries = { ...theme.theme, ...theme.light, ...(dark ? theme.dark : undefined) };
  // The frame's radius steps are bound to --radius (the registry theme's bindings), so a look's --radius reshapes every rounded-*.
  return Object.entries(entries).filter(([name, value]) => NAME.test(name) && typeof value === 'string' && VALUE.test(value.trim())).map(([name, value]) => `--${name}:${value.trim()}`).join(';');
}

function useTheme(root: RefObject<HTMLDivElement | null>) {
  const [theme, setTheme] = useState({ variables: '', dark: false });
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const view = element.ownerDocument.defaultView;
    if (!view) return undefined;
    const media = view.matchMedia('(prefers-color-scheme: dark)');
    const read = () => {
      const computed = view.getComputedStyle(element);
      const variables = Array.from(computed).filter(name => name.startsWith('--')).map(name => `${name}:${computed.getPropertyValue(name)}`).join(';');
      const dark = !!element.closest('.dark') || (!element.closest('.light') && media.matches);
      setTheme(current => current.variables === variables && current.dark === dark ? current : { variables, dark });
    };
    read();
    const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(read);
    for (let node: Element | null = element; node; node = node.parentElement) observer?.observe(node, { attributes: true, attributeFilter: ['class', 'style'] });
    media.addEventListener('change', read);
    return () => { observer?.disconnect(); media.removeEventListener('change', read); };
  }, [root]);
  return theme;
}

export function MockupViewer({ text, path = '', comments, locale, onReady, themeOverride, mode: forced, title }: MockupViewerProps) {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const proxies = useRef(new Map<string, HTMLSpanElement>());
  const pending = useRef<string | undefined>(undefined);
  const host = useTheme(root);
  const overrideKey = themeOverride ? JSON.stringify(themeOverride) : '';
  const theme = useMemo(() => {
    const dark = forced ? forced === 'dark' : host.dark;
    if (!themeOverride) return dark === host.dark ? host : { ...host, dark };
    const own = themeDeclarations(themeOverride, dark);
    return { variables: [host.variables, own].filter(Boolean).join(';'), dark };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the override by value (overrideKey): a new object with the same theme does not restyle the frame
  }, [host, overrideKey, forced]);
  const [compiled, setCompiled] = useState<{ text: string; css: string } | { text: string; error: true }>();
  const [picks, setPicks] = useState<readonly MockupPick[]>([]);
  const label = locale === 'fr' ? 'Commenter un élément' : 'Comment on an element';
  useEffect(() => {
    let off = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new mock-up or path starts with no picks, once per change
    setPicks([]);
    void import('./mockup-compile').then(({ compileMockup }) => compileMockup(text)).then(css => { if (!off) setCompiled({ text, css }); }, () => { if (!off) setCompiled({ text, error: true }); });
    return () => { off = true; };
  }, [text, path]);
  const ready = compiled?.text === text && 'css' in compiled;
  const content = ready ? mockupContent(text, compiled.css) : undefined;
  const picking = comments?.picking ?? comments?.active ?? false;
  const mode = () => frame.current?.contentWindow?.postMessage({ type: 'mockup:pick-mode', on: picking, theme }, '*');
  useEffect(mode, [picking, content, theme]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a newly compiled page starts with no picks, before paint, once per content
  useLayoutEffect(() => { pending.current = undefined; setPicks([]); }, [content]);
  useEffect(() => {
    const view = root.current?.ownerDocument.defaultView;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow || event.origin !== 'null' || !comments?.pick) return;
      const pick = readMockupPick(event.data);
      if (!pick || (pick.type === 'mockup:pick' && !picking)) return;
      if (pick.type === 'mockup:pick') pending.current = pick.selector;
      setPicks(current => {
        const exists = current.some(item => item.selector === pick.selector);
        if (!exists && (pick.type !== 'mockup:pick' || current.length >= 50)) { pending.current = undefined; return current; }
        return exists ? current.map(item => item.selector === pick.selector ? pick : item) : [...current, pick];
      });
    };
    view?.addEventListener('message', onMessage);
    return () => view?.removeEventListener('message', onMessage);
  }, [comments, picking]);
  const pickProxy = comments?.pick, reposition = comments?.reposition;
  useLayoutEffect(() => {
    const selector = pending.current;
    pending.current = undefined;
    const proxy = selector === undefined ? undefined : proxies.current.get(selector);
    if (proxy) pickProxy?.(proxy);
    else reposition?.();
  }, [picks, pickProxy, reposition]);
  return <div ref={root} data-boring="mockup-viewer" className="flex h-full min-h-0 min-w-0 flex-col">
    {comments?.pick && <nav data-feedback-ignore="" className="flex shrink-0 justify-end px-2 py-1">
      <Tooltip><TooltipTrigger render={<Toggle aria-label={label} pressed={comments.active} onPressedChange={comments.point} data-testid="mockup-comment" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" />}><MessageSquarePlusIcon aria-hidden="true" /></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
    </nav>}
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {content === undefined ? <p role="status" className="p-3 text-muted-foreground">{compiled && 'error' in compiled ? 'HTML mock-up unavailable.' : 'Loading HTML mock-up…'}</p>
        : <InteractiveFrame key={content} text={content} sources={[]} title={title ?? 'HTML mock-up'} testId="mockup" frameRef={frame} onLoad={() => { mode(); onReady?.(); }} />}
      {picks.map(pick => <span key={pick.selector} ref={element => { if (element) proxies.current.set(pick.selector, element); else proxies.current.delete(pick.selector); }}
        data-testid="mockup-element" data-feedback-id={mockupTarget(path, pick.selector)} role="img" aria-label="HTML mock-up element"
        className="pointer-events-none absolute overflow-hidden" style={{ left: pick.rect.x, top: pick.rect.y, width: pick.rect.w, height: pick.rect.h }}>
        {!comments?.active && comments?.pins.filter(pin => pin.target === mockupTarget(path, pick.selector)).map(pin => <Badge key={pin.number}>{pin.number}</Badge>)}
      </span>)}
    </div>
  </div>;
}
