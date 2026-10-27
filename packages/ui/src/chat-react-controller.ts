'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type ConversationControllerState<C> =
  | { readonly status: 'connecting' }
  | { readonly status: 'offline'; readonly error: unknown }
  | { readonly status: 'ready'; readonly controller: C };

export interface ControllerPerConversationOptions<C extends { readonly dispose: () => unknown }> {
  /** Stable selection identity, including source/owner and relevant options. Undefined acquires nothing. */
  readonly key: unknown;
  readonly create: () => C | Promise<C>;
  readonly connect?: ((controller: C) => Promise<void>) | undefined;
  /** Defaults to the concrete controller's dispose. Must release only resources created by this binding. */
  readonly dispose?: ((controller: C) => unknown) | undefined;
  readonly retryMs?: number | undefined;
}

/** Owns only the selected adapter, never its borrowed Harness/source. Late acquisitions are released, not published. */
export function useControllerPerConversation<C extends { readonly dispose: () => unknown }>(options: ControllerPerConversationOptions<C>): ConversationControllerState<C> {
  const { key, retryMs = 1000 } = options;
  const binding = useMemo(() => ({ key }), [key, retryMs]);
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const [stored, setStored] = useState<{ readonly binding: typeof binding; readonly state: ConversationControllerState<C> }>();
  useEffect(() => {
    if (key === undefined) return;
    // Capture ownership callbacks for this selection; later renders must not redirect its teardown.
    const { create, connect, dispose } = latest.current;
    let off = false, owned: C | undefined, retiring: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined, wake: (() => void) | undefined;
    const publish = (state: ConversationControllerState<C>) => { if (!off) setStored({ binding, state }); };
    const retire = () => {
      if (retiring) return retiring;
      const controller = owned; owned = undefined;
      if (!controller) return Promise.resolve();
      retiring = Promise.resolve().then(() => dispose ? dispose(controller) : controller.dispose()).then(() => {});
      return retiring;
    };
    void (async () => {
      while (!off) {
        try {
          owned = await create();
          if (off) { await retire(); return; }
          await connect?.(owned);
          if (off) { await retire(); return; }
          publish({ status: 'ready', controller: owned });
          return;
        } catch (error) {
          try { await retire(); } catch (teardownError) { console.error('Chat controller teardown failed', teardownError); }
          retiring = undefined;
          if (off) return;
          publish({ status: 'offline', error });
          await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, retryMs); });
          wake = undefined; timer = undefined;
        }
      }
    })();
    return () => {
      off = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      void retire().catch(error => console.error('Chat controller teardown failed', error));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- binding owns the selection; callback identity alone must not reconnect
  }, [binding, retryMs]);
  return stored?.binding === binding ? stored.state : { status: 'connecting' };
}
