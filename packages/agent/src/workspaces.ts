import type { ConversationId, EnvTarget, Session, ToolExecutionApi } from '@earendil-works/pi-durable';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import type { Context } from '@earendil-works/chord';
import type { ResourceAccess } from '@hachej/boring-files';
import type { WorkspaceResourceProvider } from '@hachej/boring-files/workspace';
import type { GitRepository } from '@hachej/boring-files/git';

/*
 * The workspace of a call, resolved like Pi's environment. Pi builds a conversation's `ExecutionEnv` at each use from
 * `HarnessOptions.env(target, context)`; the workspace tools (the file guard, `present`, the canvas tools) resolve their
 * workspace provider the same way, from the same target, instead of closing over one provider when they are created. One
 * harness can then serve several people, each conversation working in its own workspace.
 *
 * Coherence: the env Pi hands a call and the provider a tool resolves must be the same workspace instance. `createWorkspaceCache`
 * keeps both in one entry per workspace key, so `cache.env` (given to Pi) and `cache.workspace` (given to the tools) agree, and a
 * binding names its env so that a tool refuses a call whose env is another instance (the entry was closed and reopened between
 * the two lookups). A host with one workspace passes `constantWorkspace({ files, root })`.
 *
 * One host function: a host that opens its workspaces with `createWorkspaceCache` (or attaches a binding to an env with
 * `withWorkspace`) gives the harness `env` and nothing else. A tool created without a `workspace` option resolves the binding of
 * the env Pi handed its call (`api.env`), so the workspace of a call is, by construction, the one its env belongs to.
 */

/** One workspace as the tools of a call see it. */
export interface WorkspaceBinding {
  /** Stable workspace identity; scopes the guard's per-conversation baselines. Default: the provider id. */
  readonly id?: string;
  /** The workspace's single provider (`@hachej/boring-files/workspace`): its queue, reads, history and conditional writes. */
  readonly files: WorkspaceResourceProvider;
  /** The workspace root as the call's ExecutionEnv names it (the provider's `fs.cwd`). */
  readonly root: string;
  /** The ExecutionEnv Pi uses for this workspace. When present, a call whose `api.env` is another object is refused. */
  readonly env?: ExecutionEnv;
  /** The agent's principal in this workspace, chosen by the host when it opened it; tools use it unless they are given `resolveAccess`. */
  readonly access?: ResourceAccess;
  /** The workspace's working Git repository (`@hachej/boring-files/git`) over the same files, when it has one; `working_git` uses it. */
  readonly repository?: GitRepository;
}

/** Same shape as `HarnessOptions.env`: the workspace of one call, or `undefined` when the conversation has none. */
export type WorkspaceResolver = (target: EnvTarget, context: Context) => WorkspaceBinding | undefined | Promise<WorkspaceBinding | undefined>;

/** What a tool needs a credential for: the tool, and the external server when there is one (an MCP server id). */
export interface CredentialRequest { readonly tool: string; readonly server?: string }
/**
 * The host's per-call credentials: a secret for the person behind the call, or `undefined` when they have none. Tools call it at
 * execute time and keep the value only in memory: never in conversation state, a tool result or a log.
 */
export type CredentialResolver = (target: EnvTarget, context: Context, request: CredentialRequest) => string | undefined | Promise<string | undefined>;

/** The single-workspace case: every call uses `binding`. */
export function constantWorkspace(binding: WorkspaceBinding): WorkspaceResolver {
  checked(binding);
  const frozen = Object.freeze({ ...binding });
  return () => frozen;
}

/** A resolver as given, or a binding wrapped as a constant resolver; nothing: the workspace of the call's env (`withWorkspace`). */
export function asWorkspaceResolver(workspace?: WorkspaceResolver | WorkspaceBinding): WorkspaceResolver | undefined {
  return workspace === undefined || typeof workspace === 'function' ? workspace : constantWorkspace(workspace);
}

const attached = new WeakMap<ExecutionEnv, WorkspaceBinding>();
/**
 * Attach `binding` to `env`: the workspace that comes with that env. The host's `HarnessOptions.env(target, context)` returns such an
 * env, and every tool without its own `workspace` option uses its binding, so one host function resolves both. Returns `env`.
 */
export function withWorkspace<E extends ExecutionEnv>(env: E, binding: WorkspaceBinding): E {
  checked(binding);
  if (binding.env !== undefined && binding.env !== env) throw new TypeError('A workspace binding names another env');
  attached.set(env, Object.freeze({ ...binding, env }));
  return env;
}
/** The workspace attached to `env` (`withWorkspace`, or the env of a `createWorkspaceCache` entry), if any. */
export const workspaceOfEnv = (env: ExecutionEnv | undefined): WorkspaceBinding | undefined => env === undefined ? undefined : attached.get(env);

