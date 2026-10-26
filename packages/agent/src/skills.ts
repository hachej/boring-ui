import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import type { Extension } from '@earendil-works/pi-durable';
import type { FileInfo, FileSystem } from '@earendil-works/pi-durable/env';
import type { Context } from '@earendil-works/chord';
import { Type } from '@earendil-works/pi-ai';

/** Names of skills and agents: a lowercase letter or digit, then lowercase letters, digits, `.`, `_` or `-` (at most 64). */
export const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Instructions the agent loads on demand: only name and description occupy the system prompt. */
export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

const skillFolders = new WeakMap<Skill, string>();

export function skillInFolder(skill: Skill, folder: string): Skill {
  skillFolders.set(skill, folder);
  return skill;
}

/** Parse a `SKILL.md`-style document: `---` front matter with `name` and `description`, then the body. */
export function parseSkill(markdown: string): Skill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
  if (!match) throw new TypeError('Skill needs front matter with name and description');
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, '$2'));
  }
  const name = fields.get('name'), description = fields.get('description');
  if (!name || !description) throw new TypeError('Skill front matter needs name and description');
  return validSkill({ name, description, body: match[2]!.trim() });
}

export function validSkill(skill: Skill): Skill {
  if (!NAME.test(skill.name)) throw new TypeError(`Invalid skill name: ${skill.name}`);
  if (!skill.description.trim() || !skill.body.trim()) throw new TypeError(`Skill ${skill.name} needs a description and a body`);
  const valid = Object.freeze({ name: skill.name, description: skill.description.trim(), body: skill.body });
  const folder = skillFolders.get(skill);
  return folder === undefined ? valid : skillInFolder(valid, folder);
}

/** A skill a live source left out, and why. `name` is the folder or file name when the skill itself could not be read. */
export interface SkillError { readonly path: string; readonly name?: string; readonly message: string }
/** What a source holds now: skills not yet validated, and the files it could not read. */
export interface SkillListing { readonly skills: readonly Skill[]; readonly errors: readonly SkillError[] }

/**
 * Skills that can change while the agent runs. `version()` is a cheap token that changes when the skills change; `list()`
 * reads them. The built-in sources read through the workspace's Pi `FileSystem`; a host may write its own.
 */
export interface SkillSource {
  readonly list: (context: Context) => Promise<SkillListing>;
  readonly version: (context: Context) => Promise<string>;
}

/** The part of Pi's `FileSystem` the built-in sources read through (an `ExecutionEnv` is one). */
export type SkillFileSystem = Pick<FileSystem, 'readTextFile' | 'listDir' | 'fileInfo'>;

const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
const parent = (path: string) => { const at = path.lastIndexOf('/'); return at < 0 ? '.' : path.slice(0, at); };
const stamp = (info: FileInfo) => `${info.mtimeMs}:${info.size}`;
/** The file a built-in source read each skill from, so a skill left out later is reported at its file. */
const skillFiles = new WeakMap<Skill, string>();

async function readSkillFile(fs: SkillFileSystem, path: string, name: string, context: Context): Promise<Skill | SkillError> {
  const text = await fs.readTextFile(path, context);
  if (!text.ok) return { path, name, message: text.error.message };
  try { const skill = skillInFolder(parseSkill(text.value), parent(path)); skillFiles.set(skill, path); return skill; } catch (error) { return { path, name, message: reason(error) }; }
}

/** Every `<directory>/<name>/SKILL.md`; a missing directory holds no skills. Other files are companions and are never read. */
export function directorySkillSource(fs: SkillFileSystem, directory: string): SkillSource {
  const root = directory.replace(/\/+$/, '');
  async function folders(context: Context): Promise<{ names: string[]; error?: SkillError }> {
    const listed = await fs.listDir(root, context);
    if (!listed.ok) return listed.error.code === 'not_found' ? { names: [] } : { names: [], error: { path: root, message: listed.error.message } };
    return { names: listed.value.filter(entry => entry.kind === 'directory').map(entry => entry.name).sort() };
  }
  const info = (name: string, context: Context) => fs.fileInfo(`${root}/${name}/SKILL.md`, context);
  return {
    version: async context => {
      const { names, error } = await folders(context);
      if (error) return `error:${error.message}`;
      const stamps = await Promise.all(names.map(async name => {
        const found = await info(name, context);
        return `${name}=${found.ok ? stamp(found.value) : found.error.code}`;
      }));
      return stamps.join('|');
    },
    list: async context => {
      const { names, error } = await folders(context);
      const skills: Skill[] = [], errors: SkillError[] = error ? [error] : [];
      for (const name of names) {
        const found = await info(name, context);
        if (!found.ok && found.error.code === 'not_found') continue;
        const read = await readSkillFile(fs, `${root}/${name}/SKILL.md`, name, context);
        if ('body' in read) skills.push(read); else errors.push(read);
      }
      return { skills, errors };
    },
  };
}

