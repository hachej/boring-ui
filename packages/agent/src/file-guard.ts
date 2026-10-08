import { defineDoc, defineExtension, wrapTool } from '@earendil-works/pi-durable';
import type { ToolExecutionApi, ToolExecutionResult, ToolRegistration } from '@earendil-works/pi-durable';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import type { Context } from '@earendil-works/chord';
import type { ResourceAccess } from '@hachej/boring-files';
import { asWorkspaceResolver, workspaceFor } from './workspaces.js';
import type { WorkspaceBinding, WorkspaceResolver } from './workspaces.js';

/*
 * The guard for Pi's own `read`, `write` and `edit`. It adds no tool and no file API: it wraps the native tools (public
 * `wrapTool`) so that the agent cannot overwrite what it has not seen.
 *
 *  - Every wrapped call runs inside the workspace provider's mutation queue, so a viewer save cannot land between `edit`'s
 *    internal read and its write.
 *  - A genuine `read` call records the file's revision (the provider's Git blob id of the bytes) as this conversation's
 *    last-read revision of the path, in a native conversation document: it survives restarts. `edit`'s internal read is not
 *    a `read` call and never records anything.
 *  - `write` and `edit` of a file that exists are refused unless the conversation read it and its revision still equals the
 *    last-read one. Creating a file is allowed only while it is absent. After a successful `write` or `edit` the baseline is
 *    the revision just written.
 *
 * Pi's `edit` matches `oldText` exactly first and only then falls back to a fuzzy match (Unicode normalisation, trailing
 * whitespace, smart quotes, dashes and special spaces); that is Pi's behaviour and the guard does not change it. A shell write
 * (`bash`) is not intercepted, but it changes the revision, so the next `write` or `edit` of that file is refused until read.
 *
 * The workspace is resolved per call, like Pi's environment (`@hachej/boring-agent/workspaces`): one guard serves every conversation of
 * a harness, each in its own workspace. Baselines are keyed by the workspace identity and the path.
 */

type Baselines = { revisions: Record<string, string> };
/** Conversation document: workspace and path (relative to the workspace root; see `baselineKey`) to the revision this conversation last read or wrote. */
export const lastReadRevisions = defineDoc<Baselines>({
  kind: 'boring.files.last-read', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ revisions: {} }),
});

/** The baseline key of `path` in `workspace` (its `id`, or its provider id): `<workspace>:<path>`. */
export const baselineKey = (workspace: Pick<WorkspaceBinding, 'id' | 'files'>, path: string): string => `${workspace.id ?? workspace.files.providerId}:${path}`;
/** The revision this conversation last read or wrote under `key` (see `baselineKey`), or undefined. Also what host tools over workspace files (such as the canvas tools) check. */
export const lastReadRevision = async (api: ToolExecutionApi, key: string, context: Context): Promise<string | undefined> =>
  (await api.snapshot(lastReadRevisions, api.conversationId, context))?.revisions[key];
/** Record `revision` as the conversation's baseline under `key` (see `baselineKey`), durably. */
export const recordRevision = (api: ToolExecutionApi, key: string, revision: string, context: Context): Promise<void> => api.commit(async tx => {
  const doc = await tx.doc(lastReadRevisions, api.conversationId);
  doc.revisions[key] = revision;
}, context);

export interface FileGuardOptions {
  /**
   * The workspace of each call: a resolver shaped like `HarnessOptions.env` (`@hachej/boring-agent/workspaces`), or one binding
   * `{ files, root }` for a host with a single workspace; absent: the workspace attached to the call's env (`withWorkspace`). `files` is the provider the viewers use (its queue serialises the calls,
   * its reads name the revisions); `root` is the workspace root as the call's ExecutionEnv names it. Paths outside it are refused.
   */
  readonly workspace?: WorkspaceResolver | WorkspaceBinding | undefined;
  /** The agent's principal for the provider. Default: the binding's `access`. */
  readonly resolveAccess?: (api: ToolExecutionApi, context: Context) => ResourceAccess | Promise<ResourceAccess>;
  /**
   * The extension name (default `boring.files.guard`). A registry keeps one extension per name, so two agents with different
   * workspace resolvers in one registry need two names; otherwise the last installed guard wraps every agent's tools.
   */
  readonly name?: string;
}

