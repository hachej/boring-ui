import { createHash } from 'node:crypto';
import type { Context } from '@earendil-works/chord/context';
import { parseSkill } from './skills.js';
import type { LiveSkills, Skill, SkillError, SkillListing, SkillSource, SkillVersions } from './skills.js';

/** Where an object lives. The host's client builds its S3 client for `region`; the kit never imports an AWS SDK. */
export interface S3Location { readonly region: string; readonly bucket: string; readonly key: string }
/** The one call the source needs: an object's text, or `undefined` when the key does not exist. Other failures throw. */
export interface S3SkillClient { readonly getText: (location: S3Location, context: Context) => Promise<string | undefined> }
/** One file of a fetched set, as `validate` sees it. */
export interface S3SkillFile { readonly path: string; readonly text: string; readonly sha256: string }
export interface S3SkillSourceOptions {
  readonly client: S3SkillClient;
  readonly region: string;
  readonly bucket: string;
  /** Folder in the bucket: `<prefix>/current.json` names the active set, `<prefix>/<version>/<path>` holds its files. */
  readonly prefix?: string;
  /** The key of the manifest under the prefix. Default `current.json`. `layout.manifestKey` wins when both are given. */
  readonly manifest?: string;
  /**
   * Where the objects live under the prefix. Default: `current.json` and `<version>/<path>`. A host that keeps its files elsewhere
   * sets `fileKey`, for example `(version, path) => `skills/${version}/${path}`` or the flat `(version, path) => `${path}@${version}``.
   * Every key is checked: no leading `/`, no `..` segment, no backslash or control character; a key that fails refuses the set.
   */
  readonly layout?: {
    readonly manifestKey?: string;
    readonly fileKey?: (version: string, path: string) => string;
  };
  /**
   * Called once a whole set was fetched, hashed, parsed and de-duplicated, before it becomes active. Return a reason (or throw) to
   * refuse the whole set: the last good set stays, exactly as for a hash failure. May be async. `files` are the set's files with
   * their text; `version` is the manifest's. Not called again for a manifest that is already active.
   */
  readonly validate?: (files: readonly S3SkillFile[], context: Context, version: string) => string | void | Promise<string | void>;
}

/** `current.json`: the active set. A set is immutable once written; it switches by rewriting this one object. */
export interface SkillManifest {
  readonly version: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}
export interface S3Refresh {
  /** Time of the last successful refresh: a whole set read, hashed and parsed. */
  readonly at?: number;
  readonly version?: string;
  /** The last attempt that was refused, and why. The set in `version` stayed active. */
  readonly failed?: { readonly at: number; readonly message: string };
}
/** A set the source refused, whatever the cause (a hash, a missing file, front matter, a duplicate name, the `validate` hook). */
export interface S3Rejected {
  /** The manifest's version; absent when the manifest itself could not be used. */
  readonly version?: string;
  readonly at: number;
  readonly reason: string;
  /** The paths the manifest listed, when it could be read. */
  readonly files?: readonly string[];
}
/** The active set against the one `current.json` names now, by file path. */
export interface SkillComparison {
  readonly active?: string;
  readonly candidate?: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  /** Why the candidate cannot be used, when it cannot. */
  readonly error?: string;
}
export interface S3SkillSource extends SkillSource {
  readonly lastRefreshed: () => S3Refresh;
  /**
   * The last set refused, or undefined; cleared when a later set is accepted. `lastRefreshed().failed` is the wider record: it
   * also holds a failed read (the client threw, the manifest is missing), which is not a refused set, and is cleared the same way.
   */
  readonly lastRejected: () => S3Rejected | undefined;
  /** Read `current.json` and validate its set now, without activating it. */
  readonly compare: (context: Context) => Promise<SkillComparison>;
}

interface SkillSet { readonly version: string; readonly skills: readonly Skill[]; readonly hashes: ReadonlyMap<string, string>; readonly manifestText: string }
/** A set that was read and refused: what `lastRejected` reports. */
class Refusal extends Error {
  constructor(message: string, readonly version?: string, readonly files?: readonly string[]) { super(message); }
}
class BadKey extends Error {}

