'use client';

// `chatProps.artifacts.autoOpenTasks` on the one composer: while the agent's `present` of a task waits, the host's `artifacts.open` is asked for the task's viewer once, with the layer's reports
// (the viewer must still report its mount or its failure). What the old floating window did for a host that shows tasks in its own viewer.
import { useEffect, useRef } from 'react';
import { useChatView } from '@hachej/boring-ui-kit/chat-react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createTaskArtifact, pendingPresents } from '../pi-artifacts/artifact';
import type { ArtifactHostViewApi, ArtifactsConfig } from '../pi-artifacts/artifact';

export function useAutoOpenTasks(controller: NativeChatController, host: ArtifactsConfig | undefined, reports: ArtifactHostViewApi | undefined): void {
  const pending = useChatView(controller, pendingPresents);
  const requested = useRef(new WeakMap<NativeChatController, Set<string>>());
  useEffect(() => {
    if (!host?.autoOpenTasks || !reports) return;
    let asked = requested.current.get(controller);
    if (!asked) { asked = new Set(); requested.current.set(controller, asked); }
    for (const call of pending) {
      if (!('subject' in call) || asked.has(call.id)) continue;
      asked.add(call.id);
      host.open(createTaskArtifact(call.subject), reports);
    }
  }, [controller, host, pending, reports]);
}