type Observed = { readonly kind: 'file'; readonly revision: string } | { readonly kind: 'missing' } | { readonly kind: 'refused'; readonly reason: string };
type Args = { readonly path: string };

const refusal = (text: string): ToolExecutionResult => ({ content: [{ type: 'text', text }], isError: true });
// The same normalisation as Pi's tool paths: a leading "@" and special spaces.
const normalised = (path: string) => { const spaced = path.replace(/[  -   　]/g, ' '); return spaced.startsWith('@') ? spaced.slice(1) : spaced; };

/** The guard as a native extension. Select it after the extension(s) that register `read`, `write` and `edit`. */
export function createFileGuard(options: FileGuardOptions = {}) {
  const resolver = asWorkspaceResolver(options.workspace);

  async function relative(api: ToolExecutionApi, root: string, path: string, context: Context): Promise<string | undefined> {
    if (api.env === undefined) return undefined;
    const absolute = getOrThrow(await api.env.absolutePath(normalised(path), context));
    return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : undefined;
  }
  async function observeIn(files: WorkspaceBinding['files'], path: string, access: ResourceAccess): Promise<Observed> {
    const read = await files.read({ target: { resource: { providerId: files.providerId, path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
    if (read.kind === 'available') return { kind: 'file', revision: read.snapshot.ref.revision };
    if (read.kind === 'missing') return { kind: 'missing' };
    return { kind: 'refused', reason: read.reason };
  }
  function guarded<Tool extends ToolRegistration>(tool: Tool, mode: 'read' | 'write' | 'edit'): Tool {
    const execute = async (args: Args, api: ToolExecutionApi, context: Context): Promise<ToolExecutionResult> => {
      const run = () => (tool.execute as (args: Args, api: ToolExecutionApi, context: Context) => Promise<ToolExecutionResult>)(args, api, context);
      const resolved = await workspaceFor(resolver, api, context);
      if ('refused' in resolved) return mode === 'read' ? run() : refusal(`Refused: ${resolved.refused}`);
      const { binding } = resolved;
      const { files } = binding;
      const root = binding.root.replace(/\/+$/, '');
      const granted = options.resolveAccess ? await options.resolveAccess(api, context) : binding.access;
      if (granted === undefined) return refusal('Refused: the host gave no access for this workspace.');
      const access = { ...granted };
      const observe = (path: string) => observeIn(files, path, access);
      const path = await relative(api, root, args.path, context);
      if (path === undefined) return mode === 'read' ? run() : refusal(`Refused: ${args.path} is outside the workspace.`);
      const key = baselineKey(binding, path);
      return files.queue.run(async () => {
        const before = await observe(path);
        if (mode === 'read') {
          const result = await run();
          if (result.isError || before.kind !== 'file') return result;
          // Record only the bytes the model saw: a change during the call (a shell) leaves the baseline alone.
          const after = await observe(path);
          if (after.kind === 'file' && after.revision === before.revision) await recordRevision(api, key, after.revision, context);
          return result;
        }
        if (before.kind === 'refused') return refusal(`Refused: ${path} cannot be changed here (${before.reason}).`);
        if (before.kind === 'file') {
          const known = await lastReadRevision(api, key, context);
          if (known === undefined) return refusal(`Refused: ${path} already exists and you have not read it in this conversation. Read it with the read tool, then make your change.`);
          if (known !== before.revision) return refusal(`Refused: ${path} changed since you last read it (the person or another process saved it). Read it again with the read tool, then redo your change on top of what is there now.`);
        }
        const result = await run();
        if (!result.isError) {
          const after = await observe(path);
          if (after.kind === 'file') await recordRevision(api, key, after.revision, context);
        }
        return result;
      });
    };
    return { ...tool, execute } as Tool;
  }

  return defineExtension({
    name: options.name ?? 'boring.files.guard',
    wraps: [
      wrapTool(createReadTool() as ToolRegistration, tool => guarded(tool, 'read')),
      wrapTool(createWriteTool() as ToolRegistration, tool => guarded(tool, 'write')),
      wrapTool(createEditTool() as ToolRegistration, tool => guarded(tool, 'edit')),
    ],
  });
}
