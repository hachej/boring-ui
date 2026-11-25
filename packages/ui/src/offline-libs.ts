/**
 * Offline libraries for sandboxed HTML pages. A page declares one with an HTML comment, `<!-- lib: d3 -->`; several go in one comment,
 * separated by commas (`<!-- lib: d3, chart -->`), or in one comment each. The viewer injects the library's source into the page before
 * its own scripts run. Nothing is fetched at render time, and a library's source is a dynamic import that only a page declaring it reaches.
 * The kit hard-codes no library: the host passes the complete set a page may declare (`InteractiveHtml.libraries`), and the default is none.
 * `d3Library` is the vendored d3, an ordinary entry a host opts into: `libraries={{ d3: d3Library }}`. A host that never imports it never bundles it.
 * To vendor another: `node scripts/vendor-offline-lib.mjs <name> <minified file>`, its licence in THIRD_PARTY_NOTICES.md, one export below.
 */
export interface OfflineLibrary {
  /** The pinned version of the vendored copy. */
  readonly version: string;
  /** The library's minified source, loaded on first use. */
  readonly load: () => Promise<{ readonly default: string }>;
}

/** d3 7.9.1, vendored. Opt in with `libraries={{ d3: d3Library }}`; its source is a separate chunk loaded only when a page declares `<!-- lib: d3 -->`. */
export const d3Library: OfflineLibrary = { version: '7.9.1', load: () => import('./offline-libs/d3.js') };

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Checks and copies the host's list: `libraries` maps a lowercase name to a vendored copy with a pinned `version` (x.y.z) and a `load` that returns
 * its source from the host's bundle. It is the complete set a page may declare; omitted, it is empty. Nothing is fetched at render time.
 * A bad name or version throws.
 */
export function withOfflineLibraries(libraries: Readonly<Record<string, OfflineLibrary>> = {}): Record<string, OfflineLibrary> {
  const all: Record<string, OfflineLibrary> = {};
  for (const [name, library] of Object.entries(libraries)) {
    if (!NAME.test(name)) throw new TypeError(`Offline library name ${JSON.stringify(name.slice(0, 80))} must be lowercase letters, digits, dot, dash or underscore`);
    if (typeof library?.version !== 'string' || !VERSION.test(library.version) || typeof library.load !== 'function') throw new TypeError(`Offline library "${name}" needs a pinned x.y.z version and a load function`);
    all[name] = library;
  }
  return all;
}

const DECLARATION = /<!--\s*lib\s*:([^>]*?)-->/gi;

/** The library names a document declares, lowercased, in first-seen order and without repeats. */
export function declaredLibraries(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(DECLARATION)) for (const name of (match[1] ?? '').split(',')) if (name.trim()) names.add(name.trim().toLowerCase());
  return [...names];
}

export interface OfflineLibraryHead {
  /** Inline `<script>` elements, one per library, to place before the page's own markup. */
  readonly head: string;
  /** Plain sentences for the person: an unknown name, or a library that did not load. */
  readonly problems: readonly string[];
}

/** An inline script cannot contain `</script` or `<!--` without changing how the parser reads it. */
const inert = (source: string) => source.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

export async function offlineLibraryHead(names: readonly string[], libraries: Readonly<Record<string, OfflineLibrary>> = {}): Promise<OfflineLibraryHead> {
  const problems: string[] = [];
  const scripts: string[] = [];
  for (const name of names) {
    const library = Object.hasOwn(libraries, name) ? libraries[name] : undefined;
    if (!library) { problems.push(`Unknown library "${name}". Available: ${Object.keys(libraries).join(', ') || '(none)'}.`); continue; }
    try { scripts.push(`<script>${inert((await library.load()).default)}</script>`); } catch { problems.push(`The library "${name}" could not be loaded.`); }
  }
  return { head: scripts.join(''), problems };
}
