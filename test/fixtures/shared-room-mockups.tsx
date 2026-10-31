'use client';
// Fictional host wiring: the room's exact reader and borrowed controller use the kit's ordinary cards, workspace and artifact panel.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import type { ResourceClient } from '@hachej/boring-files';
import type { SharedChatController } from '@hachej/boring-ui-kit/shared-chat';
import type { ArtifactDescriptor, PresentedArtifact } from '@hachej/boring-ui-kit/chat-view';
import { SharedChat } from '../../registry/shared-chat/shared-chat';
import { artifactCards } from '../../registry/pi-artifacts/artifact-card';
import { ArtifactWorkspace } from '../../registry/pi-workspace/workspace';
import { ArtifactPanel } from '../../registry/pi-app/artifact-panel';
import { defaultKinds } from '../../registry/pi-app-kinds/pi-app-kinds';
import { ViewerWindowProvider } from '../../registry/viewer-frame/viewer-frame';

export type ReadArtifact = (artifact: ArtifactDescriptor, signal: AbortSignal) => Promise<string | undefined>;
const kinds = defaultKinds();
const identity = { runtimeId: 'fictional-room', scopeId: 'fictional-app', principalId: 'person:ana', initiatorId: 'person:ana' };
const descriptorKey = (artifact: ArtifactDescriptor) => JSON.stringify([artifact.target, artifact.revision]);

export function RoomPresentation({ controller, read }: { readonly controller: SharedChatController; readonly read: ReadArtifact }) {
  const [selected, select] = useState<ArtifactDescriptor>();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const shown = selected && state.shared.messages.some(message => !message.removed && message.artifacts?.some(artifact => JSON.stringify(artifact) === JSON.stringify(selected))) ? selected : undefined;
  const artifacts = useMemo(() => ({ ...artifactCards, kinds,
    open: (artifact: PresentedArtifact) => { if (artifact.type !== 'task') select(artifact); },
    isOpen: (artifact: PresentedArtifact) => shown !== undefined && artifact.type !== 'task' && descriptorKey(artifact) === descriptorKey(shown),
  }), [shown]);
  const client = useMemo<ResourceClient>(() => ({ read: async (request, signal) => {
    // This fixture has immutable attachments only: no latest, cross-target aliases or mutation capability.
    if (!shown || request.revision.kind !== 'exact' || request.revision.value !== shown.revision || JSON.stringify(request.target) !== JSON.stringify(shown.target)) return { kind: 'denied', reason: 'Only the selected exact attachment is available' };
    const text = await read(shown, signal ?? new AbortController().signal);
    if (signal?.aborted) return { kind: 'unavailable', reason: 'The read was cancelled' };
    return text === undefined ? { kind: 'missing' } : { kind: 'available', snapshot: { ref: { ...shown.target, revision: shown.revision }, bytes: new TextEncoder().encode(text), mediaType: shown.mediaType } };
  } }), [shown, read]);
  const options = useMemo(() => ({ client, identity, kinds, interactive: { scriptSources: [] } }), [client]);
  return <ArtifactWorkspace open={shown !== undefined} onClose={() => select(undefined)} chat={<SharedChat controller={controller} artifacts={artifacts} />}
    panel={window => shown && <ViewerWindowProvider value={{ fullscreen: window.fullscreen, onFullscreenChange: window.onFullscreenChange, ...(window.sheet ? { labels: { close: 'Back to chat' }, icons: { close: ArrowLeftIcon } } : {}) }}>
      <ArtifactPanel key={descriptorKey(shown)} active={{ conversation: 'main', descriptor: shown, follow: false }} versions={[shown]} options={options} onSelect={() => {}} onClose={window.close} />
    </ViewerWindowProvider>} />;
}
