// Where the chat is placed, reported by the component that shows it and sent with each submit (`useRemoteChat` adds it to the request context).
// `PiChat` reports `docked`, `AmbientChat` (also a docked chat floated by its divider) reports `floating`. Advisory for the model, never authority.
// See docs/architecture/PAGE-TOOLS.md (PLACE-1..3).
import { useLayoutEffect } from 'react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';

export type ChatPlacement = 'docked' | 'floating';

// Keyed by controller: a page can hold several chats, and floating or docking keeps the controller (PLACE-3).
const placements = new WeakMap<NativeChatController, ChatPlacement>();

/** Reports the placement of the chat showing `controller` while the caller is mounted. */
export function useChatPlacement(controller: NativeChatController, placement: ChatPlacement): void {
  useLayoutEffect(() => {
    placements.set(controller, placement);
    return () => { if (placements.get(controller) === placement) placements.delete(controller); };
  }, [controller, placement]);
}

export function readChatPlacement(controller: NativeChatController | undefined): ChatPlacement | undefined {
  return controller ? placements.get(controller) : undefined;
}
