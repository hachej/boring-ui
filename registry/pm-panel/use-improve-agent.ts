'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRemoteChat } from '@hachej/boring-ui-kit/chat-react';
import type { ChatIdentity } from '@hachej/boring-ui-kit/native-chat';
import type { ImproveSpec, PmTranscript } from './use-pm-panel';

/**
 * The one line an app writes: `improve: { agent: 'pm' }`. The kit opens that agent's conversation through the app's own door
 * (hachej/boring-factory#854), same origin and as the signed-in person: `GET {base}/agent` (identity), `{base}/conversations`
 * (the viewer's latest, created when there is none), `{base}/chat?conversation=` (the native chat wire) and `POST {base}/transcribe`.
 */
export interface ImproveAgent {
  readonly agent: string;
  /** Default `/api/{agent}`. */
  readonly base?: string;
}
export type ImproveProp = ImproveSpec | ImproveAgent;
export const isImproveAgent = (value: ImproveProp | undefined): value is ImproveAgent => !!value && 'agent' in value && typeof value.agent === 'string' && !('controller' in value);

type Door = { readonly identity: ChatIdentity; readonly conversationId: string } | { readonly error: string };
const sameOrigin = (request: Request) => fetch(new Request(request, { credentials: 'same-origin' }));

async function openDoor(base: string, signal: AbortSignal): Promise<Door> {
  const json = async (response: Response) => { if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json() as Promise<Record<string, unknown>>; };
  const descriptor = await json(await fetch(`${base}/agent`, { credentials: 'same-origin', signal }));
  const identity = (descriptor['identity'] ?? descriptor) as ChatIdentity;
  if (typeof identity?.runtimeId !== 'string' || typeof identity.scopeId !== 'string' || typeof identity.principalId !== 'string') throw new Error('The agent door returned no chat identity');
  const listed = await json(await fetch(`${base}/conversations`, { credentials: 'same-origin', signal }));
  const rows = (Array.isArray(listed['conversations']) ? listed['conversations'] : []) as { readonly id: string | number; readonly archived?: boolean; readonly updatedAt?: number }[];
  const latest = rows.filter(row => !row.archived).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  if (latest) return { identity, conversationId: String(latest.id) };
  const created = await json(await fetch(`${base}/conversations?op=create`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}', signal }));
  return { identity, conversationId: String(created['conversationId']) };
}

/** Resolves `{ agent }` once `active` (the first open), then keeps the controller. `undefined` while connecting or offline (`problem`). */
export function useImproveAgent(value: ImproveProp | undefined, active: boolean, defaults: { readonly appName?: string; readonly locale?: string }): { readonly spec: ImproveSpec | undefined; readonly problem: string | undefined } {
  const agent = isImproveAgent(value) ? value : undefined;
  const base = agent ? agent.base ?? `/api/${encodeURIComponent(agent.agent)}` : undefined;
  const [door, setDoor] = useState<{ readonly base: string; readonly door: Door }>();
  const [requested, setRequested] = useState(false);
  if (active && agent && !requested) setRequested(true);
  useEffect(() => {
    if (!base || !requested) return;
    const abort = new AbortController();
    openDoor(base, abort.signal).then(result => setDoor({ base, door: result }), (error: unknown) => { if (!abort.signal.aborted) setDoor({ base, door: { error: error instanceof Error ? error.message : String(error) } }); });
    return () => abort.abort();
  }, [base, requested]);
  const open = door && door.base === base && 'identity' in door.door ? door.door : undefined;
  const remote = useRemoteChat({ conversationId: open?.conversationId, endpoint: id => new URL(`${base}/chat?conversation=${encodeURIComponent(String(id))}`, location.href), fetch: sameOrigin, identity: open?.identity });
  const ready = remote.status === 'ready' ? remote : undefined;
  const spec = useMemo<ImproveSpec | undefined>(() => !agent ? value as ImproveSpec | undefined : ready ? {
    controller: ready.controller, ...(defaults.appName ? { appName: defaults.appName } : {}),
    chatProps: { actions: ready.actions, showHistory: false, ...(defaults.locale ? { locale: defaults.locale as 'fr' } : {}) },
    pointVoice: { transcribe: async (audio: Blob, signal: AbortSignal): Promise<string | PmTranscript> => {
      const response = await fetch(`${base}/transcribe`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': audio.type || 'application/octet-stream' }, body: audio, signal });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const result = await response.json() as PmTranscript | { readonly text?: string };
      return typeof result.text === 'string' ? result as PmTranscript : '';
    } },
  } : undefined, [agent, value, ready, base, defaults.appName, defaults.locale]);
  const problem = door && 'error' in door.door ? door.door.error : remote.status === 'offline' ? remote.error : undefined;
  return { spec, problem };
}
