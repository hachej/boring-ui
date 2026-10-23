import type { ConversationView } from '@earendil-works/pi-durable';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ComponentType, ReactNode } from 'react';
import { defaultChatLabels } from '../pi-chat/labels';
import type { ChatArtifact, ChatArtifactsConfig } from '../pi-chat/config';

/*
 * Artifacts in the chat: substantial content (a document, an HTML page, an SVG, code, a canvas) that the transcript shows as a
 * card and the host opens in its own panel. The descriptor and `parseArtifact` mirror `@hachej/boring-agent/artifacts` on purpose: this
 * is a copied registry item and cannot import that package (it carries Pi runtime code). Keep the two validators in step;
 * `test/contracts/pi-chat-source.test.mjs` checks that they accept and refuse the same values.
 */
export const ARTIFACT_TYPES = ['markdown', 'html', 'svg', 'code', 'canvas'] as const;
export type ArtifactType = typeof ARTIFACT_TYPES[number];

/** Structural twin of the `ResourceLocator` in `@hachej/boring-files`. */
export interface ArtifactTarget {
  readonly resource: { readonly providerId: string; readonly path: string };
  readonly view: { readonly kind: 'published' } | { readonly kind: 'working'; readonly viewId: string };
}
export interface ArtifactDescriptor {
  readonly schema: 'boring.artifact';
  readonly version: 1;
  /** Set by the artifact tools; the descriptor of `present` has none (the file path is its identity). */
  readonly id?: string;
  readonly title: string;
  readonly type: ArtifactType;
  readonly mediaType: string;
  readonly language?: string;
  readonly target: ArtifactTarget;
  /** The revision this message produced. */
  readonly revision: string;
  /** The 1-based version number of this artifact (artifact tools only). */
  readonly ordinal?: number;
}

/** What identifies an artifact across its versions: its id, or for a presented file its path. */
export const artifactKey = (artifact: Pick<ArtifactDescriptor, 'id' | 'target'>): string => artifact.id ?? artifact.target.resource.path;

/**
 * What an artifact kind's renderer receives: the artifact and its text at the revision shown, the page's URL fragment without `#`
 * (a link such as `#screen=2` can open a place inside the artifact; the panel follows its changes), and `read`: another file of the same
 * workspace as text (its latest revision; undefined when it is missing or not text), for an artifact that links to a file. `revision` is
 * the shown revision, the one a conditional save is made against; `pinned` is true when the panel shows a pinned historical version,
 * which is read-only.
 */
export interface ArtifactKindViewProps {
  readonly artifact: ArtifactDescriptor;
  readonly text: string;
  readonly revision: string;
  readonly pinned: boolean;
  /**
   * The view is loaded and on screen. A kind with `waitsForReady` must call it (once per revision shown): only then does the page
   * acknowledge a `present` call for this file. Other kinds are acknowledged as soon as their file is read, and may ignore it.
   */
  readonly onReady?: (() => void) | undefined;
  /**
   * The view could not be shown (its data failed to load, for example), with a short reason for the agent (at most 200 characters are
   * sent). A `present` call waiting for this file is refused with that reason. A renderer that throws is reported the same way.
   */
  readonly onFailed?: ((reason: string) => void) | undefined;
  readonly fragment?: string | undefined;
  readonly read?: ((path: string) => Promise<string | undefined>) | undefined;
}

/**
 * An app's own kind of artifact (for example `.maquette.json` files): how its card and the panel name it, its icon, and optionally
 * how the panel draws it. Kinds are consulted in order before the built-in types; the first whose `match` is true wins. A kind
 * adds a presentation only: the descriptor, its type and how it is read are unchanged.
 */
