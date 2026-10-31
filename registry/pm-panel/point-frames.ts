'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePointPage } from './use-point-page';
import type { PointPick, PointPin } from './use-point-page';
import type { PrivacyPolicy } from '@hachej/boring-feedback/page';
import type { PmText } from './pm-text';

// Pointing across two sibling frames of one host page: the PM in one (`?pm=standalone`), the app in the other, both on the app's origin
// with the person's session. Delivery is `postMessage` restricted to this origin; a receiver also requires a sibling source, which keeps
// one person's two tabs apart, and the same app name. The parent page, whatever its origin, reads and sends nothing here.
const CHANNEL = 'boring-pm-point';
type ToApp = { readonly type: 'probe' } | { readonly type: 'state'; readonly picking: boolean; readonly pins: readonly PointPin[] };
type ToPm = { readonly type: 'here' } | { readonly type: 'pick'; readonly pick: PointPick } | { readonly type: 'unpick'; readonly id: string } | { readonly type: 'problem'; readonly message: string } | { readonly type: 'done' };

function siblings(): readonly Window[] {
  if (window.parent === window) return [];
  const frames = window.parent.frames, found: Window[] = [];
  for (let index = 0; index < frames.length; index++) { const frame = frames[index]; if (frame && frame !== window) found.push(frame); }
  return found;
}
const hostOrigin = () => window.location.ancestorOrigins?.[0] ?? (document.referrer ? new URL(document.referrer).origin : undefined);
/** To the page holding the frames: no content, only that pointing started, stopped or landed. A phone shows one frame at a time and switches on this. */
function tellHost(boring: 'pm-pointing' | 'pm-picked', picking?: boolean): void {
  const parent = hostOrigin();
  if (parent) window.parent.postMessage({ boring, ...(picking === undefined ? {} : { picking }) }, parent);
}
const post = (target: Window, app: string, message: ToApp | ToPm) => target.postMessage({ channel: CHANNEL, app, message }, window.location.origin);
function received<T>(event: MessageEvent, app: string): { readonly message: T; readonly source: Window } | undefined {
  const source = event.source as Window | null;
  if (event.origin !== window.location.origin || !source || source === window || window.parent === window || source.parent !== window.parent) return undefined;
  const data = event.data as { channel?: unknown; app?: unknown; message?: T } | null;
  return data?.channel === CHANNEL && data.app === app && data.message ? { message: data.message, source } : undefined;
}

interface PmSide {
  readonly enabled: boolean;
  readonly app: string;
  readonly picking: boolean;
  readonly pins: readonly PointPin[];
  readonly onPick: (pick: PointPick) => void;
  readonly onUnpick: (id: string) => void;
  readonly onProblem: (message: string) => void;
  readonly onDone: () => void;
}

/** In the PM frame: tells the sibling app frame what to do, takes its picks. The result says an app frame answered. */
export function useAppFrame({ enabled, app, picking, pins, onPick, onUnpick, onProblem, onDone }: PmSide): boolean {
  const [frame, setFrame] = useState<Window>();
  const latest = useRef({ picking, pins, onPick, onUnpick, onProblem, onDone });
  useLayoutEffect(() => { latest.current = { picking, pins, onPick, onUnpick, onProblem, onDone }; });
  useEffect(() => {
    if (!enabled) return;
    const listen = (event: MessageEvent) => {
      // A host showing one frame at a time ends pointing once it comes back: « touch what you want » would point at nothing.
      if (event.source === window.parent && event.origin === hostOrigin() && (event.data as { boring?: unknown } | null)?.boring === 'pm-end-pointing') { latest.current.onDone(); return; }
      const got = received<ToPm>(event, app);
      if (!got) return;
      const { message, source } = got, current = latest.current;
      setFrame(source);
      if (message.type === 'here') post(source, app, { type: 'state', picking: current.picking, pins: current.pins });
      else if (message.type === 'pick') { current.onPick(message.pick); tellHost('pm-picked'); }
      else if (message.type === 'unpick') current.onUnpick(message.id);
      else if (message.type === 'problem') current.onProblem(message.message);
      else if (message.type === 'done') current.onDone();
    };
    window.addEventListener('message', listen);
    for (const sibling of siblings()) post(sibling, app, { type: 'probe' });
    return () => window.removeEventListener('message', listen);
  }, [enabled, app]);
  useEffect(() => { if (enabled && frame) post(frame, app, { type: 'state', picking, pins }); }, [enabled, frame, app, picking, pins]);
  useEffect(() => { if (enabled && window.parent !== window) tellHost('pm-pointing', picking); }, [enabled, picking]);
  useEffect(() => {
    if (!enabled || !frame) return;
    const release = () => post(frame, app, { type: 'state', picking: false, pins: [] });
    window.addEventListener('pagehide', release);
    return () => { window.removeEventListener('pagehide', release); release(); };
  }, [enabled, frame, app]);
  return Boolean(frame);
}

const noPins: readonly PointPin[] = [];

/** In the app frame: only the page half runs here, for the PM of a sibling frame. `onStart`: it began pointing, this frame's own PM steps aside. */
export function useSiblingPointing({ app, page, screen, policy, text, onStart }: { readonly app: string; readonly page: HTMLElement | null; readonly screen: string; readonly policy: PrivacyPolicy; readonly text: PmText; readonly onStart: () => void }): void {
  const [session, setSession] = useState<{ readonly source: Window; readonly picking: boolean; readonly pins: readonly PointPin[] }>();
  const starting = useRef(onStart);
  useLayoutEffect(() => { starting.current = onStart; });
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const got = received<ToApp>(event, app);
      if (!got) return;
      const { message, source } = got;
      if (message.type === 'probe') { post(source, app, { type: 'here' }); return; }
      if (message.picking) starting.current();
      setSession({ source, picking: message.picking, pins: message.pins });
    };
    window.addEventListener('message', listen);
    for (const sibling of siblings()) post(sibling, app, { type: 'here' });
    return () => window.removeEventListener('message', listen);
  }, [app]);
  const source = session?.source, picking = session?.picking ?? false;
  useEffect(() => {
    if (!source || !picking) return;
    // A removed PM frame may never get to say so: the page must not stay stuck picking.
    const timer = setInterval(() => { if (source.closed) setSession(undefined); }, 2000);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) post(source, app, { type: 'done' }); };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(timer); window.removeEventListener('keydown', onKey); };
  }, [source, picking, app]);
  const send = (message: ToPm) => { if (source) post(source, app, message); };
  usePointPage({ picking, pins: session?.pins ?? noPins, page, screen, policy, text,
    onPick: pick => send({ type: 'pick', pick }), onUnpick: id => send({ type: 'unpick', id }), onProblem: message => send({ type: 'problem', message }) });
}
