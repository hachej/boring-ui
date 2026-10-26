import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import type { ConversationId, Extension } from '@earendil-works/pi-durable';
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
  /** The FileSystem the skills' folders live in; the built-in sources set it. `companions` reads through it. */
  readonly fs?: SkillFileSystem;
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
    fs,
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
    fs,
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

/** What `visible` is told about the asking conversation: Pi's own id (`PromptInput.conversationId`, `ToolExecutionApi.conversationId`). */
export interface SkillVisibility { readonly conversationId: ConversationId; readonly context: Context }

export interface SkillsExtensionOptions {
  /** How long a source's copy is used before `version()` is asked again, in milliseconds. Default 5000. Unused for an array. */
  readonly maxAgeMs?: number;
  /** Called after each read of a source with every skill it left out (an empty array when none), or with the `onPublish` refusal. */
  readonly onDiagnostics?: (errors: readonly SkillError[]) => void;
  /**
   * Which skills a conversation sees, asked on every listing and `load_skill` call. A hidden skill is left out of the listing
   * and `load_skill` answers for it exactly as for an unknown name. With a filter, a skill that could not be read also answers
   * as unknown (its reason still goes to `onDiagnostics`), since no `Skill` exists to ask about.
   */
  readonly visible?: (skill: Skill, at: SkillVisibility) => boolean | Promise<boolean>;
  /**
   * List the files beside each `SKILL.md` (at any depth, symbolic links left out) in `load_skill`'s answer, and let
   * `load_skill({ name, path })` return one of them as text. Read through the source's `fs`; an array or a source without
   * `fs` throws.
   */
  readonly companions?: boolean;
  /**
   * Called before a newly read listing of a source replaces the current one, with both listings' skills. Return a reason
   * (or throw) to refuse it: the current listing stays, and `onDiagnostics` gets `Listing refused by onPublish: <reason>`.
   * A refused listing is offered again only once the source's version changes or `refresh()` is called.
   */
  readonly onPublish?: (next: readonly Skill[], previous: readonly Skill[]) => string | void | Promise<string | void>;
}

/** A skills extension on a source, with a handle to re-read the source now. */
export interface SkillsController {
  readonly extension: Extension;
  /**
   * Read the source now, whatever `maxAgeMs`, and publish what it holds (through `onPublish`). With `name`, only that skill
   * is taken from the new read (added, replaced or removed); the others stay as they were. Resolves `true` when published,
   * `false` when `onPublish` refused it.
   */
  readonly refresh: (context: Context, name?: string) => Promise<boolean>;
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
    const file = skillFiles.get(raw);
    if (file !== undefined) skillFiles.set(skill, file);
    known.set(skill.name, skill);
  }
  return { known, errors };
}

/** `next` with only `name` taken from it; the rest of `current` is kept. */
function only(name: string, next: Loaded, current: Loaded): Loaded {
  const known = new Map(current.known), skill = next.known.get(name);
  if (skill) known.set(name, skill); else known.delete(name);
  return { known, errors: [...current.errors.filter(error => error.name !== name), ...next.errors.filter(error => error.name === name)] };
}

/**
 * The current copy of a source: read again once it is older than `maxAgeMs` and `version()` changed, or when `refresh` asks.
 * Reads run one at a time; concurrent callers of `current` share one.
 */
function liveSkills(source: SkillSource, options: SkillsExtensionOptions) {
  const maxAgeMs = options.maxAgeMs ?? 5000;
  let state: Loaded = { known: new Map(), errors: [] };
  let version: string | undefined, checkedAt = -Infinity, pending: Promise<Loaded> | undefined, queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => { const next = queue.then(run, run); queue = next.catch(() => {}); return next; };
  async function refusal(next: Loaded): Promise<string | undefined> {
    if (!options.onPublish) return undefined;
    try { return (await options.onPublish([...next.known.values()], [...state.known.values()])) ?? undefined; } catch (error) { return reason(error); }
  }
  async function publish(next: Loaded): Promise<boolean> {
    const refused = await refusal(next);
    if (refused !== undefined) { options.onDiagnostics?.([{ path: '', message: `Listing refused by onPublish: ${refused}` }]); return false; }
    state = next;
    options.onDiagnostics?.(state.errors);
    return true;
  }
  async function check(context: Context): Promise<Loaded> {
    const next = await source.version(context);
    if (next !== version) {
      const read = loaded(await source.list(context));
      version = next;
      await publish(read);
    }
    checkedAt = Date.now();
    return state;
  }
  return {
    current: (context: Context): Promise<Loaded> => {
      if (Date.now() - checkedAt < maxAgeMs) return Promise.resolve(state);
      return pending ??= serial(() => check(context)).finally(() => { pending = undefined; });
    },
    refresh: (context: Context, name?: string): Promise<boolean> => serial(async () => {
      const next = await source.version(context), read = loaded(await source.list(context));
      // One skill taken: the copy no longer matches any version, so the next check reads the whole source again.
      version = name === undefined ? next : undefined;
      checkedAt = Date.now();
      return publish(name === undefined ? read : only(name, read, state));
    }),
  };
}

const INTRO = 'Before starting a task that matches a skill, call load_skill with its name and follow the returned instructions. A user message that starts with /<skill-name> naming one of these skills is an explicit request: call load_skill for that skill first and follow it for the rest of the message.';
const COMPANION_LIMIT = 200;

