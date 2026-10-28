import { createHash } from 'node:crypto';
import { AgentDoc, defineExtension } from '@earendil-works/pi-durable';
import type { AgentChange, Conversation, ConversationCreateOptions, Extension, Harness, Registry, ToolRegistration } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { createSelfEvolution } from './self-evolving.js';
import type { SelfEvolution, SelfEvolutionReport } from './self-evolving.js';
import { NAME, isSkillArray, liveSkills, staticSkills, validSkill } from './skills.js';
import { createDelegateTool } from './delegate.js';
import type { DelegateOptions } from './delegate.js';
import type { Skill, SkillSource } from './skills.js';

export type { SelfEvolutionError, SelfEvolutionReport } from './self-evolving.js';
export { directorySkillSource, fileSkillSource, liveSkills, parseSkill, staticSkills } from './skills.js';
export type { LiveSkills, LiveSkillsOptions, Skill, SkillError, SkillFileSystem, SkillListing, SkillSource, SkillsOptions, SkillVersions } from './skills.js';
export { jsonSchemaTool } from './json-schema-tool.js';
export type { JsonObjectSchema, JsonSchemaToolOptions } from './json-schema-tool.js';
export { createDelegateTool, DELEGATE_DETAILS_KIND, DELEGATE_TOOL } from './delegate.js';
export type { DelegateDetails, DelegateEnd, DelegateLimits, DelegateMeter, DelegateModelEvent, DelegateOptions, DelegateStatus } from './delegate.js';

/** One agent as plain data over native Pi pieces. It is a convenience, not another registry or lifecycle. */
export interface AgentSpec {
  /** Stable name; it becomes the native extension name `agent.<id>`. */
  readonly id: string;
  readonly model: NonNullable<AgentChange['model']>;
  readonly instructions?: string;
  readonly thinkingLevel?: NonNullable<AgentChange['thinkingLevel']>;
  /** Tools owned by this agent. */
  readonly tools?: readonly ToolRegistration[];
  /** Additional native extensions this agent selects, for example Pi's `CodingTools`. */
  readonly extensions?: readonly Extension[];
  /**
   * The agent's skills: an array, or a `SkillSource` (`directorySkillSource`, `fileSkillSource` or a host's own) read on use with
   * `liveSkills`. A source cannot be combined with `selfEvolving`.
   */
  readonly skills?: readonly Skill[] | SkillSource;
  /**
   * Sub-agents this agent may hand a task to: each becomes a `delegate` tool (`createDelegateTool`) among this agent's tools, and
   * `install` installs the child agent's extensions too. The child runs in a conversation owned by the tool call, with only its own tools.
   */
  readonly delegates?: readonly (DelegateOptions & { readonly agent: DefinedAgent })[];
  /** Directory within the harness environment. */
  readonly cwd?: string;
  /**
   * Let the agent keep its own instructions, skills and tools in `.agent/` of its workspace and apply them with `reload`
   * (docs/architecture/SELF-EVOLUTION.md). Off by default: without it nothing reads `.agent/` (SELF-1).
   */
  readonly selfEvolving?: boolean;
  /**
   * The workspace instance this agent works in; names the per-workspace extension `self-evolving:<workspace>`. With `selfEvolving` and
   * no `workspace`, the agent works in a workspace per conversation: `inWorkspace(name)` gives the agent of one workspace.
   */
  readonly workspace?: string;
}

export interface DefinedAgent {
  readonly id: string;
  /** Every native extension this agent selects, own extension first; with `selfEvolving` the per-workspace extension (as first defined) last. */
  readonly extensions: readonly Extension[];
  /** Name and description of this agent's skills (an array given to `skills`), for hosts that offer them in a `/` menu. A source's skills are read at run time and not listed. */
  readonly skills: readonly Pick<Skill, 'name' | 'description'>[];
  /** Native per-conversation agent configuration. */
  readonly agent: AgentChange;
  /** Install this agent's extensions in a host registry. Installing the same extension twice replaces it in place. */
  readonly install: (registry: Registry) => void;
  /**
   * With `selfEvolving` only: rescan `.agent/` through `env` (the conversation's environment, or the workspace's on open) and replace
   * the per-workspace extension in every registry `install` was given. The `reload` tool and a host's `/reload` command call this.
   */
  readonly reload?: (env: ExecutionEnv | undefined, context: Context) => Promise<SelfEvolutionReport>;
  /** Create a native conversation configured as this agent. The host keeps the native handle. */
  readonly createConversation: (harness: Harness, context: Context, options?: Partial<Pick<ConversationCreateOptions, 'ownership' | 'init'>>) => Promise<Conversation>;
  /**
   * With `selfEvolving` and no fixed `workspace` only: this agent in workspace `name` (made once per name, then returned again), which
   * selects its own `self-evolving:<name>` extension last. One harness and one registry then serve a workspace per person: a
   * conversation created with `inWorkspace('a')` is offered what was reloaded from workspace `a` only, never another workspace's tools.
   */
  readonly inWorkspace?: (name: string) => DefinedAgent;
}

