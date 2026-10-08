import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import type { Extension, PromptSection, Registry, ToolExecutionResult, ToolRegistration } from '@earendil-works/pi-durable';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { Type } from '@earendil-works/pi-ai';
import type { Context } from '@earendil-works/chord';
import type { Skill } from './skills.js';
import { jsonSchemaTool } from './json-schema-tool.js';

/*
 * Self-evolution (docs/architecture/SELF-EVOLUTION.md, laws SELF-1..4 in this package's README): an agent keeps its own standing
 * instructions, skills and tools in the `.agent/` folder of its workspace and applies them with `reload`. Everything is read through
 * the conversation's own ExecutionEnv (its FileSystem and, for tools, its `exec`): the host never imports or evaluates what the agent
 * wrote. The result is one native extension per workspace, replaced in place with the native `registry.install()`.
 */

/** The folder, relative to the environment's working directory. */
export const AGENT_FOLDER = '.agent';
/** Largest part of `.agent/AGENTS.md` put in the prompt, in characters. */
export const MAX_AGENT_INSTRUCTIONS = 16_000;
const INSTRUCTIONS = `${AGENT_FOLDER}/AGENTS.md`, SKILLS = `${AGENT_FOLDER}/skills`, TOOLS = `${AGENT_FOLDER}/tools`;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const ARGS_END = 'BORING_AGENT_TOOL_ARGS';

export interface SelfEvolutionError { readonly path: string; readonly message: string }
/** What one scan found and applied. `text` is what the `reload` tool and the person's `/reload` show. */
export interface SelfEvolutionReport {
  readonly extension: string;
  readonly tools: { readonly available: boolean; readonly added: string[]; readonly changed: string[]; readonly removed: string[]; readonly current: string[] };
  readonly skills: string[];
  readonly instructions: { readonly present: boolean; readonly characters: number; readonly truncated: boolean };
  readonly errors: SelfEvolutionError[];
  readonly text: string;
}

interface ToolDescription { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown>; readonly run: string; readonly path: string }

export interface SelfEvolutionOptions {
  /** The native extension name, one per workspace (`self-evolving:<workspace>`). */
  readonly name: string;
  /** The host's skills: listed first; an agent-written skill of the same name is refused. */
  readonly skills: readonly Skill[];
  /** Tool names the agent already has from the host; an agent-written tool may not take one. */
  readonly reserved: readonly string[];
  readonly parseSkill: (markdown: string) => Skill;
  readonly skillsExtension: (name: string, skills: readonly Skill[]) => Extension;
}

