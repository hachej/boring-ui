import type { ConversationView } from '@earendil-works/pi-durable';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';

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

/** What the host passes to `PiChat` to turn artifact tool results into cards. */
export interface ArtifactsConfig {
  /** The person clicked a card: show this artifact (and revision) in the host's panel. */
  readonly open: (artifact: ArtifactDescriptor) => void;
  /** True for the card whose artifact version is on display. */
  readonly isOpen?: (artifact: ArtifactDescriptor) => boolean;
  /** Recognise a descriptor in a successful tool result that does not carry one itself (for example a document save). */
  readonly detect?: (call: ToolCall, result: ToolResultMessage) => ArtifactDescriptor | undefined;
}

export const PRESENT_TOOL = 'present';

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

const TYPE_LABEL: Record<ArtifactType, string> = { markdown: 'Document', html: 'HTML page', svg: 'SVG image', code: 'Code', canvas: 'Canvas' };
export function typeLabel(artifact: Pick<ArtifactDescriptor, 'type' | 'language'>): string {
  return artifact.type === 'code' && artifact.language ? `Code · ${artifact.language}` : TYPE_LABEL[artifact.type];
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
  return typeof path === 'string' && path ? path.replace(/^\.\//, '') : undefined;
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