/** Turn an agent described as data into native extensions and a native agent configuration. */
export function defineAgent(spec: AgentSpec): DefinedAgent {
  if (!NAME.test(spec.id)) throw new TypeError(`Invalid agent id: ${spec.id}`);
  if (spec.workspace !== undefined && (typeof spec.workspace !== 'string' || !spec.workspace.trim())) throw new TypeError(`Agent ${spec.id}: workspace must be a non-empty name`);
  // Self-evolving (SELF-3): Pi renders native `instructions` after every extension section, so the host's instructions become the first
  // section of the agent's own (first) extension instead, and the agent-written section, in the last extension, comes after them.
  const base = spec.selfEvolving && spec.instructions !== undefined ? spec.instructions : undefined;
  const tools = [...spec.tools ?? [], ...(spec.delegates ?? []).map(createDelegateTool)];
  const own: Extension[] = [];
  if (tools.length || base !== undefined) {
    own.push(defineExtension({ name: `agent.${spec.id}`, tools, sections: base === undefined ? [] : [{ key: 'host-instructions', render: () => base }] }));
  }
  // The skills of a self-evolving agent live in its per-workspace extension, so agent-written skills join them on reload. Without a
  // workspace (a self-evolving agent whose workspace is chosen per conversation, before `inWorkspace`) they stay the host's alone.
  const evolving = spec.selfEvolving === true && spec.workspace !== undefined;
  if (spec.selfEvolving && spec.skills !== undefined && !isSkillArray(spec.skills)) throw new TypeError(`Agent ${spec.id}: selfEvolving takes an array of skills, not a SkillSource`);
  const fixed: readonly Skill[] = spec.skills === undefined ? [] : isSkillArray(spec.skills) ? spec.skills : [];
  const skillsName = `agent.${spec.id}.skills`;
  const hostSkills = spec.skills === undefined || evolving ? [] : isSkillArray(spec.skills)
    ? (spec.skills.length ? [staticSkills(spec.skills, { name: skillsName }).extension] : [])
    : [liveSkills(spec.skills, { name: skillsName }).extension];
  const listed = (skills: readonly Skill[]) => Object.freeze(skills.map(skill => Object.freeze({ name: skill.name, description: skill.description.trim() })));
  const reserved = [...tools, ...(spec.extensions ?? []).flatMap(extension => extension.tools ?? [])].map(tool => tool.name);

  /** The agent as one native configuration: its own extensions, the host's, and with `evolution` the per-workspace one last. */
  function assemble(selected: readonly Extension[], evolution: SelfEvolution | undefined, inWorkspace?: (name: string) => DefinedAgent): DefinedAgent {
    const initial = evolution?.current();
    const extensions = Object.freeze([...selected, ...(spec.extensions ?? []), ...(initial ? [initial] : [])]);
    if (new Set(extensions.map(extension => extension.name)).size !== extensions.length) throw new TypeError(`Agent ${spec.id} selects one extension name twice`);
    const agent: AgentChange = Object.freeze({
      model: spec.model, extensions,
      ...(spec.instructions === undefined || base !== undefined ? {} : { instructions: spec.instructions }),
      ...(spec.thinkingLevel === undefined ? {} : { thinkingLevel: spec.thinkingLevel }),
      ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
    });
    const fixedSkills = listed(fixed);
    return Object.freeze({
      id: spec.id, extensions, agent,
      get skills() { return evolution ? listed(evolution.skills()) : fixedSkills; },
      install: (registry: Registry) => {
        for (const delegate of spec.delegates ?? []) delegate.agent.install(registry);
        for (const extension of extensions) { if (extension === initial) evolution!.install(registry); else registry.install(extension); }
      },
      ...(evolution ? { reload: evolution.reload } : {}),
      createConversation: (harness: Harness, context: Context, options: Partial<Pick<ConversationCreateOptions, 'ownership' | 'init'>> = {}) =>
        harness.createConversation({ ownership: options.ownership ?? { kind: 'ownerless' }, agent, ...(options.init ? { init: options.init } : {}) }, context),
      ...(inWorkspace ? { inWorkspace } : {}),
    });
  }
  const evolutionOf = (workspace: string) => createSelfEvolution({
    name: `self-evolving:${workspace}`, skills: fixed.map(validSkill), reserved,
  });
  if (!spec.selfEvolving) return assemble([...own, ...hostSkills], undefined);
  if (spec.workspace !== undefined) return assemble(own, evolutionOf(spec.workspace));
  // A workspace per conversation: one evolution, and one agent configuration, per workspace name, made on first use.
  const perWorkspace = new Map<string, DefinedAgent>();
  return assemble([...own, ...hostSkills], undefined, name => {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError(`Agent ${spec.id}: a workspace name is required`);
    let found = perWorkspace.get(name);
    if (!found) { found = assemble(own, evolutionOf(name)); perWorkspace.set(name, found); }
    return found;
  });
}

