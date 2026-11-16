import { createHash } from 'node:crypto';
import type { Context } from '@earendil-works/chord/context';
import { parseSkill } from './skills.js';
import type { LiveSkills, Skill, SkillError, SkillListing, SkillSource, SkillVersions } from './skills.js';

/** Where an object lives. The host's client builds its S3 client for `region`; the kit never imports an AWS SDK. */
export interface S3Location { readonly region: string; readonly bucket: string; readonly key: string }
/** The one call the source needs: an object's text, or `undefined` when the key does not exist. Other failures throw. */
export interface S3SkillClient { readonly getText: (location: S3Location, context: Context) => Promise<string | undefined> }
export interface S3SkillSourceOptions {
  readonly client: S3SkillClient;
  readonly region: string;
  readonly bucket: string;
  /** Folder in the bucket: `<prefix>/current.json` names the active set, `<prefix>/<version>/<path>` holds its files. */
  readonly prefix: string;
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
  /** Read `current.json` and validate its set now, without activating it. */
  readonly compare: (context: Context) => Promise<SkillComparison>;
}

interface SkillSet { readonly version: string; readonly skills: readonly Skill[]; readonly hashes: ReadonlyMap<string, string> }

const VERSION = /^(?!\.\.?$)[^/\\\u0000-\u001f]{1,128}$/;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\u0000-\u001f]{1,256}\.md$/;
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
 * whole (every listed file present, its sha-256 equal to the manifest's, its front matter parsed, no duplicate name) and is
 * activated only when all of it passes; otherwise the last good set stays and `lastRefreshed().failed` says why.
 */
export function s3SkillSource(options: S3SkillSourceOptions): S3SkillSource {
  const prefix = options.prefix.replace(/^\/+|\/+$/g, '');
  const key = (rest: string) => ({ region: options.region, bucket: options.bucket, key: prefix ? `${prefix}/${rest}` : rest });
  const sets = new Map<string, SkillSet>();
  let good: string | undefined, refreshed: S3Refresh = {};

  async function fetchSet(context: Context): Promise<SkillSet> {
    const text = await options.client.getText(key('current.json'), context);
    if (text === undefined) throw new Error('current.json does not exist');
    const manifest = manifestOf(text);
    const skills: Skill[] = [], names = new Set<string>(), hashes = new Map<string, string>();
    for (const file of manifest.files) {
      const body = await options.client.getText(key(`${manifest.version}/${file.path}`), context);
      if (body === undefined) throw new Error(`${file.path} is listed but missing`);
      if (createHash('sha256').update(body).digest('hex') !== file.sha256) throw new Error(`${file.path} does not match its hash`);
      let skill: Skill;
      try { skill = parseSkill(body); } catch (error) { throw new Error(`${file.path}: ${reason(error)}`); }
      if (names.has(skill.name)) throw new Error(`${file.path}: duplicate skill ${skill.name}`);
      names.add(skill.name);
      skills.push(skill);
      hashes.set(file.path, file.sha256);
    }
    return { version: manifest.version, skills, hashes };
  }
  const attempt = (context: Context): Promise<SkillSet | SkillError> =>
    fetchSet(context).catch((error): SkillError => ({ path: key('current.json').key, message: reason(error) }));

  const versions: SkillVersions = {
    current: async context => {
      const found = await attempt(context);
      if ('message' in found) {
        refreshed = { ...refreshed, failed: { at: Date.now(), message: found.message } };
        return { ...(good === undefined ? {} : { version: good }), error: { path: found.path, message: `Skill set refused: ${found.message}` } };
      }
      sets.set(found.version, found);
      good = found.version;
      refreshed = { at: Date.now(), version: found.version };
      return { version: found.version };
    },
    list: async (version): Promise<SkillListing> => ({ skills: sets.get(version)?.skills ?? [], errors: [] }),
  };
  return {
    versions,
    lastRefreshed: () => refreshed,
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
