'use client';

import type { ReactNode } from 'react';

/**
 * Host opt-in for running an HTML document's own scripts. `scriptSources` are the HTTPS origins the page may load libraries, styles and fonts
 * from (for example `https://cdnjs.cloudflare.com`). Everything else is closed: no network requests from the page, no frames, no forms.
 * Pinning library versions is the page's responsibility.
 */
export interface InteractiveHtml { readonly scriptSources: readonly string[] }

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
export function interactiveDocument(text: string, sources: readonly string[]): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${interactivePolicy(sources).replaceAll('"', '&quot;')}"><meta name="referrer" content="no-referrer">${text}`;
}

/**
 * The page running in a sandboxed frame: `allow-scripts` only. There is no `allow-same-origin`, so the page has an opaque origin (no cookies,
 * storage or access to this page), and no top navigation, popups, forms, downloads or modals. `allow=""` withholds camera, microphone, location
 * and the other powerful features. Changing `reload` loads the page again from the start.
 */
export function InteractiveFrame({ text, sources, reload = 0, title = 'HTML page (running)', testId = 'viewer', children }: {
  readonly text: string;
  readonly sources: readonly string[];
  readonly reload?: number;
  readonly title?: string;
  readonly testId?: string;
  readonly children?: ReactNode;
}) {
  return <div className="boring-html-run flex min-h-0 flex-1 flex-col bg-white" data-testid={`${testId}-run`}>
    <iframe key={reload} title={title} sandbox="allow-scripts" allow="" referrerPolicy="no-referrer" srcDoc={interactiveDocument(text, sources)}
      data-testid={`${testId}-run-frame`} className="size-full min-h-0 flex-1 border-0 bg-white" />
    {children}
  </div>;
}
