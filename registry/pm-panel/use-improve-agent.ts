'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRemoteChat } from '@hachej/boring-ui-kit/chat-react';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import type { RevisionProvider } from '@hachej/boring-files/revision';
import type { PmReadArtifact } from './pm-mockups';
import type { ChatIdentity } from '@hachej/boring-ui-kit/native-chat';
import type { ImproveSpec, PmTranscript } from './use-pm-panel';
import { useHostTasks } from './pm-task-source';
import { pmTextFor } from './pm-text';

/**
 * The one line an app writes: `improve: { agent: 'pm' }`. The kit opens that agent's conversation through the app's own door
 * (hachej/boring-factory#854), same origin and as the signed-in person: `GET {base}/agent` (identity), `{base}/conversations`
 * (the viewer's latest, created when there is none) and `{base}/chat?conversation=` (the native chat wire). Dictation is the host's, not
 * the agent's: `POST api/host/transcribe?language=` (audio body, answers `{ text, segments? }`). The viewer's requests are the host's task
 * API, `_tasks/api` (see `pm-task-source.tsx`; a 404 or 403 is « unavailable for now », read again later). The files the PM presents
 * (`present`) are read through the door's revision route, `{base}/resources` (`connectRevisionProvider`, on the first mockup shown).
 * Every path is relative to the page, like the app's own `api()` calls: the host may serve the app under a prefix (`/apps/<app>/`,
 * `/preview/<sha>/`).
 */
export interface ImproveAgent {
  readonly agent: string;
  /** Default `api/{agent}`, relative to the page; resolved against `document.baseURI` (so `/api/pm` stays at the origin's root). */
  readonly base?: string;
}
export type ImproveProp = ImproveSpec | ImproveAgent;
export const isImproveAgent = (value: ImproveProp | undefined): value is ImproveAgent => !!value && 'agent' in value && typeof value.agent === 'string' && !('controller' in value);

/** A path of the app, resolved like the app's own requests: against the page (`document.baseURI`), never the origin's root. */
const appUrl = (path: string) => new URL(path, document.baseURI).href;

type Door = { readonly identity: ChatIdentity; readonly conversationId: string } | { readonly error: string };
const sameOrigin = (request: Request) => fetch(new Request(request, { credentials: 'same-origin' }));

async function openDoor(path: string, signal: AbortSignal): Promise<Door> {
  const json = async (response: Response) => { if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json() as Promise<Record<string, unknown>>; };
  const base = appUrl(path);
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

/** Reads presented files through the door's revision route, connecting on the first read (and again after a failed connection). */
function artifactReader(endpoint: string): PmReadArtifact {
  let provider: Promise<RevisionProvider> | undefined;
  return async (artifact, signal) => {
    const connecting = provider ??= connectRevisionProvider({ endpoint, fetch: sameOrigin });
    try {
      const read = await (await connecting).read({ target: artifact.target, revision: { kind: 'exact', value: artifact.revision } }, signal);
      return read.kind === 'available' ? new TextDecoder().decode(read.snapshot.bytes) : undefined;
    } catch (error) { if (provider === connecting) provider = undefined; throw error; }
  };
}

/** Resolves `{ agent }` once `active` (the first open), then keeps the controller. `undefined` while connecting or offline (`problem`). */
export function useImproveAgent(value: ImproveProp | undefined, active: boolean, defaults: { readonly appName?: string; readonly locale?: string }): { readonly spec: ImproveSpec | undefined; readonly problem: string | undefined; readonly retry: () => void } {
  const agent = isImproveAgent(value) ? value : undefined;
  const base = agent ? agent.base ?? `api/${encodeURIComponent(agent.agent)}` : undefined;
  const [door, setDoor] = useState<{ readonly base: string; readonly door: Door }>();
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setDoor(undefined); setAttempt(value => value + 1); }, []);
  if (active && agent && !requested) setRequested(true);
  useEffect(() => {
    if (!base || !requested) return;
    const abort = new AbortController();
    openDoor(base, AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)])).then(result => setDoor({ base, door: result }), (error: unknown) => { if (!abort.signal.aborted) setDoor({ base, door: { error: error instanceof Error ? error.message : String(error) } }); });
    return () => abort.abort();
  }, [base, requested, attempt]);
  const open = door && door.base === base && 'identity' in door.door ? door.door : undefined;
  const remote = useRemoteChat({ conversationId: open?.conversationId, endpoint: id => new URL(`${appUrl(base ?? '')}/chat?conversation=${encodeURIComponent(String(id))}`), fetch: sameOrigin, identity: open?.identity });
  const ready = remote.status === 'ready' ? remote : undefined;
  const opened = Boolean(open);
  const readArtifact = useMemo<PmReadArtifact | undefined>(() => {
    return base && opened ? artifactReader(appUrl(`${base}/resources`)) : undefined;
  }, [base, opened]);
  const tasks = useHostTasks(open ? appUrl('_tasks/api') : undefined, open?.identity.principalId, ready?.controller, pmTextFor(defaults.locale));
  const spec = useMemo<ImproveSpec | undefined>(() => !agent ? value as ImproveSpec | undefined : ready ? {
    controller: ready.controller, ...(defaults.appName ? { appName: defaults.appName } : {}), ...(tasks ? { tasks } : {}), ...(readArtifact ? { readArtifact } : {}),
    chatProps: { actions: ready.actions, showHistory: false, ...(defaults.locale ? { locale: defaults.locale as 'fr' } : {}) },
    pointVoice: { transcribe: async (audio: Blob, signal: AbortSignal): Promise<string | PmTranscript> => {
      const response = await fetch(appUrl(`api/host/transcribe${defaults.locale ? `?language=${encodeURIComponent(defaults.locale)}` : ''}`), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': audio.type || 'application/octet-stream' }, body: audio, signal });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const result = await response.json() as PmTranscript | { readonly text?: string };
      return typeof result.text === 'string' ? result as PmTranscript : '';
    } },
  } : undefined, [agent, value, ready, tasks, readArtifact, defaults.appName, defaults.locale]);
  const problem = door && 'error' in door.door ? door.door.error : remote.status === 'offline' ? remote.error : undefined;
  return { spec, problem, retry };
}
