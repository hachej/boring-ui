'use client';
// Fictional host wiring, not a second renderer. The host owns the reader, binding key and borrowed controller.
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { SharedChatController } from '@hachej/boring-ui-kit/shared-chat';
import type { ArtifactDescriptor } from '@hachej/boring-ui-kit/chat-view';
import { SharedChat } from '../../registry/shared-chat/shared-chat';
import { PmMockupProvider, PmMockupView, pmArtifacts } from '../../registry/pm-panel/pm-mockups';
import type { PmReadArtifact } from '../../registry/pm-panel/pm-mockups';
import { pmTextFor } from '../../registry/pm-panel/pm-text';

export function RoomPresentation({ controller, read }: { readonly controller: SharedChatController; readonly read: PmReadArtifact }) {
  const [selected, select] = useState<ArtifactDescriptor>();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const shown = selected && state.shared.messages.some(message => !message.removed && message.artifacts?.some(artifact => JSON.stringify(artifact) === JSON.stringify(selected))) ? selected : undefined;
  const artifacts = useMemo(() => pmArtifacts(select, shown), [shown]);
  const text = pmTextFor('en');
  return <PmMockupProvider read={read} text={text}>
    {shown ? <PmMockupView artifact={shown} text={text} onBack={() => select(undefined)} />
      : <SharedChat controller={controller} artifacts={artifacts} />}
  </PmMockupProvider>;
}