export interface ArtifactKind {
  /** True for the artifacts of this kind, for example `target => target.resource.path.endsWith('.maquette.json')`. */
  readonly match: (target: ArtifactTarget, artifact: ArtifactDescriptor) => boolean;
  /** The kind's name on the card and in the panel bar ("Maquette"). */
  readonly label: string;
  /** The card's icon (any component taking `className`, such as a lucide icon). The type's icon otherwise. */
  readonly icon?: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }> | undefined;
  /** Draws the artifact in the panel (`AgentWorkspace`, `ArtifactPanel`) inside the standard viewer bar, with copy and download. */
  readonly renderer?: ((props: ArtifactKindViewProps) => ReactNode) | undefined;
  /**
   * The renderer loads asynchronously (a dashboard fetching its data, a sandboxed frame): the panel confirms a `present` of this file
   * only after the renderer calls `onReady`, and refuses it when it calls `onFailed` or throws. With no call, the call ends unconfirmed.
   */
  readonly waitsForReady?: boolean | undefined;
}

/** The first kind that matches the artifact; a `match` that throws counts as no match. */
export function artifactKind(artifact: ArtifactDescriptor, kinds: readonly ArtifactKind[] | undefined): ArtifactKind | undefined {
  return kinds?.find(kind => { try { return kind.match(artifact.target, artifact); } catch { return false; } });
}

/** What the host passes to `PiChat` to turn artifact tool results into cards. */
export interface ArtifactsConfig {
  /** The app's own artifact kinds (label, icon, renderer), consulted before the built-in types. */
  readonly kinds?: readonly ArtifactKind[] | undefined;
  /** The person clicked a card: show this artifact (and revision) in the host's panel. */
  readonly open: (artifact: ArtifactDescriptor) => void;
  /** True for the card whose artifact version is on display. */
  readonly isOpen?: (artifact: ArtifactDescriptor) => boolean;
  /** Recognise a descriptor in a successful tool result that does not carry one itself (for example a document save). */
  readonly detect?: (call: ToolCall, result: ToolResultMessage) => ArtifactDescriptor | undefined;
  /** How the chat finds a call's artifact (`recogniseArtifact`). With `Card`, it is what makes `PiChat` offer artifacts; `artifactCards` sets both. */
  readonly recognise?: ChatArtifactsConfig['recognise'];
  /** The card the chat draws (`PluggedArtifactCard`). */
  readonly Card?: ChatArtifactsConfig['Card'];
}

export const PRESENT_TOOL = 'present';

/** A `present` call with no result yet, while its conversation runs: its answer ID (`[assistantEntryId, callId]`) and the path it names. */
export interface PendingPresent { readonly id: string; readonly callId: string; readonly path: string }