/**
 * Bring existing conversations up to the agent's current instructions and default thinking level. A conversation keeps the agent it
 * was created with, so a changed deployment reaches it only through `configure`. The host keeps the hash of `[instructions,
 * thinkingLevel]` (`read`/`write`); when it differs from the agent's, every conversation is configured and the new hash is written
 * last, so a failed run is retried whole. Returns how many conversations were configured (0 when nothing changed).
 */
export async function refreshAgentState(options: {
  readonly conversations: Iterable<Conversation> | AsyncIterable<Conversation>;
  readonly agent: DefinedAgent;
  readonly read: () => string | undefined | null | Promise<string | undefined | null>;
  readonly write: (hash: string) => void | Promise<void>;
  readonly context: Context;
}): Promise<number> {
  const instructions = options.agent.agent.instructions ?? null, thinkingLevel = options.agent.agent.thinkingLevel ?? null;
  const hash = createHash('sha256').update(JSON.stringify([instructions, thinkingLevel])).digest('hex');
  if ((await options.read()) === hash) return 0;
  let configured = 0;
  for await (const conversation of options.conversations) {
    await conversation.configure({ instructions, thinkingLevel }, options.context);
    configured++;
  }
  await options.write(hash);
  return configured;
}

/**
 * Add one extension to an existing conversation, so its next turn runs with it (native `Conversation.commit` over the public
 * `pi.agent` document, `AgentDoc`). The conversation stores extension names only: the host installs `extension` in the Harness
 * registry, now and every time it opens the Harness, or the name selects nothing. Unlike `configure({ extensions: { add } })`,
 * which replaces a stored list (a `defineAgent` conversation's) with an edit of the host default selection, this appends to the
 * conversation's own list, so it keeps its other extensions and gains no one else's. Its tools are enabled and offered even when
 * the conversation lists its tools explicitly. Adding an extension twice changes nothing. Remove it with native `configure`.
 */
export async function addExtension(conversation: Conversation, extension: Extension, context: Context): Promise<void> {
  const tools = (extension.tools ?? []).map(tool => tool.name);
  await conversation.commit(async tx => {
    const state = await tx.doc(AgentDoc, conversation.id);
    const append = (list: string[], names: readonly string[]) => { for (const name of names) if (!list.includes(name)) list.push(name); };
    const selected = state.extensions;
    if (Array.isArray(selected)) append(selected, [extension.name]);
    else {
      const add = [...selected?.add ?? []]; append(add, [extension.name]);
      const remove = (selected?.remove ?? []).filter(name => name !== extension.name);
      state.extensions = { add, ...(remove.length ? { remove } : {}) };
    }
    if (Array.isArray(state.tools)) append(state.tools, tools);
    else if (state.tools) state.tools = { remove: state.tools.remove.filter(name => !tools.includes(name)) };
    if (Array.isArray(state.modelTools)) append(state.modelTools, tools);
  }, context);
}
