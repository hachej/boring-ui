import type { ResourceLocator } from '@hachej/boring-files';
import { parseTaskArtifact } from './task-artifacts.js';
import type { TaskArtifactDescriptor } from './task-artifacts.js';

export type PresentedArtifact = ArtifactDescriptor | TaskArtifactDescriptor;
/** Parse file or host-task presentation without treating a record as a workspace file. */
export function parsePresentedArtifact(value: unknown): PresentedArtifact | undefined { return parseArtifact(value) ?? parseTaskArtifact(value); }

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
 * undefined. This function has no Pi runtime dependency; `registry/pi-artifacts/artifact.ts` carries the same validator for
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

