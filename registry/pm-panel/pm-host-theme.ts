'use client';

import { useEffect } from 'react';

/** The parents whose style a standalone PM takes without any app change. A preview host is added with `AppShell`'s `pmHostOrigins`. */
export const PM_HOST_ORIGINS: readonly string[] = ['https://studio.senecaapp.ai'];

const TOKEN = /^--(?:background|foreground|card(?:-foreground)?|popover(?:-foreground)?|primary(?:-foreground)?|secondary(?:-foreground)?|muted(?:-foreground)?|accent(?:-foreground)?|destructive|border|input|ring|radius|font-sans|pm-[a-z0-9-]+)$/;
const VALUE = /^[\w\s#%.,()/+'"-]{1,160}$/;
const FORBIDDEN = /url|image|expression|attr|src|\/\*/i;

/** A host's token set, kept only where the name is a known theme token and the value cannot load, run or escape anything. */
export function acceptedTokens(tokens: unknown): readonly (readonly [string, string])[] {
  if (!tokens || typeof tokens !== 'object') return [];
  return Object.entries(tokens).filter((entry): entry is [string, string] => {
    const [name, value] = entry;
    return TOKEN.test(name) && typeof value === 'string' && VALUE.test(value) && !FORBIDDEN.test(value);
  });
}

function applyTheme(theme: unknown) {
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

/** `?theme=light|dark`, then `{ boring: 'pm-theme', theme?, tokens? }` at any time from an allowlisted parent. Without either the app's tokens stand. */
export function usePmHostTheme(origins: readonly string[]): void {
  const key = origins.join(' ');
  useEffect(() => {
    applyTheme(new URLSearchParams(window.location.search).get('theme'));
    if (window.parent === window) return;
    const allowed = key.split(' ');
    const listen = (event: MessageEvent) => {
      const data = event.data as { boring?: unknown; theme?: unknown; tokens?: unknown } | null;
      if (event.source !== window.parent || !allowed.includes(event.origin) || data?.boring !== 'pm-theme') return;
      applyTheme(data.theme);
      for (const [name, value] of acceptedTokens(data.tokens)) document.documentElement.style.setProperty(name, value);
    };
    window.addEventListener('message', listen);
    // The parent may be waiting for this frame before it sends its look.
    const parent = window.location.ancestorOrigins?.[0] ?? (document.referrer ? new URL(document.referrer).origin : undefined);
    if (parent && allowed.includes(parent)) window.parent.postMessage({ boring: 'pm-ready' }, parent);
    return () => window.removeEventListener('message', listen);
  }, [key]);
}