const VERSION = /^(?!\.\.?$)[^/\\\u0000-\u001f]{1,128}$/;
/** The object key names the file: any extension (`SKILL.md`, `SKILL`, `skill.txt`) at any depth; the skill's name comes from its front matter. */
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\u0000-\u001f]{1,256}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

function manifestOf(text: string): SkillManifest {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new TypeError('current.json is not JSON'); }
  const { version, files } = (data ?? {}) as { version?: unknown; files?: unknown };
  if (typeof version !== 'string' || !VERSION.test(version) || !Array.isArray(files) || files.length > 1000) throw new TypeError('current.json needs a version and a files list');
  const seen = new Set<string>();
  for (const file of files as { path?: unknown; sha256?: unknown }[]) {
    if (typeof file?.path !== 'string' || !PATH.test(file.path) || typeof file.sha256 !== 'string' || !SHA256.test(file.sha256) || seen.has(file.path)) {
      throw new TypeError(`current.json lists an invalid or duplicate file: ${JSON.stringify(String(file?.path).slice(0, 80))}`);
    }
    seen.add(file.path);
  }
  return { version, files: files as SkillManifest['files'] };
}

/**
 * Skills in S3, as a versioned `SkillSource`: `liveSkills` keeps each conversation on the version it started with. A set is read
 * whole (every listed file present, its sha-256 equal to the manifest's, its front matter parsed, no duplicate name, the host's
 * `validate` agreeing) and is activated only when all of it passes; otherwise the last good set stays, `lastRefreshed().failed`
 * says why and `lastRejected()` names the set. Checking for a change reads the manifest alone; the files are fetched only when
 * the manifest differs from the active one.
 */
