// The one check of a workspace file path typed by an agent, a message or a click, shared by the server (before a command is queued) and the
// page (before a viewer is mounted). A path is workspace-relative: leading `./` segments are dropped; an absolute path, a `..` or empty
// segment, a backslash or a control character is refused, so nothing reaches `provider.locate()` that it would throw on.
import { workspacePath } from '@hachej/boring-files/file-types';

/** The normalised workspace path, or undefined when `raw` is not a plain workspace-relative path. */
export function validWorkspacePath(raw) {
  if (typeof raw !== 'string') return undefined;
  const path = workspacePath(raw.trim());
  if (!path || path.length > 1024 || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f]/.test(path)) return undefined;
  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..') ? path : undefined;
}
