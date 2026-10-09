// The one place this item touches the browser Notification API. It is secure-context and permission dependent, so every use
// feature-detects first and nothing here is required: without it the toasts simply stay in the page. `npm run check` keeps it that way.

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

type NotificationLike = {
  new (title: string, options?: { readonly body?: string; readonly tag?: string }): { onclick: (() => void) | null; close(): void };
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
};
const api = (): NotificationLike | undefined => {
  const candidate = (globalThis as { Notification?: NotificationLike }).Notification;
  return typeof candidate === 'function' ? candidate : undefined;
};

export function notifyPermission(): NotifyPermission {
  const Notify = api();
  return Notify ? Notify.permission : 'unsupported';
}

/** Ask for permission. Call this only from a person's own action (a click), never on load. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const Notify = api();
  if (!Notify) return 'unsupported';
  try { return await Notify.requestPermission(); } catch { return Notify.permission; }
}

/** A system notification, only while the page is hidden and permission was granted. Returns whether one was shown. */
export function notifyWhenHidden(title: string, body: string, tag: string, onClick: () => void): boolean {
  const Notify = api();
  if (!Notify || Notify.permission !== 'granted' || globalThis.document?.visibilityState !== 'hidden') return false;
  try {
    const shown = new Notify(title, { body, tag });
    shown.onclick = () => { shown.close(); onClick(); };
    return true;
  } catch { return false; }
}
