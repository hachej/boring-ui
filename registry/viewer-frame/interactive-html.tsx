'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { declaredLibraries, offlineLibraryHead, withOfflineLibraries } from '@hachej/boring-ui-kit/offline-libs';
import type { OfflineLibrary, OfflineLibraryHead } from '@hachej/boring-ui-kit/offline-libs';

/**
 * Host opt-in for running an HTML document's own scripts. `scriptSources` are the HTTPS origins the page may load libraries, styles and fonts
 * from (for example `https://cdnjs.cloudflare.com`). Everything else is closed: no network requests from the page, no frames, no forms.
 * Pinning library versions is the page's responsibility. A page can instead declare an offline library the host lists in `libraries`, `<!-- lib: d3 -->` (several
 * with commas): its source is injected inline before the page's scripts, loaded only for pages that declare one, with no network.
 */
export interface InteractiveHtml {
  readonly scriptSources: readonly string[];
  /** The complete set of offline libraries a page may declare (the kit has none built in; omitted means none): `{ d3: d3Library, chart: { version: '4.4.1', load: loadChartSource } }`. */
  readonly libraries?: Readonly<Record<string, OfflineLibrary>>;
}

/** An origin only: `https://host` with an optional port, no path, no wildcard, nothing that could add a second CSP directive. */
const ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export function allowedOrigins(sources: readonly string[]): string[] {
  return [...new Set(sources.map(source => source.trim().toLowerCase()).filter(source => ORIGIN.test(source)))];
}

/** The Content-Security-Policy the running page gets: inline script and style, the allow-listed origins for libraries, nothing else. */
export function interactivePolicy(sources: readonly string[]): string {
  const origins = allowedOrigins(sources).join(' ');
  const list = (...extra: string[]) => [...extra, ...(origins ? [origins] : [])].join(' ');
  return [
    "default-src 'none'",
    `script-src ${list("'unsafe-inline'")}`,
    `style-src ${list("'unsafe-inline'")}`,
    'img-src data: blob:',
    `font-src ${list('data:')}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * The document the frame loads: the policy and a no-referrer rule come first, so they apply before any of the page's own markup is parsed.
 * A second doctype or head in the page is ignored by the parser; a meta policy of the page's own can only tighten this one.
 */
export function interactiveDocument(text: string, sources: readonly string[], libraries = ''): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${interactivePolicy(sources).replaceAll('"', '&quot;')}"><meta name="referrer" content="no-referrer">${libraries}${text}`;
}

/**
 * The page running in a sandboxed frame: `allow-scripts` only. There is no `allow-same-origin`, so the page has an opaque origin (no cookies,
 * storage or access to this page), and no top navigation, popups, forms, downloads or modals. `allow=""` withholds camera, microphone, location
 * and the other powerful features. Changing `reload` loads the page again from the start.
 */
export function InteractiveFrame({ text, sources, reload = 0, title = 'HTML page (running)', testId = 'viewer', children, frameRef, onLoad, libraries }: {
  readonly libraries?: InteractiveHtml['libraries'];
  readonly text: string;
  readonly sources: readonly string[];
  readonly reload?: number;
  readonly title?: string;
  readonly testId?: string;
  readonly children?: ReactNode;
  /** Host message bridges may identify the sender, never read the frame's document. */
  readonly frameRef?: Ref<HTMLIFrameElement> | undefined;
  readonly onLoad?: (() => void) | undefined;
}) {
  const names = useMemo(() => declaredLibraries(text), [text]);
  const available = useMemo(() => withOfflineLibraries(libraries), [libraries]);
  const [loaded, setLoaded] = useState<{ readonly text: string } & OfflineLibraryHead>();
  useEffect(() => {
    if (!names.length) return;
    let current = true;
    void offlineLibraryHead(names, available).then(result => { if (current) setLoaded({ text, ...result }); });
    return () => { current = false; };
  }, [names, text, available]);
  const ready = names.length === 0 ? { head: '', problems: [] } : loaded?.text === text ? loaded : undefined;
  return <div className="boring-html-run flex min-h-0 flex-1 flex-col" data-testid={`${testId}-run`}>
    {ready?.problems.map(problem => <p key={problem} role="alert" className="m-0 px-3 py-2 text-sm text-destructive" data-testid={`${testId}-run-library-error`}>{problem}</p>)}
    {ready && <iframe key={reload} ref={frameRef} onLoad={onLoad} title={title} sandbox="allow-scripts" allow="" referrerPolicy="no-referrer" srcDoc={interactiveDocument(text, sources, ready.head)}
      data-testid={`${testId}-run-frame`} className="size-full min-h-0 flex-1" />}
    {children}
  </div>;
}
