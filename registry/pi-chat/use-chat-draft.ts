'use client';

import { useEffect, useRef } from 'react';
import type { ChatController } from '@hachej/boring-ui-kit/native-chat';

const PREFIX = 'pi-chat:draft:';

/** The stored draft: a string, `null` when the key is missing, `undefined` when storage is unavailable (missing, blocked or throwing). */
function read(storageKey: string): string | null | undefined {
  try {
    const storage = globalThis.localStorage;
    return storage ? storage.getItem(storageKey) : undefined;
  } catch { return undefined; }
}
function write(storageKey: string, text: string): void {
  try { if (text) globalThis.localStorage?.setItem(storageKey, text); else globalThis.localStorage?.removeItem(storageKey); } catch { /* the composer still holds the text */ }
}

/**
 * Keeps the composer's half-typed message (the controller's draft) per conversation in localStorage, so it survives a reload and shows in
 * every tab on the same conversation (the `storage` event). The draft is emptied when a message is sent, and a refused send puts the text back,
 * which is written again. Without `key` nothing happens. Storage that is missing or throws only means the draft is not kept.
 *
 * On mount the conversation's saved draft replaces the composer's text; text already in the composer and not yet saved is written at once.
 * On a change of `key` (same controller) the composer shows the new conversation's saved draft, or an empty one, so no text moves across.
 */
export function useChatDraft(controller: ChatController, key: string | undefined): void {
  // The key the hook last loaded; a different key on a later run is a conversation switch, not a first mount.
  const loaded = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (key === undefined || controller.getSnapshot().disposed) return;
    const storageKey = PREFIX + key;
    const switched = loaded.current !== undefined && loaded.current !== key;
    loaded.current = key;
    const stored = read(storageKey);
    const current = controller.getSnapshot().draft.text;
    // The text last known to be in storage; a write happens only when the composer's text differs from it.
    let saved: string;
    if (stored) {
      if (stored !== current) controller.setText(stored);
      saved = stored;
    } else if (switched) {
      // The new conversation has no saved draft (or storage is unavailable): the old conversation's text must not stay.
      if (current) controller.setText('');
      saved = '';
    } else {
      saved = current;
      if (stored === null && current) write(storageKey, current);
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
    // Unavailable storage is not a missing draft: the composer keeps its text.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) return;
      if (controller.getSnapshot().disposed) return;
      const next = read(storageKey);
      if (next === undefined) return;
      const text = next ?? '';
      saved = text;
      if (text !== controller.getSnapshot().draft.text) controller.setText(text);
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      unsubscribe();
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }, [controller, key]);
}