/** One skill file (`SKILL.md` front matter); a missing file holds no skill. Its folder is the file's directory. */
export function fileSkillSource(fs: SkillFileSystem, path: string): SkillSource {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  return {
    version: async context => {
      const found = await fs.fileInfo(path, context);
      return found.ok ? stamp(found.value) : found.error.code;
    },
    list: async context => {
      const read = await readSkillFile(fs, path, name, context);
      if ('body' in read) return { skills: [read], errors: [] };
      const found = await fs.fileInfo(path, context);
      return !found.ok && found.error.code === 'not_found' ? { skills: [], errors: [] } : { skills: [], errors: [read] };
    },
  };
}

export interface SkillsExtensionOptions {
  /** How long a source's copy is used before `version()` is asked again, in milliseconds. Default 5000. Unused for an array. */
  readonly maxAgeMs?: number;
  /** Called after each read of a source with every skill it left out (an empty array when none). */
  readonly onDiagnostics?: (errors: readonly SkillError[]) => void;
}

interface Loaded { readonly known: ReadonlyMap<string, Skill>; readonly errors: readonly SkillError[] }

/** Validate what a source returned with `validSkill` and the duplicate rule: what fails is left out and reported, never thrown. */
function loaded(listing: SkillListing): Loaded {
  const known = new Map<string, Skill>(), errors = [...listing.errors];
  for (const raw of listing.skills) {
    const path = skillFiles.get(raw) ?? skillFolders.get(raw) ?? '';
    let skill: Skill;
    try { skill = validSkill(raw); } catch (error) { errors.push({ path, name: raw.name, message: reason(error) }); continue; }
    if (known.has(skill.name)) { errors.push({ path, name: skill.name, message: `Duplicate skill: ${skill.name}` }); continue; }
    known.set(skill.name, skill);
  }
  return { known, errors };
}

/** The current copy of a source: read again once it is older than `maxAgeMs` and `version()` changed. Concurrent callers share one read. */
function liveSkills(source: SkillSource, options: SkillsExtensionOptions): (context: Context) => Promise<Loaded> {
  const maxAgeMs = options.maxAgeMs ?? 5000;
  let state: Loaded = { known: new Map(), errors: [] };
  let version: string | undefined, checkedAt = -Infinity, pending: Promise<Loaded> | undefined;
  async function refresh(context: Context): Promise<Loaded> {
    const next = await source.version(context);
    if (next !== version) {
      state = loaded(await source.list(context));
      version = next;
      options.onDiagnostics?.(state.errors);
    }
    checkedAt = Date.now();
    return state;
  }
  return context => {
    if (Date.now() - checkedAt < maxAgeMs) return Promise.resolve(state);
    return pending ??= refresh(context).finally(() => { pending = undefined; });
  };
}

const INTRO = 'Before starting a task that matches a skill, call load_skill with its name and follow the returned instructions. A user message that starts with /<skill-name> naming one of these skills is an explicit request: call load_skill for that skill first and follow it for the rest of the message.';

/**
 * A prompt section listing the skills and a `load_skill` tool returning one body. Usable without `defineAgent`.
 * A fixed array is validated now: an invalid or duplicate skill throws. A `SkillSource` is read on first use and again, once
 * the copy is older than `maxAgeMs`, when its version changed; what it cannot use is left out and reported, never thrown.
 */
export function createSkillsExtension(name: string, skills: readonly Skill[] | SkillSource, options: SkillsExtensionOptions = {}): Extension {
  let current: (context: Context) => Promise<Loaded>;
  if (isSkillArray(skills)) {
    const known = new Map<string, Skill>();
    for (const skill of skills.map(validSkill)) {
      if (known.has(skill.name)) throw new TypeError(`Duplicate skill: ${skill.name}`);
      known.set(skill.name, skill);
    }
    const fixed: Loaded = { known, errors: [] };
    current = async () => fixed;
  } else current = liveSkills(skills, options);
  return defineExtension({
    name,
    sections: [{ key: 'skills', render: async (_input, context) => {
      const { known } = await current(context);
      return known.size ? `${INTRO}\n${[...known.values()].map(skill => `- ${skill.name}: ${skill.description}`).join('\n')}` : undefined;
    } }],
    tools: [defineTool({
      name: 'load_skill',
      description: 'Load the full instructions of one listed skill.',
      parameters: Type.Object({ name: Type.String() }, { additionalProperties: false }),
      replay: 'safe',
      execute: async (args, _api, context) => {
        const { known, errors } = await current(context);
        const skill = known.get(args.name);
        if (!skill) {
          const failed = errors.find(error => error.name === args.name);
          const text = failed ? `Skill "${args.name}" could not be loaded (${failed.path}): ${failed.message}` : `Unknown skill "${args.name}". Available: ${[...known.keys()].join(', ')}`;
          return { output: [{ type: 'text', text }] };
        }
        const folder = skillFolders.get(skill);
        const location = folder === undefined ? '' : `\n\nThis skill's folder is \`${folder}\`; paths in it are relative to that folder.`;
        return { output: [{ type: 'text', text: skill.body + location }] };
      },
    })],
  });
}

const isSkillArray = (skills: readonly Skill[] | SkillSource): skills is readonly Skill[] => Array.isArray(skills);
