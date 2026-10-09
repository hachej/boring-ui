import { createHash } from 'node:crypto';
import { accessSnapshot, identifier, reference } from '@hachej/boring-files/publication';
import type { ResourceAccess, ResourceReader, ResourceRef } from '@hachej/boring-files';
import type { AgentChange, ToolRegistration } from '@earendil-works/pi-durable';

export interface ResolvedDefinitionTool {
  readonly tool: ToolRegistration;
  /** Host identity for the effective implementation, including native wrappers. */
  readonly implementationVersion: string;
}
export interface AgentDefinitionBinding {
  readonly ref: ResourceRef;
  readonly scopeId: string;
  readonly digest: string;
  readonly formatVersion: 1;
  readonly nativeVersion: 'pi-durable@1.0.1';
  readonly implementationVersion: string;
  readonly tools: readonly { readonly name: string; readonly implementationVersion: string }[];
}
export interface AgentDefinitionOptions {
  readonly reader: ResourceReader;
  readonly ref: ResourceRef;
  readonly access: ResourceAccess;
  readonly implementationVersion: string;
  /** Resolve currently installed and permitted tools; this does not grant later execution. */
  readonly resolveTool: (name: string) => ResolvedDefinitionTool | undefined | Promise<ResolvedDefinitionTool | undefined>;
  readonly expectedBinding?: AgentDefinitionBinding;
  readonly maxBytes?: number;
}
export interface LoadedAgentDefinition {
  readonly change: AgentChange;
  readonly binding: AgentDefinitionBinding;
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid definition object');
  return Object.fromEntries(Object.entries(value));
}
function names(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('Invalid definition tool list');
  const result = value.map(item => identifier(item));
  if (new Set(result).size !== result.length) throw new TypeError('Duplicate definition tool');
  return result;
}
function binding(value: unknown): AgentDefinitionBinding {
  const input = object(value, ['ref', 'scopeId', 'digest', 'formatVersion', 'nativeVersion', 'implementationVersion', 'tools']);
  if (input.formatVersion !== 1 || input.nativeVersion !== 'pi-durable@1.0.1'
    || typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/.test(input.digest)
    || !Array.isArray(input.tools) || input.tools.length > 64) throw new TypeError('Invalid definition binding');
  const tools = input.tools.map(value => {
    const tool = object(value, ['name', 'implementationVersion']);
    return { name: identifier(tool.name), implementationVersion: identifier(tool.implementationVersion) };
  });
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new TypeError('Duplicate bound tool');
  return { ref: reference(input.ref), scopeId: identifier(input.scopeId), digest: input.digest, formatVersion: 1,
    nativeVersion: 'pi-durable@1.0.1', implementationVersion: identifier(input.implementationVersion), tools };
}

/** Load data only. Native configuration stores tool names, so the host must recheck implementations at admission. */
export async function loadAgentDefinition(options: AgentDefinitionOptions): Promise<LoadedAgentDefinition> {
  const ref = reference(options.ref), access = accessSnapshot(options.access);
  const implementationVersion = identifier(options.implementationVersion), maxBytes = options.maxBytes === undefined ? 65536 : options.maxBytes;
  const expected = options.expectedBinding === undefined ? undefined : binding(options.expectedBinding);
  const read = options.reader.read.bind(options.reader), resolveTool = options.resolveTool;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576 || typeof resolveTool !== 'function') {
    throw new TypeError('Invalid definition loader options');
  }
  const resolve = resolveTool.bind(options);
  access.signal?.throwIfAborted();
  let result;
  try { result = await read({ target: { resource: { ...ref.resource }, view: { ...ref.view } }, revision: { kind: 'exact', value: ref.revision } }, { ...access }); }
  catch { access.signal?.throwIfAborted(); throw new Error('Definition read failed'); }
  access.signal?.throwIfAborted();
  if (result?.kind !== 'available') throw new Error('Definition is not available');
  const snapshot = result.snapshot;
  if (!snapshot || JSON.stringify(reference(snapshot.ref)) !== JSON.stringify(ref)
    || !(snapshot.bytes instanceof Uint8Array) || snapshot.bytes.byteLength > maxBytes
    || typeof snapshot.mediaType !== 'string' || !/^application\/json\s*(?:;\s*charset\s*=\s*utf-8\s*)?$/i.test(snapshot.mediaType.trim())) {
    throw new TypeError('Definition snapshot does not match the selected JSON resource');
  }
  const bytes = Uint8Array.from(snapshot.bytes), digest = createHash('sha256').update(bytes).digest('hex');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new TypeError('Definition must contain UTF-8 JSON'); }
  const data = object(parsed, ['format', 'version', 'instructions', 'tools']);
  if (data.format !== 'boring.agent' || data.version !== 1 || typeof data.instructions !== 'string'
    || new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(data.instructions)) !== data.instructions) throw new TypeError('Unsupported agent definition');
  const selected = names(data.tools), tools: ToolRegistration[] = [], versions: AgentDefinitionBinding['tools'][number][] = [];
  for (const name of selected) {
    access.signal?.throwIfAborted();
    let resolved;
    try { resolved = await resolve(name); }
    catch { throw new Error('Definition tool resolution failed'); }
    access.signal?.throwIfAborted();
    if (!resolved || !resolved.tool || resolved.tool.name !== name || typeof resolved.tool.execute !== 'function'
      || typeof resolved.tool.description !== 'string' || !resolved.tool.parameters || typeof resolved.tool.parameters !== 'object') {
      throw new TypeError('Definition tool is not installed and permitted');
    }
    versions.push({ name, implementationVersion: identifier(resolved.implementationVersion) });
    tools.push(resolved.tool);
  }
  access.signal?.throwIfAborted();
  if (tools.some((tool, index) => tool.name !== selected[index])) throw new TypeError('Definition tool changed while loading');
  const loaded: AgentDefinitionBinding = { ref, scopeId: access.scopeId, digest, formatVersion: 1,
    nativeVersion: 'pi-durable@1.0.1', implementationVersion, tools: versions };
  if (expected && JSON.stringify(expected) !== JSON.stringify(loaded)) throw new TypeError('Definition compatibility binding changed');
  return { change: { instructions: data.instructions, tools }, binding: loaded };
}
