import type { GitRepository } from '@hachej/boring-files/git';
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
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
  const view = Type.Union([
    Type.Object({ kind: Type.Literal('tree'), ref: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Union([Type.Literal('index'), Type.Literal('worktree')]) }, { additionalProperties: false }),
  ]);
  return defineTool({
    name: 'working_git',
    description: 'Operate on the bound working repository. Removal affects only the index. Mutations may leave partial effects and are not publication.',
    replay: 'unsafe',
    parameters: Type.Union([
      Type.Object({ operation: Type.Union([Type.Literal('init'), Type.Literal('status'), Type.Literal('log'), Type.Literal('branches')]) }, { additionalProperties: false }),
      Type.Object({ operation: Type.Union([Type.Literal('add'), Type.Literal('remove')]), path: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      Type.Object({ operation: Type.Literal('commit'), message: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      Type.Object({ operation: Type.Union([Type.Literal('branch'), Type.Literal('checkout')]), ref: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      Type.Object({ operation: Type.Literal('diff'), before: view, after: view }, { additionalProperties: false }),
    ]),
    execute: async (args, api, context) => {
      const resolved = repository === undefined ? await workspaceFor(undefined, api, context) : undefined;
      const selected = repository ?? (resolved && 'binding' in resolved ? resolved.binding.repository : undefined);
      if (selected === undefined) return { content: [{ type: 'text', text: 'This conversation has no working repository.' }], isError: true };
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
      return { content: [{ type: 'text', text: JSON.stringify({ operation: args.operation, value: value ?? null }) }] };
    },
  });
}
