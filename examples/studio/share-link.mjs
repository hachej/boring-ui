// Links that reopen the studio on a variant with one workspace file or artifact open. The link is read once when the page
// loads and then removed from the address bar, so a later reload restores the person's own state instead.
import { createLinkShare } from '../../registry/viewers/share.ts';

const FIELDS = ['variant', 'conversation', 'file', 'artifact', 'version'];

const pending = {};
if (typeof location !== 'undefined') {
  const params = new URLSearchParams(location.search);
  for (const field of FIELDS) if (params.has(field)) pending[field] = params.get(field);
  if (FIELDS.some(field => params.has(field))) history.replaceState(null, '', location.pathname + location.hash);
}

/** The link fields the page was opened with, for example `{ variant: 'local', file: '/workspace/docs/picnic-plan.md' }`. */
export const openedWith = () => ({ ...pending });
/** Returns one field of the opening link once; later calls get `undefined`. */
export function takeLink(field) { const value = pending[field]; delete pending[field]; return value; }

// Which variant and conversation the person is looking at. Links made by a panel or a file viewer name the variant only; the page tells this module
// where it is so every link also names the conversation (opening a link from a file or a document must land in the same conversation).
let current = {};
export function setStudioContext(next) { current = { ...next }; }

/** The address of the page the person is on, whatever origin it is served from (a private IP over plain HTTP included); only the query is replaced. */
export function studioLink(fields, base = location.href) {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  const all = { ...(fields.variant === undefined || fields.variant === current.variant ? current : {}), ...fields };
  for (const field of FIELDS) if (all[field] !== undefined && all[field] !== null) url.searchParams.set(field, String(all[field]));
  return url.toString();
}

/** The Share action the viewers take: `target` is the field set of the link. */
export const shareStudioLink = createLinkShare(request => studioLink(request.target));
