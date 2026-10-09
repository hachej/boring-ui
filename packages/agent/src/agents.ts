import { createHash } from 'node:crypto';
import { defineExtension } from '@earendil-works/pi-durable';
import type { AgentChange, Conversation, ConversationCreateOptions, Extension, Harness, Registry, ToolRegistration } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { createSelfEvolution } from './self-evolving.js';
import type { SelfEvolution, SelfEvolutionReport } from './self-evolving.js';
import { NAME, createSkillsExtension, parseSkill, validSkill } from './skills.js';
import type { Skill } from './skills.js';

export type { SelfEvolutionError, SelfEvolutionReport } from './self-evolving.js';
export { createSkillsExtension, parseSkill } from './skills.js';
export type { Skill } from './skills.js';
export { jsonSchemaTool } from './json-schema-tool.js';
export type { JsonObjectSchema, JsonSchemaToolOptions } from './json-schema-tool.js';

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
  readonly skills?: readonly Skill[];
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
  /** Name and description of this agent's skills, for hosts that offer them in a `/` menu. */
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
  const own: Extension[] = [];
  if (spec.tools?.length || base !== undefined) {
    own.push(defineExtension({ name: `agent.${spec.id}`, tools: [...spec.tools ?? []], sections: base === undefined ? [] : [{ key: 'host-instructions', render: () => base }] }));
  }
  // The skills of a self-evolving agent live in its per-workspace extension, so agent-written skills join them on reload. Without a
  // workspace (a self-evolving agent whose workspace is chosen per conversation, before `inWorkspace`) they stay the host's alone.
  const evolving = spec.selfEvolving === true && spec.workspace !== undefined;
  const hostSkills = spec.skills?.length && !evolving ? [createSkillsExtension(`agent.${spec.id}.skills`, spec.skills)] : [];
  const listed = (skills: readonly Skill[]) => Object.freeze(skills.map(skill => Object.freeze({ name: skill.name, description: skill.description.trim() })));
  const reserved = [...(spec.tools ?? []), ...(spec.extensions ?? []).flatMap(extension => extension.tools ?? [])].map(tool => tool.name);

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
    const fixedSkills = listed(spec.skills ?? []);
    return Object.freeze({
      id: spec.id, extensions, agent,
      get skills() { return evolution ? listed(evolution.skills()) : fixedSkills; },
      install: (registry: Registry) => { for (const extension of extensions) { if (extension === initial) evolution!.install(registry); else registry.install(extension); } },
      ...(evolution ? { reload: evolution.reload } : {}),
      createConversation: (harness: Harness, context: Context, options: Partial<Pick<ConversationCreateOptions, 'ownership' | 'init'>> = {}) =>
        harness.createConversation({ ownership: options.ownership ?? { kind: 'ownerless' }, agent, ...(options.init ? { init: options.init } : {}) }, context),
      ...(inWorkspace ? { inWorkspace } : {}),
    });
  }
  const evolutionOf = (workspace: string) => createSelfEvolution({
    name: `self-evolving:${workspace}`, skills: (spec.skills ?? []).map(validSkill), parseSkill, skillsExtension: createSkillsExtension, reserved,
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
