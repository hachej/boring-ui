/**
 * Offline libraries for sandboxed HTML pages. A page declares one with an HTML comment, `<!-- lib: d3 -->`; several go in one comment,
 * separated by commas (`<!-- lib: d3, chart -->`), or in one comment each. The viewer injects the library's source into the page before
 * its own scripts run. Nothing is fetched at render time, and a library's source is a dynamic import that only a page declaring it reaches.
 * To add a library: `node scripts/vendor-offline-lib.mjs <name> <minified file>`, its licence in THIRD_PARTY_NOTICES.md, one line below.
 */
export interface OfflineLibrary {
  /** The pinned version of the vendored copy. */
  readonly version: string;
  /** The library's minified source, loaded on first use. */
  readonly load: () => Promise<{ readonly default: string }>;
}

export const offlineLibraries: Record<string, OfflineLibrary> = {
  d3: { version: '7.9.1', load: () => import('./offline-libs/d3.js') },
};

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

export async function offlineLibraryHead(names: readonly string[], libraries: Readonly<Record<string, OfflineLibrary>> = offlineLibraries): Promise<OfflineLibraryHead> {
  const problems: string[] = [];
  const scripts: string[] = [];
  for (const name of names) {
    const library = Object.hasOwn(libraries, name) ? libraries[name] : undefined;
    if (!library) { problems.push(`Unknown library "${name}". Available: ${Object.keys(libraries).join(', ')}.`); continue; }
    try { scripts.push(`<script>${inert((await library.load()).default)}</script>`); } catch { problems.push(`The library "${name}" could not be loaded.`); }
  }
  return { head: scripts.join(''), problems };
}
