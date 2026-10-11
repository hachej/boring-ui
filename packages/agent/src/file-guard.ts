import { defineDoc, defineExtension, wrapTool } from '@earendil-works/pi-durable';
import type { ToolExecutionApi, ToolExecutionResult, ToolRegistration } from '@earendil-works/pi-durable';
import { FileError, err, getOrThrow, ok } from '@earendil-works/pi-durable/env';
import type { ExecutionEnv, Result } from '@earendil-works/pi-durable/env';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import type { Context } from '@earendil-works/chord';
import type { ResourceAccess } from '@hachej/boring-files';
import { asWorkspaceResolver, decorate, workspaceFor } from './workspaces.js';
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
 * Only the exact spelling the provider observed is ever delegated: a `read` or `edit` of a missing path is refused, so Pi's
 * fallback spellings (NFD, curly apostrophe, narrow space) can never open a file the containment check did not see.
 *
 * The check and the open are two steps, so the native tools get the env through `confinedEnv`: each operation re-checks the path it is
 * about to open, which closes the gap for fallback spellings. A symlink swapped inside the few microseconds between that check and the
 * OS `open` is not closable here; keeping an untrusted agent off such a race is the host's isolation (ruling: an isolated worker env
 * in shared-process hosts), and this guard claims no more.
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

/** `path` as the call's env names it, and relative to `root`, or undefined when it is not lexically inside `root` (or the call has no env). Pi's path normalisation applies. */
export async function workspaceRelative(api: ToolExecutionApi, root: string, path: string, context: Context): Promise<{ readonly path: string; readonly absolute: string } | undefined> {
  if (api.env === undefined) return undefined;
  const absolute = getOrThrow(await api.env.absolutePath(normalised(path), context));
  return absolute.startsWith(`${root}/`) ? { path: absolute.slice(root.length + 1), absolute } : undefined;
}

/**
 * Whether `absolute` really lies inside `root` once links are resolved, through the env's own `canonicalPath`. A path that does not
 * exist yet is judged by its deepest existing ancestor, so a link directory cannot lead a new file out. Any other failure to resolve
 * is a refusal: the guard fails closed.
 */
async function contained(env: ExecutionEnv | undefined, root: string, absolute: string, context: Context): Promise<boolean> {
  if (env === undefined) return false;
  const realRoot = await env.canonicalPath(root, context);
  if (!realRoot.ok) return false;
  const base = realRoot.value.replace(/\/+$/, '');
  let candidate = absolute, rest = '';
  for (;;) {
    const real = await env.canonicalPath(candidate, context);
    if (real.ok) { const resolved = `${real.value.replace(/\/+$/, '')}${rest}`; return resolved === base || resolved.startsWith(`${base}/`); }
    if (real.error.code !== 'not_found') return false;
    // A dangling link resolves to nothing, but a write through it would create its target: refuse it, wherever it is.
    const link = await env.fileInfo(candidate, context);
    if (link.ok && link.value.kind === 'symlink') return false;
    const cut = candidate.lastIndexOf('/');
    if (cut <= 0) return false;
    rest = `${candidate.slice(cut)}${rest}`;
    candidate = candidate.slice(0, cut);
  }
}

export const ONE_PATH = new Set(['readTextFile', 'openTextLineReader', 'readTextLines', 'readBinaryFile', 'openBinaryReader', 'writeFile', 'appendFile', 'truncateFile', 'flushFile', 'fileInfo', 'listDir', 'openDirReader', 'createDir', 'remove', 'canonicalPath']);

/**
 * `env` as the native `read`, `write` and `edit` must see it: every operation that opens, changes or lists a path first re-checks the
 * path it is ABOUT to touch (links resolved, like `contained`) and refuses outside `root` with a typed `permission_denied`. The check
 * is on the path Pi actually opens, so a fallback spelling Pi picks after the provider's check (NFD, curly apostrophe) is judged as
 * itself. `exists` answers false for a path outside, so Pi's fallback loop moves on instead of revealing it. A Pi extension point
 * (`ExecutionEnv` decorator), public API only. Residual: a symlink swapped between this check and the OS `open` is not closable from
 * here; that boundary is the host's isolation (an isolated worker env), not this guard.
 */