export function s3SkillSource(options: S3SkillSourceOptions): S3SkillSource {
  const prefix = (options.prefix ?? '').replace(/^\/+|\/+$/g, '');
  const key = (rest: string) => ({ region: options.region, bucket: options.bucket, key: prefix ? `${prefix}/${rest}` : rest });
  const manifestName = options.layout?.manifestKey ?? options.manifest ?? 'current.json';
  const fileKey = options.layout?.fileKey ?? ((version: string, path: string) => `${version}/${path}`);
  const sets = new Map<string, SkillSet>();
  let good: string | undefined, refreshed: S3Refresh = {}, rejected: S3Rejected | undefined;

  function checked(rest: unknown, what: string): string {
    if (typeof rest !== 'string' || !PATH.test(rest)) throw new BadKey(`${what} is not a valid key: ${JSON.stringify(String(rest).slice(0, 80))}`);
    return rest;
  }
  async function readManifest(context: Context): Promise<string> {
    const text = await options.client.getText(key(checked(manifestName, 'The manifest key')), context);
    if (text === undefined) throw new Error('current.json does not exist');
    return text;
  }
  async function fetchSet(text: string, context: Context): Promise<SkillSet> {
    let manifest: SkillManifest;
    try { manifest = manifestOf(text); } catch (error) { throw new Refusal(reason(error)); }
    const refuse = (message: string) => new Refusal(message, manifest.version, manifest.files.map(file => file.path));
    const skills: Skill[] = [], names = new Set<string>(), hashes = new Map<string, string>(), files: S3SkillFile[] = [];
    for (const file of manifest.files) {
      let body: string | undefined;
      try {
        let rest: string;
        try { rest = fileKey(manifest.version, file.path); } catch (error) { throw new BadKey(`The key of ${file.path} could not be built: ${reason(error)}`); }
        body = await options.client.getText(key(checked(rest, `The key of ${file.path}`)), context);
      } catch (error) { throw error instanceof BadKey ? refuse(error.message) : error; }
      if (body === undefined) throw refuse(`${file.path} is listed but missing`);
      const sha256 = createHash('sha256').update(body).digest('hex');
      if (sha256 !== file.sha256) throw refuse(`${file.path} does not match its hash`);
      let skill: Skill;
      try { skill = parseSkill(body); } catch (error) { throw refuse(`${file.path}: ${reason(error)}`); }
      if (names.has(skill.name)) throw refuse(`${file.path}: duplicate skill ${skill.name}`);
      names.add(skill.name);
      skills.push(skill);
      hashes.set(file.path, file.sha256);
      files.push({ path: file.path, text: body, sha256 });
    }
    if (options.validate) {
      let verdict: string | void;
      try { verdict = await options.validate(files, context, manifest.version); } catch (error) { throw refuse(`Refused by validate: ${reason(error)}`); }
      if (verdict !== undefined && verdict !== '') throw refuse(`Refused by validate: ${verdict}`);
    }
    return { version: manifest.version, skills, hashes, manifestText: text };
  }
  /** The set the manifest names now. A manifest equal to the active one costs that one read and no file. */
  async function attempt(context: Context): Promise<SkillSet | (SkillError & { readonly refusal?: Refusal })> {
    try {
      const text = await readManifest(context), active = good === undefined ? undefined : sets.get(good);
      return active !== undefined && active.manifestText === text ? active : await fetchSet(text, context);
    } catch (error) {
      return { path: key(manifestName).key, message: reason(error), ...(error instanceof Refusal ? { refusal: error } : {}) };
    }
  }

  const versions: SkillVersions = {
    current: async context => {
      const found = await attempt(context), at = Date.now();
      if ('message' in found) {
        refreshed = { ...refreshed, failed: { at, message: found.message } };
        const { refusal } = found;
        if (refusal) rejected = { ...(refusal.version === undefined ? {} : { version: refusal.version }), at, reason: refusal.message, ...(refusal.files === undefined ? {} : { files: refusal.files }) };
        return { ...(good === undefined ? {} : { version: good }), error: { path: found.path, message: `Skill set refused: ${found.message}` } };
      }
      sets.set(found.version, found);
      good = found.version;
      rejected = undefined;
      refreshed = { at, version: found.version };
      return { version: found.version };
    },
    list: async (version): Promise<SkillListing> => ({ skills: sets.get(version)?.skills ?? [], errors: [] }),
  };
  return {
    versions,
    lastRefreshed: () => refreshed,
    lastRejected: () => rejected,
    version: async context => { const read = await versions.current(context); return `${read.version ?? ''}|${read.error?.message ?? ''}`; },
    list: async context => {
      const read = await versions.current(context);
      const listing = read.version === undefined ? { skills: [], errors: [] } : await versions.list(read.version, context);
      return read.error ? { skills: listing.skills, errors: [read.error] } : listing;
    },
    compare: async context => {
      const found = await attempt(context), before = good === undefined ? undefined : sets.get(good);
      if ('message' in found) return { ...(good === undefined ? {} : { active: good }), added: [], removed: [], changed: [], error: found.message };
      const was = before?.hashes ?? new Map<string, string>();
      const paths = (test: (path: string) => boolean) => [...found.hashes.keys(), ...was.keys()].filter((path, at, all) => all.indexOf(path) === at && test(path)).sort();
      return {
        ...(good === undefined ? {} : { active: good }), candidate: found.version,
        added: paths(path => !was.has(path)), removed: paths(path => !found.hashes.has(path)),
        changed: paths(path => was.has(path) && found.hashes.has(path) && was.get(path) !== found.hashes.get(path)),
      };
    },
  };
}

export interface AdminReload {
  /** The comparison read just before the reload. */
  readonly before: SkillComparison;
  /** True when the candidate set is now the one every conversation moves to. */
  readonly reloaded: boolean;
  readonly refresh: S3Refresh;
}

/**
 * The admin's reload: compare, then move every conversation to the set `current.json` names. A refused set changes nothing.
 * The host decides who may call this; the kit checks no one.
 */
export async function reloadSkills(source: S3SkillSource, live: Pick<LiveSkills, 'refresh'>, context: Context): Promise<AdminReload> {
  const before = await source.compare(context);
  const reloaded = await live.refresh(context);
  return { before, reloaded, refresh: source.lastRefreshed() };
}