/** The files beside a skill's `SKILL.md`, relative to its folder, depth first in name order; symbolic links are left out. */
async function companionFiles(fs: SkillFileSystem, skill: Skill, context: Context): Promise<string[]> {
  const folder = skillFolders.get(skill), file = skillFiles.get(skill);
  if (folder === undefined || (file !== undefined && !/(^|\/)SKILL\.md$/.test(file))) return [];
  const at = (relative: string) => relative === '' ? folder : folder === '.' ? relative : `${folder}/${relative}`;
  const files: string[] = [];
  async function walk(relative: string): Promise<void> {
    const listed = await fs.listDir(at(relative), context);
    if (!listed.ok) return;
    for (const entry of [...listed.value].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (files.length >= COMPANION_LIMIT) return;
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.kind === 'directory') await walk(path);
      else if (entry.kind === 'file' && path !== 'SKILL.md') files.push(path);
    }
  }
  await walk('');
  return files;
}

/** The listing section and `load_skill` over `current`, filtered per conversation by `visible`. */
function skillsExtension(name: string, current: (context: Context) => Promise<Loaded>, options: SkillsExtensionOptions, fs: SkillFileSystem | undefined): Extension {
  const { visible } = options;
  // `at` is read only with a filter, so direct callers of render/execute without Pi's input or api keep working.
  async function seen(known: ReadonlyMap<string, Skill>, at: () => ConversationId, context: Context): Promise<Skill[]> {
    const all = [...known.values()];
    if (!visible) return all;
    const conversationId = at();
    const shown = await Promise.all(all.map(skill => visible(skill, { conversationId, context })));
    return all.filter((_, index) => shown[index]);
  }
  const parameters = fs
    ? Type.Object({ name: Type.String(), path: Type.Optional(Type.String({ description: 'A companion file of the skill, relative to its folder.' })) }, { additionalProperties: false })
    : Type.Object({ name: Type.String() }, { additionalProperties: false });
  return defineExtension({
    name,
    sections: [{ key: 'skills', render: async (input, context) => {
      const skills = await seen((await current(context)).known, () => input.conversationId, context);
      return skills.length ? `${INTRO}\n${skills.map(skill => `- ${skill.name}: ${skill.description}`).join('\n')}` : undefined;
    } }],
    tools: [defineTool({
      name: 'load_skill',
      description: fs ? 'Load the full instructions of one listed skill, or with `path` one of its companion files.' : 'Load the full instructions of one listed skill.',
      parameters,
      replay: 'safe',
      execute: async (args: { name: string; path?: string }, api, context) => {
        const text = (value: string) => ({ output: [{ type: 'text' as const, text: value }] });
        const { known, errors } = await current(context);
        const shown = await seen(known, () => api.conversationId, context);
        const skill = shown.find(candidate => candidate.name === args.name);
        if (!skill) {
          const failed = visible ? undefined : errors.find(error => error.name === args.name);
          return text(failed ? `Skill "${args.name}" could not be loaded (${failed.path}): ${failed.message}` : `Unknown skill "${args.name}". Available: ${shown.map(entry => entry.name).join(', ')}`);
        }
        const folder = skillFolders.get(skill);
        const companions = fs ? await companionFiles(fs, skill, context) : [];
        if (fs && args.path !== undefined) {
          // Only a listed file is read, so the path cannot leave the folder or follow a symbolic link.
          const path = args.path.replace(/^(\.\/)+/, '');
          if (!companions.includes(path)) return text(`Skill "${skill.name}" has no companion file "${args.path}". Companion files: ${companions.join(', ') || 'none'}`);
          const read = await fs.readTextFile(folder === '.' ? path : `${folder}/${path}`, context);
          return text(read.ok ? read.value : `Companion file "${path}" of skill "${skill.name}" could not be read: ${read.error.message}`);
        }
        const location = folder === undefined ? '' : `\n\nThis skill's folder is \`${folder}\`; paths in it are relative to that folder.`;
        const listed = companions.length ? `\n\nCompanion files of this skill (read one with load_skill and its path):\n${companions.map(path => `- ${path}`).join('\n')}` : '';
        return text(skill.body + location + listed);
      },
    })],
  });
}

/**
 * A prompt section listing the skills and a `load_skill` tool returning one body. Usable without `defineAgent`.
 * A fixed array is validated now: an invalid or duplicate skill throws. A `SkillSource` is read on first use and again, once
 * the copy is older than `maxAgeMs`, when its version changed; what it cannot use is left out and reported, never thrown.
 * `createSkillsController` returns the same extension on a source with a `refresh` handle.
 */
export function createSkillsExtension(name: string, skills: readonly Skill[] | SkillSource, options: SkillsExtensionOptions = {}): Extension {
  if (!isSkillArray(skills)) return createSkillsController(name, skills, options).extension;
  if (options.companions) throw new TypeError('Skills extension: companions need a SkillSource with fs, not an array');
  const known = new Map<string, Skill>();
  for (const skill of skills.map(validSkill)) {
    if (known.has(skill.name)) throw new TypeError(`Duplicate skill: ${skill.name}`);
    known.set(skill.name, skill);
  }
  const fixed: Loaded = { known, errors: [] };
  return skillsExtension(name, async () => fixed, options, undefined);
}

/** `createSkillsExtension` on a source, plus `refresh(context, name?)` to re-read it now instead of after `maxAgeMs`. */
export function createSkillsController(name: string, source: SkillSource, options: SkillsExtensionOptions = {}): SkillsController {
  if (options.companions && !source.fs) throw new TypeError('Skills extension: companions need a SkillSource with fs');
  const live = liveSkills(source, options);
  return { extension: skillsExtension(name, live.current, options, options.companions ? source.fs : undefined), refresh: live.refresh };
}

const isSkillArray = (skills: readonly Skill[] | SkillSource): skills is readonly Skill[] => Array.isArray(skills);
