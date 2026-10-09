// How an anchored element reads in a card or a review line: its readable name and a short file:line, the full path kept for a tooltip.
// Pure string work over the anchor's own `fallback` (`fallbackOf` in ../page/app-element.ts: `the «Save» button (SaveBar.tsx:42)`,
// `a masked list item in aside › ul (ActivityPanel.jsx:7)`) and its optional `signals.source`; it adds nothing the anchor did not say.

export interface ReadableElement {
  /** `«Save profile» button`, `masked list item`: no leading article, no file, no container path. */
  readonly name: string;
  /** The file's basename with its line (`SettingsPage.jsx:65`), when known. */
  readonly file?: string;
  /** The full source location (`examples/feedback/settings/SettingsPage.jsx:65`) for a tooltip, when known. */
  readonly path?: string;
}

const TRAILING_FILE = /\s*\(([^()\s]+\.[A-Za-z0-9]+(?::\d+)*)\)\s*$/;
const ARTICLE = /^(?:the|a|an)\s+/i;
/** ` in aside › ul`: the container path of a masked element (the file says where it is better). */
const CONTEXT = /\s+in\s+[^«»]*›[^«»]*$/;

export function readableElement(fallback: string, source?: string): ReadableElement {
  let name = fallback.trim();
  const trailing = TRAILING_FILE.exec(name);
  if (trailing) name = name.slice(0, trailing.index).trimEnd();
  name = name.replace(ARTICLE, '');
  if (/^masked\b/i.test(name)) name = name.replace(CONTEXT, '');
  const path = source?.trim() || undefined;
  const file = path ? path.split('/').pop() : trailing?.[1];
  return { name: name || fallback.trim(), ...(file ? { file } : {}), ...(path ? { path } : {}) };
}