/** The path a `present` call or a page acknowledgement names, as the server compares it (a leading `./` is the same file). */
export const presentPath = (path: string): string => path.replace(/^\.\//, '');

/**
 * The `present` calls still waiting for the page (the server's view-open record, `@hachej/boring-agent/artifacts`). Mirrors
 * the preview's pending-call scan (the feedback plug-in's `pendingBrowserTasks`): a call with no result, in a conversation that is running.
 */
export function pendingPresents(view: { readonly entries: readonly { readonly id: number | bigint | string; readonly model?: readonly unknown[] | undefined }[]; readonly docs?: Readonly<Record<string, unknown>> } | undefined): readonly PendingPresent[] {
  if (!view) return [];
  const live = view.docs?.['pi.live'] as { readonly run?: unknown } | undefined;
  if (!live?.run) return [];
  const calls = new Map<string, PendingPresent>();
  for (const entry of view.entries) for (const message of entry.model ?? []) {
    const item = message as { readonly role?: string; readonly content?: unknown; readonly toolCallId?: string };
    if (item.role === 'assistant' && Array.isArray(item.content)) {
      for (const part of item.content as { type?: string; id?: string; name?: string; arguments?: Record<string, unknown> }[]) {
        const path = part.arguments?.['path'];
        if (part.type === 'toolCall' && part.name === PRESENT_TOOL && typeof part.id === 'string' && typeof path === 'string') {
          calls.set(part.id, { id: JSON.stringify([Number(entry.id), part.id]), callId: part.id, path: presentPath(path) });
        }
      }
    }
    if (item.role === 'toolResult' && typeof item.toolCallId === 'string') calls.delete(item.toolCallId);
  }
  return [...calls.values()];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LANGUAGE = /^[A-Za-z0-9+#._-]{1,32}$/;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** Strict shape check of an untrusted value. Returns a fresh copy or undefined. */
export function parseArtifact(value: unknown): ArtifactDescriptor | undefined {
  if (!isObject(value) || !hasOnly(value, ['schema', 'version', 'id', 'title', 'type', 'mediaType', 'language', 'target', 'revision', 'ordinal'])) return undefined;
  const { id, title, type, mediaType, language, target, revision, ordinal } = value;
  if (value['schema'] !== 'boring.artifact' || value['version'] !== 1) return undefined;
  if (id !== undefined && (typeof id !== 'string' || !ID.test(id))) return undefined;
  if (typeof title !== 'string' || !title.trim() || title.length > 200) return undefined;
  if (typeof type !== 'string' || !(ARTIFACT_TYPES as readonly string[]).includes(type)) return undefined;
  if (typeof mediaType !== 'string' || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mediaType)) return undefined;
  if (language !== undefined && (typeof language !== 'string' || !LANGUAGE.test(language))) return undefined;
  if (typeof revision !== 'string' || !revision || revision.length > 256) return undefined;
  if (ordinal !== undefined && (typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 1)) return undefined;
  if (!isObject(target) || !hasOnly(target, ['resource', 'view']) || !isObject(target['resource']) || !hasOnly(target['resource'], ['providerId', 'path'])) return undefined;
  const { providerId, path } = target['resource'];
  if (typeof providerId !== 'string' || !providerId || typeof path !== 'string' || !path || path.length > 512) return undefined;
  const view = target['view'];
  if (!isObject(view)) return undefined;
  let parsedView: ArtifactTarget['view'];
  if (view['kind'] === 'published' && hasOnly(view, ['kind'])) parsedView = { kind: 'published' };
  else if (view['kind'] === 'working' && hasOnly(view, ['kind', 'viewId']) && typeof view['viewId'] === 'string' && view['viewId']) parsedView = { kind: 'working', viewId: view['viewId'] };
  else return undefined;
  return { schema: 'boring.artifact', version: 1, ...(id === undefined ? {} : { id }), title, type: type as ArtifactType, mediaType, ...(language === undefined ? {} : { language: language as string }),
    target: { resource: { providerId, path }, view: parsedView }, revision, ...(ordinal === undefined ? {} : { ordinal }) };
}

/** The artifact's type name: the matching kind's label first, then the chat's name of its type. */
export function typeLabel(artifact: ArtifactDescriptor, kinds?: readonly ArtifactKind[], labels: Readonly<Record<ArtifactType, string>> = defaultChatLabels.artifactTypes): string {
  const kind = artifactKind(artifact, kinds);
  if (kind) return kind.label;
  return artifact.type === 'code' && artifact.language ? `${labels.code} · ${artifact.language}` : labels[artifact.type];
}

const textOf = (result: ToolResultMessage): string => result.content.map(part => part.type === 'text' ? part.text : '').join('');

/**
 * The descriptor a successful tool result carries: the host's `detect` first, then the `artifact` key of a JSON text result.
 * Failed results never produce one, and a host callback that throws or returns something malformed is ignored. Without
 * the host's `detect`, only a result of `present` counts: any other tool whose text happens
 * to be that JSON (an MCP tool, `cat x.json`) cannot forge a card. A host with renamed tools says so in `detect`.
 */
export function detectArtifact(call: ToolCall, result: ToolResultMessage, detect?: ArtifactsConfig['detect']): ArtifactDescriptor | undefined {
  if (result.isError) return undefined;
  if (detect) {
    try { const found = parseArtifact(detect(call, result)); if (found) return found; } catch { /* a faulty host callback shows no card */ }
  }
  if (call.name !== PRESENT_TOOL) return undefined;
  const text = textOf(result);
  if (!text.includes('"boring.artifact"')) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? parseArtifact(value['artifact']) : undefined;
  } catch { return undefined; }
}

/** The title a still-running `present` call announces in its streamed arguments: the file name. */
export function pendingTitle(call: ToolCall): string | undefined {
  const path = (call.arguments as Record<string, unknown>)['path'];
  const title = typeof path === 'string' ? path.slice(path.lastIndexOf('/') + 1) : undefined;
  return title?.trim() ? title.trim().slice(0, 200) : undefined;
}
/** What a still-running `present` call will show: the file path. */
export function pendingId(call: ToolCall): string | undefined {
  const path = (call.arguments as Record<string, unknown>)['path'];
  return typeof path === 'string' && path ? path.replace(/^(\.\/)+/, '') : undefined;
}

/**
 * Every artifact version a conversation's tool results produced, oldest first. Hosts use it to list the versions known
 * from the conversation (a version switcher); the chat itself shows only the last version of an artifact per turn.
 */
export function collectArtifacts(view: ConversationView | undefined, detect?: ArtifactsConfig['detect']): ArtifactDescriptor[] {
  const calls = new Map<string, ToolCall>(), found: ArtifactDescriptor[] = [];
  for (const entry of view?.entries ?? []) for (const message of entry.model ?? []) {
    if (message.role === 'assistant') for (const part of message.content) { if (part.type === 'toolCall') calls.set(part.id, part); }
    else if (message.role === 'toolResult') {
      const call = calls.get(message.toolCallId);
      const descriptor = call && detectArtifact(call, message, detect);
      if (descriptor) found.push(descriptor);
    }
  }
  return found;
}

/** What the host's chat answer returns: the kind is all the presents bookkeeping reads. */
export interface PresentAnswer { readonly kind: string }

export interface PresentAcksHost {
  /** The chat's `answer` (the transport's `?op=answer`); undefined when the host has none. */
  readonly answer: (id: string, answer: string) => Promise<PresentAnswer> | undefined;
  /** Open the file in the panel; false when the panel refuses (unsaved changes the person keeps). */
  readonly open: (path: string) => boolean;
  /** This page's identity in the acknowledgement. */
  readonly instanceId: string;
  /** Test seams: the wait between retries and the clock of the retry bound. Default: real timers. */
  readonly wait?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/** The page's state of the presents it must answer, as `AgentWorkspace` reads it on each change. */
export interface PresentContext {
  /** The person closed the panel in this turn. */
  readonly closedThisTurn: boolean;
  /** The open file has unsaved edits. */
  readonly unsaved: boolean;
  /** The screen is a phone (the panel is a sheet and is not opened for an agent). */
  readonly narrow: boolean;
  /** `autoOpen`: when false the panel is not opened for an agent; the call waits for a manual open. */
  readonly autoOpen: boolean;
  /** Whether the panel already shows this file. */
  readonly showing: (path: string) => boolean;
}

/**
 * The page's side of the view-open acknowledgement. A `present` call is confirmed only by a viewer's mount report (`shown`) of the
 * revision it names. A call is decided once; an answer the server denies (a revision the page showed before the agent wrote a new one)
 * keeps the call waiting for the next mount report, and an answer is retried briefly while the server has not recorded the call yet.
 */
export function createPresentAcks(host: PresentAcksHost) {
  const decided = new Set<string>();
  /** Calls waiting for their file's mount report: answer ID to path. */
  const mounting = new Map<string, string>();
  const wait = host.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = host.now ?? (() => Date.now());
  /** The last mount report: the file on screen and its revision. */
  let lastShown: { readonly path: string; readonly revision: string } | undefined;

  /** Sends one answer; returns the server's outcome kind, or undefined when it was not sent. Retries while the record is not written yet. */
  async function send(id: string, body: Record<string, string>): Promise<string | undefined> {
    const until = now() + 3000;
    for (;;) {
      try {
        const sent = host.answer(id, JSON.stringify(body));
        if (sent === undefined) return undefined;
        const outcome = await sent;
        if (outcome.kind !== 'unknown-question' || now() > until) return outcome.kind;
      } catch { return undefined; /* the call ends at its deadline as unconfirmed */ }
      await wait(20);
    }
  }
  /** Confirms a shown revision. The call keeps its entry while the answer is in flight, so a mount during the flight still confirms it. */
  async function confirm(id: string, path: string, revision: string): Promise<void> {
    const kind = await send(id, { kind: 'opened', instanceId: host.instanceId, path, revision });
    // Only an accepted or conflicting answer ends the call. A denial (another revision), a failed request or an unrecorded call keeps it waiting for a later mount or a live-call check.
    if (kind === 'answered' || kind === 'conflict') mounting.delete(id);
  }

  /** Refuses a waiting call; like `confirm`, only an accepted or conflicting answer ends it. */
  async function refuse(id: string, reason: string): Promise<void> {
    const kind = await send(id, { kind: 'refused', reason });
    if (kind === 'answered' || kind === 'conflict') mounting.delete(id);
  }

  return {
    /** A viewer mounted and shows `path` at `revision`: confirms the calls waiting for that file. */
    shown(view: { readonly path: string; readonly revision: string }): void {
      for (const [id, path] of mounting) if (path === view.path) void confirm(id, path, view.revision);
      lastShown = view;
    },
    /** A viewer could not show `path` (a kind's `onFailed`, or its renderer threw): refuses the calls waiting for that file with `reason`. */
    failed(view: { readonly path: string; readonly reason: string }): void {
      if (lastShown?.path === view.path) lastShown = undefined;
      const reason = view.reason.trim().slice(0, 200) || 'the view failed';
      for (const [id, path] of mounting) if (path === view.path) void refuse(id, reason);
    },
    /** A viewer stopped showing `path` at `revision` (it unmounted, or a custom viewer or the canvas took the file): it no longer confirms. */
    hidden(view: { readonly path: string; readonly revision: string }): void {
      if (lastShown?.path === view.path && lastShown.revision === view.revision) lastShown = undefined;
    },
    /** The presents the server waits for: each is decided once, in order. Decided calls and waits that are no longer live are forgotten. */
    consider(calls: readonly PendingPresent[], context: PresentContext): void {
      const live = new Set(calls.map(call => call.id));
      for (const id of decided) if (!live.has(id)) decided.delete(id);
      for (const id of mounting.keys()) if (!live.has(id)) mounting.delete(id);
      for (const call of calls) {
        if (decided.has(call.id)) continue;
        decided.add(call.id);
        if (context.closedThisTurn) void send(call.id, { kind: 'refused', reason: 'closed by user' });
        else if (context.unsaved) void send(call.id, { kind: 'refused', reason: 'unsaved changes' });
        else if (context.narrow) void send(call.id, { kind: 'refused', reason: 'narrow screen' });
        else {
          mounting.set(call.id, call.path);
          if (lastShown?.path === call.path && context.showing(call.path)) void confirm(call.id, call.path, lastShown.revision);
          else if (context.autoOpen && !host.open(call.path)) {
            mounting.delete(call.id);
            void send(call.id, { kind: 'refused', reason: 'unsaved changes' });
          }
        }
      }
    },
    /** Calls still waiting for a mount (test and debugging view). */
    waiting: (): readonly string[] => [...mounting.keys()],
  };
}

/** What `createPresentAcks` returns. */
export type PresentAcks = ReturnType<typeof createPresentAcks>;

/**
 * The artifact a tool call made, as the chat places it: a finished call that carries a descriptor (its own, or one the host's `detect`
 * finds) is ready; a `present` call still running while its conversation runs (`running`) is presenting. Any other call has none.
 */
export function recogniseArtifact(call: ToolCall, result: ToolResultMessage | undefined, running: boolean, detect: ChatArtifactsConfig['detect']): ChatArtifact | undefined {
  if (result) {
    const artifact = detectArtifact(call, result, detect as ArtifactsConfig['detect']);
    if (!artifact) return undefined;
    // A tool whose own result carries the descriptor is replaced by its card; a host-detected card is shown in addition to the step.
    return { state: 'ready', id: artifactKey(artifact), title: artifact.title, path: artifact.target.resource.path, own: detectArtifact(call, result) !== undefined, descriptor: artifact };
  }
  if (running && call.name === PRESENT_TOOL) return { state: 'presenting', id: pendingId(call), title: pendingTitle(call), path: undefined, own: true, descriptor: undefined };
  return undefined;
}
