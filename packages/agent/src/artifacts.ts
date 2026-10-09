import { defineTool } from '@earendil-works/pi-durable';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { Context } from '@earendil-works/chord';
import type { ResourceAccess, ResourceLocator } from '@hachej/boring-files';
import { asWorkspaceResolver, workspaceFor } from './workspaces.js';
import type { WorkspaceBinding, WorkspaceResolver } from './workspaces.js';

/*
 * Artifacts: substantial, self-contained content (a document, an HTML page, an SVG, code) that a chat shows as a card
 * and a side panel instead of a wall of text. An artifact is a file of the workspace: the agent writes it with its ordinary
 * file tools and calls `present(path)`, which keeps the shown revision in the workspace provider's history and returns a
 * descriptor pointing at the file. There is no store of artifacts and no index. Nothing is executed here.
 */
export const ARTIFACT_TYPES = ['markdown', 'html', 'svg', 'code', 'canvas'] as const;
export type ArtifactType = typeof ARTIFACT_TYPES[number];

/**
 * What a tool result carries under its `artifact` key. The descriptor of `present` points at a workspace file (`target`), names the
 * revision shown and carries no `id` or `ordinal` (both stay optional for hosts that number their own versions).
 */
export interface ArtifactDescriptor {
  readonly schema: 'boring.artifact';
  readonly version: 1;
  readonly id?: string;
  readonly title: string;
  readonly type: ArtifactType;
  readonly mediaType: string;
  readonly language?: string;
  readonly target: ResourceLocator;
  readonly revision: string;
  readonly ordinal?: number;
}

export type ArtifactDescriptorInput = Omit<ArtifactDescriptor, 'schema' | 'version'>;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LANGUAGE = /^[A-Za-z0-9+#._-]{1,32}$/;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** Build a descriptor, refusing anything `parseArtifact` would refuse. */
export function createArtifactDescriptor(input: ArtifactDescriptorInput): ArtifactDescriptor {
  const descriptor = { schema: 'boring.artifact', version: 1, ...input } as ArtifactDescriptor;
  const parsed = parseArtifact(descriptor);
  if (!parsed) throw new TypeError('Invalid artifact descriptor');
  return parsed;
}

/**
 * Strict shape check of an untrusted value (a model-visible tool result, a stored reference). Returns a fresh copy or
 * undefined. This function has no Pi runtime dependency; `registry/pi-chat/artifact.ts` carries the same validator for
 * the browser, because a copied registry item cannot import this package.
 */
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
  let parsedView: ResourceLocator['view'];
  if (view['kind'] === 'published' && hasOnly(view, ['kind'])) parsedView = { kind: 'published' };
  else if (view['kind'] === 'working' && hasOnly(view, ['kind', 'viewId']) && typeof view['viewId'] === 'string' && view['viewId']) parsedView = { kind: 'working', viewId: view['viewId'] };
  else return undefined;
  return { schema: 'boring.artifact', version: 1, ...(id === undefined ? {} : { id }), title, type: type as ArtifactType, mediaType, ...(language === undefined ? {} : { language: language as string }),
    target: { resource: { providerId, path }, view: parsedView }, revision, ...(ordinal === undefined ? {} : { ordinal }) };
}

const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const decode = (bytes: Uint8Array) => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; } };

const PRESENTED: Record<string, { readonly type: ArtifactType; readonly mediaType: string; readonly language?: string }> = {
  md: { type: 'markdown', mediaType: 'text/markdown' }, markdown: { type: 'markdown', mediaType: 'text/markdown' },
  html: { type: 'html', mediaType: 'text/html' }, htm: { type: 'html', mediaType: 'text/html' },
  svg: { type: 'svg', mediaType: 'image/svg+xml' }, tldraw: { type: 'canvas', mediaType: 'application/vnd.tldraw+json' },
};
const LANGUAGE_OF: Record<string, string> = { js: 'javascript', mjs: 'javascript', ts: 'typescript', py: 'python', json: 'json', css: 'css', sql: 'sql', yaml: 'yaml', yml: 'yaml', sh: 'shell', rs: 'rust', go: 'go', java: 'java', csv: 'csv' };