export function confinedEnv(env: ExecutionEnv, root: string): ExecutionEnv {
  const denied = (path: string): Result<never, FileError> => err(new FileError('permission_denied', `Refused: ${path} is outside the workspace.`, path));
  const inside = (path: string, context: Context) => contained(env, root, path, context);
  return decorate(env, new Proxy(env, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (typeof member !== 'function') return member;
      const method = member.bind(target) as (...args: unknown[]) => unknown;
      if (typeof property !== 'string') return method;
      if (ONE_PATH.has(property)) return async (path: string, ...rest: unknown[]) => await inside(path, rest[rest.length - 1] as Context) ? method(path, ...rest) : denied(path);
      if (property === 'renameFile') return async (from: string, to: string, context: Context) => await inside(from, context) && await inside(to, context) ? method(from, to, context) : denied(`${from} -> ${to}`);
      if (property === 'exists') return async (path: string, context: Context) => await inside(path, context) ? method(path, context) : ok(false);
      return method;
    },
  }));
}

/** The guard as a native extension. Select it after the extension(s) that register `read`, `write` and `edit`. */
export function createFileGuard(options: FileGuardOptions = {}) {
  const resolver = asWorkspaceResolver(options.workspace);

  async function observeIn(files: WorkspaceBinding['files'], path: string, access: ResourceAccess): Promise<Observed> {
    const read = await files.read({ target: { resource: { providerId: files.providerId, path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
    if (read.kind === 'available') return { kind: 'file', revision: read.snapshot.ref.revision };
    if (read.kind === 'missing') return { kind: 'missing' };
    return { kind: 'refused', reason: read.reason };
  }
  function guarded<Tool extends ToolRegistration>(tool: Tool, mode: 'read' | 'write' | 'edit'): Tool {
    const execute = async (args: Args, api: ToolExecutionApi, context: Context): Promise<ToolExecutionResult> => {
      const resolved = await workspaceFor(resolver, api, context);
      if ('refused' in resolved) return refusal(`Refused: ${resolved.refused}`);
      const { binding } = resolved;
      // The native tool gets the env decorated to re-check what it actually opens (see `confinedEnv`); the guard's own checks use the raw one.
      const run = () => (tool.execute as (args: Args, api: ToolExecutionApi, context: Context) => Promise<ToolExecutionResult>)(args, api.env === undefined ? api : Object.create(api, { env: { value: confinedEnv(api.env, binding.root.replace(/\/+$/, '')), enumerable: true } }) as ToolExecutionApi, context);
      const { files } = binding;
      const root = binding.root.replace(/\/+$/, '');
      const granted = options.resolveAccess ? await options.resolveAccess(api, context) : binding.access;
      if (granted === undefined) return refusal('Refused: the host gave no access for this workspace.');
      const access = { ...granted };
      const observe = (path: string) => observeIn(files, path, access);
      const located = await workspaceRelative(api, root, args.path, context);
      if (located === undefined || !await contained(api.env, root, located.absolute, context)) return refusal(`Refused: ${args.path} is outside the workspace.`);
      const { path } = located;
      const key = baselineKey(binding, path);
      return files.queue.run(async () => {
        const before = await observe(path);
        if (mode === 'read') {
          if (before.kind === 'refused') return refusal(`Refused: ${path} cannot be read here (${before.reason}).`);
          // Pi's read falls back to other spellings of a missing path (NFD, a curly apostrophe, a narrow space before AM/PM). The
          // provider and the containment check only vouch for this spelling, so a missing one is refused here and never delegated.
          if (before.kind === 'missing') return refusal(`Refused: ${path} does not exist in the workspace.`);
          const result = await run();
          if (result.isError || before.kind !== 'file') return result;
          // Record only the bytes the model saw: a change during the call (a shell) leaves the baseline alone.
          const after = await observe(path);
          if (after.kind === 'file' && after.revision === before.revision) await recordRevision(api, key, after.revision, context);
          return result;
        }
        if (before.kind === 'refused') return refusal(`Refused: ${path} cannot be changed here (${before.reason}).`);
        if (mode === 'edit' && before.kind === 'missing') return refusal(`Refused: ${path} does not exist in the workspace.`);
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
