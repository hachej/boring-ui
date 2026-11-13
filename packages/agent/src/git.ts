import type { GitRepository } from '@hachej/boring-files/git';
import { defineTool } from '@earendil-works/pi-durable';
import { workspaceFor } from './workspaces.js';

type DiffVersion = { readonly oid: string; readonly mode: number; readonly bytes: Uint8Array } | null;
/** Model-facing form of a diff side: decoded text, or a binary marker without the bytes. */
function readable(version: DiffVersion) {
  if (!version) return null;
  const { oid, mode, bytes } = version;
  try { return { oid, mode, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
  catch { return { oid, mode, binary: true, size: bytes.length }; }
}

/**
 * The host passes the same authorized working repository used by other callers, or nothing: then each call uses the repository of
 * its own workspace, the binding attached to the env Pi handed the call (`withWorkspace` in `@hachej/boring-agent/workspaces`), so one
 * harness serves a repository per person. Git mutations have no replay receipts.
 */
export function createGitTool(repository?: GitRepository) {
  const view = { anyOf: [{ type: 'object', properties: { kind: { type: 'string', const: 'tree' }, ref: { type: 'string', minLength: 1 } }, required: ['kind', 'ref'], additionalProperties: false }, { type: 'object', properties: { kind: { anyOf: [{ type: 'string', const: 'index' }, { type: 'string', const: 'worktree' }] } }, required: ['kind'], additionalProperties: false }] };
  return defineTool({
    name: 'working_git',
    description: 'Operate on the bound working repository. Removal affects only the index. Mutations may leave partial effects and are not publication.',
    replay: 'unsafe',
    parameters: { anyOf: [{ type: 'object', properties: { operation: { anyOf: [{ type: 'string', const: 'init' }, { type: 'string', const: 'status' }, { type: 'string', const: 'log' }, { type: 'string', const: 'branches' }] } }, required: ['operation'], additionalProperties: false }, { type: 'object', properties: { operation: { anyOf: [{ type: 'string', const: 'add' }, { type: 'string', const: 'remove' }] }, path: { type: 'string', minLength: 1 } }, required: ['operation', 'path'], additionalProperties: false }, { type: 'object', properties: { operation: { type: 'string', const: 'commit' }, message: { type: 'string', minLength: 1 } }, required: ['operation', 'message'], additionalProperties: false }, { type: 'object', properties: { operation: { anyOf: [{ type: 'string', const: 'branch' }, { type: 'string', const: 'checkout' }] }, ref: { type: 'string', minLength: 1 } }, required: ['operation', 'ref'], additionalProperties: false }, { type: 'object', properties: { operation: { type: 'string', const: 'diff' }, before: view, after: view }, required: ['operation', 'before', 'after'], additionalProperties: false }] } as const,
    execute: async (args, api, context) => {
      const resolved = repository === undefined ? await workspaceFor(undefined, api, context) : undefined;
      const selected = repository ?? (resolved && 'binding' in resolved ? resolved.binding.repository : undefined);
      if (selected === undefined) return { output: [{ type: 'text', text: 'This conversation has no working repository.' }], isError: true };
      const signal = context.abortSignal;
      let value: unknown;
      switch (args.operation) {
        case 'init': value = await selected.init(signal); break;
        case 'status': value = await selected.status(signal); break;
        case 'log': value = await selected.log(signal); break;
        case 'branches': value = await selected.branches(signal); break;
        case 'add': value = await selected.add(args.path, signal); break;
        case 'remove': value = await selected.remove(args.path, signal); break;
        case 'commit': value = await selected.commit(args.message, signal); break;
        case 'branch': value = await selected.branch(args.ref, signal); break;
        case 'checkout': value = await selected.checkout(args.ref, signal); break;
        case 'diff': value = (await selected.diff(args.before, args.after, signal)).map(change => ({ path: change.path, before: readable(change.before), after: readable(change.after) })); break;
      }
      return { output: [{ type: 'text', text: JSON.stringify({ operation: args.operation, value: value ?? null }) }] };
    },
  });
}
