import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ResourceClient, ResourceLocator, ResourceSnapshot } from '@hachej/boring-files';

const POLL_MS = 1500;
const readText = (bytes: Uint8Array): string | undefined => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; } };

/** What a viewer controller exposes to `useSaved`: its buffer state (never replaced while dirty or saving) and teardown. */
export interface SavedController {
  readonly getSnapshot: () => { readonly dirty?: boolean; readonly save?: { readonly kind: string }; readonly base?: { readonly kind: string; readonly target?: object } };
  readonly dispose: () => void;
}

export type SavedState<C extends SavedController> =
  | { readonly kind: 'loading' | 'missing' | 'denied' | 'unavailable' | 'invalid'; readonly text?: undefined; readonly controller?: undefined }
  | { readonly kind: 'open'; readonly snapshot: ResourceSnapshot; readonly text: string; readonly controller: C | undefined };

/**
 * The saved text of one resource: the latest revision (polled while the local buffer is clean, never replacing unsaved
 * edits) or one exact revision read once. `create` may return a viewer controller for each saved snapshot; it is disposed when
 * a newer revision replaces it and on unmount.
 */
export function useSaved<C extends SavedController = SavedController>({ client, target, revision, create }: {
  readonly client: ResourceClient;
  readonly target: ResourceLocator;
  readonly revision?: string | undefined;
  readonly create?: ((snapshot: ResourceSnapshot) => C) | undefined;
}): SavedState<C> {
  const key = JSON.stringify([target.resource.providerId, target.resource.path, target.view.kind, target.view.kind === 'working' ? target.view.viewId : null, revision]);
  const binding = useMemo(() => ({ client, key, create }), [client, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { binding.create = create; }, [binding, create]);
  const [stored, setStored] = useState<{ readonly binding: typeof binding; readonly state: SavedState<C> }>();
  useEffect(() => {
    let cancelled = false, reading = false;
    let state: SavedState<C> = { kind: 'loading' };
    const update = (next: SavedState<C>) => { state = next; setStored({ binding, state }); };
    update(state);
    const follow = async () => {
      if (cancelled || reading) return;
      const now = state;
      const before = now.kind === 'open' ? now.controller?.getSnapshot() : undefined;
      if (before && (before.dirty || before.save?.kind === 'pending')) return;
      reading = true;
      let read;
      try { read = await client.read({ target, revision: revision ? { kind: 'exact', value: revision } : { kind: 'latest' } }).catch(() => undefined); }
      finally { reading = false; }
      if (cancelled || !read || state !== now) return;
      const local = now.kind === 'open' ? now.controller?.getSnapshot() : undefined;
      if (local !== before) return;
      if (read.kind !== 'available') { if (now.kind !== 'open') update({ kind: read.kind }); return; }
      if (now.kind === 'open') {
        if (now.snapshot.ref.revision === read.snapshot.ref.revision) return;
        if (local?.base?.kind === 'revision' && (local.base.target as { readonly revision?: string } | undefined)?.revision === read.snapshot.ref.revision) return;
        now.controller?.dispose();
      }
      const text = readText(read.snapshot.bytes);
      if (text === undefined) { update({ kind: 'invalid' }); return; }
      let controller: C | undefined;
      try { controller = binding.create?.(read.snapshot); } catch { update({ kind: 'invalid' }); return; }
      update({ kind: 'open', snapshot: read.snapshot, text, controller });
    };
    void follow();
    const timer = revision ? undefined : setInterval(() => { void follow(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); state.controller?.dispose(); };
  }, [binding]); // eslint-disable-line react-hooks/exhaustive-deps
  return stored?.binding === binding ? stored.state : { kind: 'loading' };
}

/** A save time for a person: the clock time (with seconds, so two quick saves differ) today, the date as well on another day. */
export function savedLabel(savedAt: number | undefined, now = Date.now(), earlier = 'Earlier version'): string {
  if (!savedAt) return earlier;
  const day = (value: number) => new Date(value).toDateString();
  return new Date(savedAt).toLocaleString([], day(savedAt) === day(now) ? { timeStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'medium' });
}