function checked(binding: WorkspaceBinding): WorkspaceBinding {
  if (!binding || typeof binding !== 'object' || !binding.files || typeof binding.files.providerId !== 'string') throw new TypeError('A workspace binding needs its provider');
  if (typeof binding.root !== 'string' || !binding.root.startsWith('/')) throw new TypeError('A workspace binding needs the absolute workspace root');
  return binding;
}

/** The target Pi would pass to `HarnessOptions.env` for this call: its conversation, the agent's `cwd`, committed reads. */
export async function callTarget(api: ToolExecutionApi, context: Context): Promise<EnvTarget> {
  const cwd = (await api.agent(context)).cwd;
  return { conversationId: api.conversationId, ...(cwd === undefined ? {} : { cwd }), read: api };
}

/**
 * Resolve the workspace of a tool call, or the reason it has none: through `resolver` (or one binding), or without either from the env
 * Pi handed the call (`withWorkspace`).
 */
export async function workspaceFor(resolver: WorkspaceResolver | WorkspaceBinding | undefined, api: ToolExecutionApi, context: Context): Promise<{ readonly binding: WorkspaceBinding } | { readonly refused: string }> {
  const binding = resolver === undefined ? workspaceOfEnv(api.env) : typeof resolver === 'function' ? await resolver(await callTarget(api, context), context) : resolver;
  if (binding === undefined) return { refused: 'This conversation has no workspace.' };
  checked(binding);
  if (binding.env !== undefined && binding.env !== api.env) return { refused: 'The workspace of this conversation was reopened during the call. Try again.' };
  return { binding };
}

/**
 * The conversation whose workspace a conversation uses: itself, or for a conversation a task owns (a subagent's child), the
 * conversation of that task, transitively. Read-only; the mapping never changes, so a host may memoise it.
 */
export async function rootConversation(session: Pick<Session, 'commit'>, id: ConversationId, context: Context): Promise<ConversationId> {
  return session.commit(async tx => {
    let current = id;
    for (let depth = 0; depth < 64; depth++) {
      const record = await tx.conversation(current);
      if (record?.owner === undefined) return current;
      current = record.owner.conversationId;
    }
    return current;
  }, context);
}

/** A workspace the cache opened: a binding with its env, and how to close it. */
export interface OpenedWorkspace extends WorkspaceBinding {
  readonly env: ExecutionEnv;
  readonly close?: () => void | Promise<void>;
}

export interface WorkspaceCacheOptions<W extends OpenedWorkspace = OpenedWorkspace> {
  /** The workspace key of a call (for example the owner of the conversation), or `undefined`: the conversation has no workspace. */
  readonly key: (target: EnvTarget, context: Context) => string | undefined | Promise<string | undefined>;
  /** Open the workspace of `key`: one provider instance over one env. Called once per key while it stays open. */
  readonly open: (key: string, context: Context) => W | Promise<W>;
  /** A native cwd view over this same workspace. The workspace owner closes any resources it acquires. Other cwd values refuse without this factory. */
  readonly atCwd?: (workspace: W, cwd: string, context: Context) => W['env'] | Promise<W['env']>;
  /** Close a workspace this long after its last use, when nothing holds it (default 10 minutes; `Infinity`: never). */
  readonly idleMs?: number;
  /**
   * Whether `key` is still in use beyond what the cache sees, checked before an idle close (for example: the harness has live
   * tasks). Pi does not report when a call stops using its env, so a host whose tool calls can outlast `idleMs` answers here.
   */
  readonly busy?: (key: string) => boolean | Promise<boolean>;
  /** A close that failed. Must not throw. */
  readonly onError?: (error: unknown, key: string) => void;
}

/** A borrowed workspace: `release` returns the hold and never closes the workspace itself. */
export interface WorkspaceLease<W extends OpenedWorkspace = OpenedWorkspace> {
  readonly workspace: W;
  readonly release: () => void;
}

export interface WorkspaceCache<W extends OpenedWorkspace = OpenedWorkspace> {
  /** `HarnessOptions.env`: the env of the call's workspace. */
  readonly env: (target: EnvTarget, context: Context) => Promise<ExecutionEnv | undefined>;
  /** The tools' resolver: the binding of the same workspace instance as `env`. */
  readonly workspace: (target: EnvTarget, context: Context) => Promise<W | undefined>;
  /** Borrow the workspace of `key` (a viewer or HTTP route, after authentication): kept open until every lease is released. */
  readonly acquire: (key: string, context: Context) => Promise<WorkspaceLease<W>>;
  /** The keys open now. */
  readonly keys: () => string[];
  /** Close every workspace (host shutdown). */
  readonly close: () => Promise<void>;
}

type Entry<W> = { readonly opening: Promise<W>; readonly views: Map<string, Promise<W>>; leases: number; lastUsed: number; timer?: ReturnType<typeof setTimeout> | undefined; closing?: Promise<void> };

