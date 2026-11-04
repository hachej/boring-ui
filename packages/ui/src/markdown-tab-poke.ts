import { useEffect } from 'react';
import type { MarkdownController, MarkdownState } from './markdown.js';

function channelName({ base: { target: { resource, view } }, identity }: MarkdownState): string {
  return `boring-markdown:${JSON.stringify([identity.scopeId, resource.providerId, resource.path, view.kind, view.kind === 'working' ? view.viewId : null])}`;
}

/**
 * Optional nudge between tabs of one note in one browser. A saved revision goes out and the receiver only runs its existing refresh,
 * which never overwrites unsaved text and never saves, so a poke cannot start another one. No document text crosses the channel.
 */
export function useMarkdownTabPoke(controller: MarkdownController, enabled: boolean): void {
  useEffect(() => {
    const Channel = globalThis.BroadcastChannel;
    if (!enabled || typeof Channel !== 'function') return;
    const opening = controller.getSnapshot();
    if (opening.lifecycle !== 'active') return;
    let channel: BroadcastChannel;
    try { channel = new Channel(channelName(opening)); } catch { return; }
    // A listening channel must not hold a server-side process open.
    (channel as { unref?: () => void }).unref?.();
    const receive = (event: MessageEvent<unknown>) => {
      const revision = (event.data as { revision?: unknown } | null | undefined)?.revision;
      const state = controller.getSnapshot();
      if (typeof revision !== 'string' || state.lifecycle !== 'active') return;
      const known = (expectation: MarkdownState['base'] | null) => expectation?.kind === 'revision' && expectation.target.revision === revision;
      if (known(state.base) || known(state.remote)) return;
      void controller.actions.refresh().catch(() => {});
    };
    channel.addEventListener('message', receive);
    let announced = opening.save;
    const stop = controller.subscribe(() => {
      const { save } = controller.getSnapshot();
      if (save === announced || save.kind !== 'settled' || save.result.kind !== 'saved') return;
      announced = save;
      try { channel.postMessage({ revision: save.result.ref.revision }); } catch { /* A tab that cannot tell the others still saved. */ }
    });
    return () => {
      stop();
      channel.removeEventListener('message', receive);
      try { channel.close(); } catch { /* Nothing is left to stop. */ }
    };
  }, [controller, enabled]);
}
