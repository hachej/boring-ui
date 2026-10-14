'use client';

import { useEffect } from 'react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';

const PREFIX = 'pi-chat:draft:';

// localStorage can be missing, throw (private windows, blocked site data) or be full: the draft then lives only in the composer.
function read(storageKey: string): string | undefined {
  try { return globalThis.localStorage?.getItem(storageKey) ?? undefined; } catch { return undefined; }
}
function write(storageKey: string, text: string): void {
  try { if (text) globalThis.localStorage?.setItem(storageKey, text); else globalThis.localStorage?.removeItem(storageKey); } catch { /* the composer still holds the text */ }
}

/**
 * Keeps the composer's half-typed message (the controller's draft) per conversation in localStorage, so it survives a reload and shows in
 * every tab on the same conversation (the `storage` event). The draft is emptied when a message is sent, and a refused send puts the text back,
 * which is written again. Without `key` nothing happens. Storage that is missing or throws only means the draft is not kept.
 *
 * Restores the saved draft when the controller's composer is empty at mount. A change of `key` with the same controller keeps the text
 * already typed (it moves to the new conversation), so pass a new controller per conversation, as `PiChat` consumers do.
 */
export function useChatDraft(controller: NativeChatController, key: string | undefined): void {
  useEffect(() => {
    if (key === undefined || controller.getSnapshot().disposed) return;
    const storageKey = PREFIX + key;
    // The text last known to be in storage; a write happens only when the composer's text differs from it.
    let saved = controller.getSnapshot().draft.text;
    if (!saved) {
      const restored = read(storageKey);
      if (restored) { controller.setText(restored); saved = restored; }
    }
    const persist = () => {
      if (controller.getSnapshot().disposed) return;
      const text = controller.getSnapshot().draft.text;
      if (text === saved) return;
      saved = text;
      write(storageKey, text);
    };
    const unsubscribe = controller.subscribe(persist);
    // Another tab changed this conversation's draft (or cleared all storage: `key` is null). Adopting it does not write it back.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) return;
      if (controller.getSnapshot().disposed) return;
      const next = read(storageKey) ?? '';
      if (next === controller.getSnapshot().draft.text) { saved = next; return; }
      saved = next;
      controller.setText(next);
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      unsubscribe();
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }, [controller, key]);
}
