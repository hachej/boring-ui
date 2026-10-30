import { createRoot } from 'react-dom/client';
import { createRoomSource, createSharedChat } from '@hachej/boring-ui-kit/shared-chat';
import type { PmReadArtifact } from '../../registry/pm-panel/pm-mockups';
import { RoomPresentation } from './shared-room-mockups';

const source = await createRoomSource({ url: location.origin, reconnectMs: 50,
  fetch: request => { request.headers.set('x-room-person', 'person:ana'); return fetch(request); },
  open: url => { url.searchParams.set('person', 'person:ana'); return new WebSocket(url); },
});
const controller = createSharedChat(source, { conversationId: 'main' });
const read: PmReadArtifact = async (artifact, signal) => {
  // The fixture host's reader; a real host rechecks requester/task rights at its own read door.
  const response = await fetch('/mockup', { method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ target: artifact.target, revision: { kind: 'exact', value: artifact.revision } }) });
  if (!response.ok) return undefined;
  const body = await response.json();
  return body.revision === artifact.revision ? body.html : undefined;
};
createRoot(document.getElementById('root')!).render(<RoomPresentation key="fictional-app:ana:controller-1" controller={controller} read={read} />);