export interface PresentToolOptions {
  /**
   * The workspace of each call, resolved like Pi's environment (`@hachej/boring-agent/workspaces`), or one binding `{ files, root }`; absent: the
   * workspace attached to the call's env (`withWorkspace`). Its
   * provider (`@hachej/boring-files/workspace`) reads the file and retains the presented revision in its history; the descriptor names its
   * provider id.
   */
  readonly workspace?: WorkspaceResolver | WorkspaceBinding | undefined;
  /** The agent's principal for the provider. Default: the binding's `access`. */
  readonly resolveAccess?: (api: ToolExecutionApi, context: Context) => ResourceAccess | Promise<ResourceAccess>;
  /** Largest file shown, in bytes. Defaults to 256 KiB. */
  readonly maxBytes?: number;
}

/**
 * `present(path)`: show a workspace file to the person as a card and a side panel. The agent writes the file with its ordinary file
 * tools first. The card points at the file; the file's history (the provider's) is its list of versions. Nothing is written here.
 */
export function createPresentTool(options: PresentToolOptions = {}) {
  const resolver = asWorkspaceResolver(options.workspace);
  const maxBytes = options.maxBytes ?? 256 * 1024;
  return defineTool({
    name: 'present',
    // How to use it travels with the tool, so every host that offers `present` gets the same rules without repeating them in its prompt.
    description: [
      'Show a file of the workspace to the person in a side panel instead of pasting it in your reply.',
      'When the person asks for something substantial and self-contained (a report, document, HTML page, SVG image or program), write it to a file with the write tool, using a short descriptive path with the right extension (.md, .html, .svg with a viewBox, or the language\'s own), then call present with that path; never put that content in your reply. After present, reply with one or two short sentences and never repeat the content.',
      'Short answers stay in the chat, and so does anything the person asks to have in the chat or without tools or artifacts: then call no tool.',
      'To change, extend or fix something you presented: read the file again first (the person may have edited it; keep their changes), change it with edit (or write the whole new content) at the same path, never a second file, and call present again. If you do not remember the path, list the files.',
    ].join(' '),
    parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 512, description: 'The file path, relative to the workspace.' }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (args, api, context) => {
      const path = args.path.replace(/^\.\//, '');
      const resolved = await workspaceFor(resolver, api, context);
      if ('refused' in resolved) return reply({ kind: 'denied', reason: resolved.refused });
      const { files } = resolved.binding;
      const providerId = files.providerId;
      const granted = options.resolveAccess ? await options.resolveAccess(api, context) : resolved.binding.access;
      if (granted === undefined) return reply({ kind: 'denied', reason: 'The host gave no access for this workspace' });
      const access = { ...granted };
      const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      const kind = PRESENTED[extension] ?? { type: 'code' as const, mediaType: 'text/plain', language: LANGUAGE_OF[extension] };
      const target: ResourceLocator = { resource: { providerId, path }, view: { kind: 'published' } };
      const first = await files.read({ target, revision: { kind: 'latest' } }, access);
      if (first.kind !== 'available') return reply(first);
      const text = decode(first.snapshot.bytes);
      if (text === undefined) return reply({ kind: 'denied', reason: 'The file is not valid UTF-8 text' });
      if (first.snapshot.bytes.byteLength > maxBytes) return reply({ kind: 'denied', reason: `The file is larger than ${maxBytes} bytes` });
      if (kind.type === 'svg' && !/<svg[\s>]/i.test(text)) return reply({ kind: 'denied', reason: 'An SVG file must contain an <svg> element' });
      const kept = await files.keep(path, access);
      if (kept.kind !== 'available') return reply(kept);
      const artifact = createArtifactDescriptor({ title: path.slice(path.lastIndexOf('/') + 1), type: kind.type, mediaType: kind.mediaType, ...(kind.language ? { language: kind.language } : {}),
        target, revision: kept.snapshot.ref.revision });
      return reply({ kind: 'presented', artifact });
    },
  });
}
