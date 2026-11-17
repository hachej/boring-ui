// The update notice (`AppShell update`): a newer version of the app is online while the page is open. It is one `AppShellNotice` (an info notice that stays until dismissed) drawn
// by the shell's notice host, with a Reload action and a dismiss that holds for the version named. Host concern: Pi has no layout; the host decides when `available` is true
// (a version poll, a service worker).
import type { AppShellNotice } from './notice';
import type { AppShellText } from './text';

export interface AppShellUpdate {
  /** `true` once the host knows a newer version is online; the notice shows until the person reloads or dismisses it. */
  readonly available: boolean;
  /** The newer version's name. A dismiss holds for this version only: a later one shows the notice again. Without it a dismiss holds until `available` turns false. */
  readonly version?: string;
  /** What Reload does. Default: `location.reload()`. */
  readonly onReload?: () => void;
}

/** The update as a notice, or none while no update is available. */
export function updateNotice(update: AppShellUpdate | undefined, text: AppShellText): AppShellNotice | undefined {
  if (!update?.available) return undefined;
  return { id: `update:${update.version ?? ''}`, kind: 'info', text: text.updateAvailable, action: { label: text.updateReload, onSelect: update.onReload ?? (() => globalThis.location?.reload()) },
    own: { version: update.version, dismissLabel: text.updateDismiss, ids: { root: 'update-notice', text: 'update-notice-text', action: 'update-reload', dismiss: 'update-dismiss' } } };
}