/**
 * One open workspace per key, opened on first use and closed when idle. The cache owns what `open` returns: a lease or a call
 * borrows it, and only the cache closes it (idle, or `close()`), never a viewer that stops looking.
 */
export function createWorkspaceCache<W extends OpenedWorkspace = OpenedWorkspace>(options: WorkspaceCacheOptions<W>): WorkspaceCache<W> {
  const idleMs = options.idleMs ?? 10 * 60_000;
  if (!(idleMs > 0)) throw new TypeError('idleMs must be positive');
  const entries = new Map<string, Entry<W>>();
  let closed = false;

  function arm(key: string, entry: Entry<W>) {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (!Number.isFinite(idleMs)) return;
    entry.timer = setTimeout(() => { void sweep(key, entry); }, Math.max(0, entry.lastUsed + idleMs - Date.now()));
    (entry.timer as { unref?: () => void }).unref?.();
  }
  async function sweep(key: string, entry: Entry<W>) {
    entry.timer = undefined;
    if (entries.get(key) !== entry || entry.leases > 0) return;
    if (Date.now() - entry.lastUsed < idleMs) return arm(key, entry);
    let busy = false;
    try { busy = (await options.busy?.(key)) === true; } catch { busy = true; }
    if (entries.get(key) !== entry || entry.leases > 0) return;
    if (Date.now() - entry.lastUsed < idleMs) return arm(key, entry);
    if (busy) { entry.lastUsed = Date.now(); return arm(key, entry); }
    await dispose(key, entry);
  }
  function dispose(key: string, entry: Entry<W>): Promise<void> {
    if (entries.get(key) === entry) entries.delete(key);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.closing ??= entry.opening.then(async workspace => {
      await Promise.allSettled(entry.views.values());
      await workspace.close?.();
    }, () => undefined).catch(error => { options.onError?.(error, key); });
    return entry.closing;
  }
  async function use(key: string, context: Context, lease: boolean): Promise<{ readonly workspace: W; readonly entry: Entry<W> }> {
    if (closed) throw new Error('The workspace cache is closed');
    let entry = entries.get(key);
    if (entry === undefined) {
      const opening = Promise.resolve().then(() => options.open(key, context)).then(workspace => {
        checked(workspace);
        if (!workspace.env) throw new TypeError(`Workspace ${key} has no env`);
        withWorkspace(workspace.env, workspace);
        return workspace;
      });
      entry = { opening, views: new Map(), leases: 0, lastUsed: Date.now() };
      entries.set(key, entry);
      const created = entry;
      opening.catch(() => { if (entries.get(key) === created) entries.delete(key); });
    }
    if (lease) entry.leases++;
    entry.lastUsed = Date.now();
    try {
      const workspace = await entry.opening;
      if (closed || entries.get(key) !== entry) throw new Error('The workspace was closed during acquisition');
      if (!lease) arm(key, entry);
      return { workspace, entry };
    } catch (error) {
      if (lease) entry.leases--;
      throw error;
    }
  }
  const forTarget = async (target: EnvTarget, context: Context): Promise<W | undefined> => {
    const key = await options.key(target, context);
    if (key === undefined) return undefined;
    const { workspace, entry } = await use(key, context, false);
    if (closed || entries.get(key) !== entry) throw new Error('The workspace was closed during acquisition');
    const cwd = target.cwd;
    if (cwd === undefined || cwd === workspace.env.cwd) return workspace;
    const atCwd = options.atCwd;
    if (atCwd === undefined) throw new Error(`Workspace ${key} cannot provide working directory ${cwd}`);
    let selected = entry.views.get(cwd);
    if (selected === undefined) {
      selected = Promise.resolve().then(() => atCwd(workspace, cwd, context)).then(env => {
        if (env === workspace.env || env.id !== workspace.env.id || env.cwd !== cwd) throw new Error('A cwd view must be independent and use the same namespace and requested working directory');
        const binding = { ...workspace, env };
        withWorkspace(env, binding);
        return binding;
      });
      entry.views.set(cwd, selected);
      void selected.catch(() => { entry.views.delete(cwd); });
    }
    const view = await selected;
    if (closed || entries.get(key) !== entry) throw new Error('The workspace was closed during cwd acquisition');
    return view;
  };
  return {
    env: async (target, context) => (await forTarget(target, context))?.env,
    workspace: forTarget,
    acquire: async (key, context) => {
      const { workspace, entry } = await use(key, context, true);
      let released = false;
      return { workspace, release: () => {
        if (released) return;
        released = true;
        entry.leases--;
        entry.lastUsed = Date.now();
        if (entry.leases === 0 && entries.get(key) === entry) arm(key, entry);
      } };
    },
    keys: () => [...entries.keys()],
    close: async () => {
      closed = true;
      await Promise.all([...entries].map(([key, entry]) => dispose(key, entry)));
    },
  };
}