export interface SelfEvolution {
  /** The extension as it is now (the host's skills, `reload` and the agent-written section before the first scan). */
  readonly current: () => Extension;
  /** Skills now offered: the host's, then the agent's. */
  readonly skills: () => readonly Skill[];
  /** Install the current extension and keep the registry for later reloads. */
  readonly install: (registry: Registry) => void;
  /** Rescan `.agent/` through `env` and replace the extension in every registry it was installed in. */
  readonly reload: (env: ExecutionEnv | undefined, context: Context) => Promise<SelfEvolutionReport>;
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (names: readonly string[]) => names.length ? names.join(', ') : 'none';
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The labelled agent-written section: rendered on every request from `.agent/AGENTS.md`, after the host's instructions. */
export function agentInstructionsSection(): PromptSection {
  return {
    key: 'agent-written',
    render: async (input, context) => {
      if (input.env === undefined) return undefined;
      const read = await input.env.readTextFile(INSTRUCTIONS, context);
      if (!read.ok) return undefined;
      const text = read.value.trim();
      if (!text) return undefined;
      const shown = text.length > MAX_AGENT_INSTRUCTIONS
        ? `${text.slice(0, MAX_AGENT_INSTRUCTIONS)}\n[Truncated: ${INSTRUCTIONS} has ${text.length} characters; only the first ${MAX_AGENT_INSTRUCTIONS} are shown.]`
        : text;
      return `Agent-written: standing instructions you wrote for yourself in ${INSTRUCTIONS}. They come after the host's instructions and never override them.\n\n${shown}`;
    },
  };
}

/** Runs `run` through the conversation's environment with the arguments as one line of JSON on stdin; the output is the result. */
async function runTool(description: ToolDescription, env: ExecutionEnv | undefined, args: unknown, context: Context): Promise<ToolExecutionResult> {
  if (env === undefined || typeof env.exec !== 'function') return { content: [{ type: 'text', text: `${description.name} cannot run: this conversation has no execution environment.` }], isError: true };
  let output = '';
  const command = `{ ${description.run}\n} <<'${ARGS_END}'\n${JSON.stringify(args ?? {})}\n${ARGS_END}`;
  const result = await env.exec(command, { onOutput: text => { output += text; } }, context);
  if (!result.ok) return { content: [{ type: 'text', text: `${description.name} failed: ${result.error.message}${output ? `\n${output}` : ''}` }], isError: true };
  const failed = result.value.exitCode !== 0;
  return { content: [{ type: 'text', text: output || '(no output)' }], ...(failed ? { isError: true, diagnostics: [{ severity: 'error' as const, message: `${description.run} exited with code ${result.value.exitCode}` }] } : {}) };
}

/** The Harness validates each call's arguments against the agent-written schema before `run` starts (see `jsonSchemaTool`). */
function toolOf(description: ToolDescription): ToolRegistration {
  return jsonSchemaTool({
    name: description.name, description: description.description, parameters: description.parameters,
    execute: (args, api, context) => runTool(description, api.env, args, context),
  });
}

/** Validates one tool description; returns it or a reason. Paths that `run` names under `.agent/` must exist. */
async function describe(env: ExecutionEnv, path: string, text: string, reserved: ReadonlySet<string>, context: Context): Promise<ToolDescription | string> {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { return `invalid JSON: ${reason(error)}`; }
  if (!isObject(value)) return 'a tool description is a JSON object { name, description, parameters, run }';
  const extra = Object.keys(value).filter(key => !['name', 'description', 'parameters', 'run'].includes(key));
  if (extra.length) return `unknown field ${extra.join(', ')}`;
  const { name, description, parameters, run } = value;
  if (typeof name !== 'string' || !TOOL_NAME.test(name)) return 'name must be snake_case: a lowercase letter, then lowercase letters, digits or _ (at most 64)';
  if (reserved.has(name)) return `the name ${name} is already a tool of this agent`;
  if (typeof description !== 'string' || !description.trim() || description.length > 2000) return 'description must be a non-empty string of at most 2000 characters';
  if (!isObject(parameters) || parameters['type'] !== 'object') return 'parameters must be a JSON Schema object with "type": "object"';
  if (parameters['properties'] !== undefined && !isObject(parameters['properties'])) return 'parameters.properties must be an object';
  if (parameters['required'] !== undefined && !(Array.isArray(parameters['required']) && parameters['required'].every(item => typeof item === 'string'))) return 'parameters.required must be a list of property names';
  if (typeof run !== 'string' || !run.trim() || run.length > 2000 || /[\r\n\0]/.test(run)) return 'run must be one command line (at most 2000 characters)';
  for (const token of run.split(/\s+/)) {
    const script = token.replace(/^['"]|['"]$/g, '');
    if (!script.startsWith(`${AGENT_FOLDER}/`) && !script.startsWith(`./${AGENT_FOLDER}/`)) continue;
    const found = await env.exists(script, context);
    if (!found.ok || !found.value) return `run names ${script}, which does not exist`;
  }
  return { name, description: description.trim(), parameters, run: run.trim(), path };
}

/** Files directly in `directory` with `suffix`, sorted; `missing` when the directory does not exist. */
async function filesIn(env: ExecutionEnv, directory: string, suffix: string, context: Context): Promise<string[] | 'missing' | { error: string }> {
  const listed = await env.listDir(directory, context);
  if (!listed.ok) return listed.error.code === 'not_found' ? 'missing' : { error: listed.error.message };
  return listed.value.filter(entry => entry.kind === 'file' && entry.name.endsWith(suffix)).map(entry => `${directory}/${entry.name}`).sort();
}

export function createSelfEvolution(options: SelfEvolutionOptions): SelfEvolution {
  const { name, parseSkill, skillsExtension } = options;
  const hostSkills = [...options.skills];
  const registries = new Set<Registry>();
  let agentSkills: Skill[] = [];
  let described = new Map<string, ToolDescription>();
  let queue: Promise<unknown> = Promise.resolve();

  const reloadTool = defineTool({
    name: 'reload',
    description: `Apply the changes you made to your own ${AGENT_FOLDER}/ folder in the workspace, then return what was added, changed and removed and every load error. `
      + `${INSTRUCTIONS}: standing instructions for yourself, shown after the host's instructions on every request. `
      + `${SKILLS}/<name>.md: skills (front matter with name and description between --- lines, then the instructions), loaded with load_skill. `
      + `${TOOLS}/<name>.json: your own tools, {"name": "snake_case", "description": "...", "parameters": {a JSON Schema with "type": "object"}, "run": "a command run in the workspace, for example sh ${TOOLS}/<name>.sh"}; `
      + 'the arguments arrive as one line of JSON on standard input and the command output is the result. Restore or delete the files and reload to undo a change.',
    parameters: Type.Object({}, { additionalProperties: false }),
    replay: 'safe',
    executionMode: 'sequential',
    execute: async (_args, api, context) => {
      const report = await reload(api.env, context);
      return { content: [{ type: 'text', text: report.text }], details: JSON.parse(JSON.stringify(report)) };
    },
  });
  const section = agentInstructionsSection();

  function build(tools: readonly ToolDescription[]): Extension {
    const skills = [...hostSkills, ...agentSkills];
    const offered = skills.length ? skillsExtension(`${name}.skills`, skills) : undefined;
    return defineExtension({
      name,
      tools: [reloadTool, ...(offered?.tools ?? []), ...tools.map(toolOf)],
      sections: [...(offered?.sections ?? []), section],
    });
  }
  let current = build([]);

  async function scan(env: ExecutionEnv, context: Context) {
    const errors: SelfEvolutionError[] = [];
    // Instructions are rendered by the section on every request; the scan reports what it will show.
    let instructions = { present: false, characters: 0, truncated: false };
    const read = await env.readTextFile(INSTRUCTIONS, context);
    if (read.ok) { const text = read.value.trim(); instructions = { present: text.length > 0, characters: text.length, truncated: text.length > MAX_AGENT_INSTRUCTIONS }; }
    else if (read.error.code !== 'not_found') errors.push({ path: INSTRUCTIONS, message: read.error.message });

    const skills: Skill[] = [];
    const skillFiles = await filesIn(env, SKILLS, '.md', context);
    if (typeof skillFiles === 'object' && !Array.isArray(skillFiles)) errors.push({ path: SKILLS, message: skillFiles.error });
    for (const path of Array.isArray(skillFiles) ? skillFiles : []) {
      const text = await env.readTextFile(path, context);
      if (!text.ok) { errors.push({ path, message: text.error.message }); continue; }
      let skill: Skill;
      try { skill = parseSkill(text.value); } catch (error) { errors.push({ path, message: reason(error) }); continue; }
      if ([...hostSkills, ...skills].some(other => other.name === skill.name)) { errors.push({ path, message: `a skill named ${skill.name} already exists` }); continue; }
      skills.push(skill);
    }

    const available = typeof env.exec === 'function';
    const tools: ToolDescription[] = [];
    const toolFiles = await filesIn(env, TOOLS, '.json', context);
    if (typeof toolFiles === 'object' && !Array.isArray(toolFiles)) errors.push({ path: TOOLS, message: toolFiles.error });
    const files = Array.isArray(toolFiles) ? toolFiles : [];
    if (!available && files.length) errors.push({ path: TOOLS, message: `tools are unavailable here: this environment has no exec, so ${files.length} tool description(s) were not loaded` });
    const reserved = new Set([...options.reserved, 'reload', 'load_skill']);
    for (const path of available ? files : []) {
      const text = await env.readTextFile(path, context);
      if (!text.ok) { errors.push({ path, message: text.error.message }); continue; }
      const result = await describe(env, path, text.value, new Set([...reserved, ...tools.map(tool => tool.name)]), context);
      if (typeof result === 'string') errors.push({ path, message: result }); else tools.push(result);
    }
    return { errors, instructions, skills, tools, available };
  }

  async function apply(env: ExecutionEnv | undefined, context: Context): Promise<SelfEvolutionReport> {
    if (env === undefined) {
      const errors = [{ path: AGENT_FOLDER, message: 'this conversation has no execution environment; nothing was changed' }];
      return report({ available: false, added: [], changed: [], removed: [], current: [...described.keys()] }, agentSkills, { present: false, characters: 0, truncated: false }, errors);
    }
    const found = await scan(env, context);
    const next = new Map(found.tools.map(tool => [tool.name, tool]));
    const same = (a: ToolDescription, b: ToolDescription) => JSON.stringify([a.description, a.parameters, a.run]) === JSON.stringify([b.description, b.parameters, b.run]);
    const added = [...next.keys()].filter(key => !described.has(key));
    const changed = [...next.keys()].filter(key => described.has(key) && !same(described.get(key)!, next.get(key)!));
    const removed = [...described.keys()].filter(key => !next.has(key));
    agentSkills = found.skills;
    described = next;
    current = build(found.tools);
    // Native replacement in place: the next request of every conversation selecting this extension sees the new tools; a call
    // already running finishes with the registration it started with.
    for (const registry of registries) registry.install(current);
    return report({ available: found.available, added, changed, removed, current: [...next.keys()] }, found.skills, found.instructions, found.errors);
  }

  function report(tools: SelfEvolutionReport['tools'], skills: readonly Skill[], instructions: SelfEvolutionReport['instructions'], errors: SelfEvolutionError[]): SelfEvolutionReport {
    const lines = [
      `Reloaded ${AGENT_FOLDER}/ (${name}).`,
      tools.available
        ? `Tools added: ${list(tools.added)}. Changed: ${list(tools.changed)}. Removed: ${list(tools.removed)}. Now: ${list(tools.current)}.`
        : 'Tools: unavailable in this environment (no exec).',
      `Skills: ${list(skills.map(skill => skill.name))}.`,
      `Instructions: ${instructions.present ? `${INSTRUCTIONS}, ${instructions.characters} characters${instructions.truncated ? ` (only the first ${MAX_AGENT_INSTRUCTIONS} are shown)` : ''}, after the host's instructions` : 'none'}.`,
      errors.length ? `Errors (${errors.length}):\n${errors.map(error => `- ${error.path}: ${error.message}`).join('\n')}` : 'Errors: none.',
    ];
    return { extension: name, tools, skills: skills.map(skill => skill.name), instructions, errors, text: lines.join('\n') };
  }

  const reload = (env: ExecutionEnv | undefined, context: Context) => {
    const run = queue.then(() => apply(env, context));
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    current: () => current,
    skills: () => [...hostSkills, ...agentSkills],
    install: registry => { registries.add(registry); registry.install(current); },
    reload,
  };
}
