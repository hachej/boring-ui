'use client';

// The update notice (`AppShell update`): a newer version of the app is online while the page is open. One kit-drawn status row at the foot of the screen
// column, in the flow above the phone's tab bar (so it takes room instead of covering the screen's last control), with a Reload action and a dismiss that
// holds for the version named. It takes no focus. Host concern: Pi has no layout; the host decides when `available` is true (a version poll, a service worker).
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { InfoIcon, XIcon } from '../_shared/icons';
import type { AppShellText } from './text';

export interface AppShellUpdate {
  /** `true` once the host knows a newer version is online; the notice shows until the person reloads or dismisses it. */
  readonly available: boolean;
  /** The newer version's name. A dismiss holds for this version only: a later one shows the notice again. Without it a dismiss holds until `available` turns false. */
  readonly version?: string;
  /** What Reload does. Default: `location.reload()`. */
  readonly onReload?: () => void;
}

/** Whether the notice shows: available, and not dismissed for this version (`dismissed` is the version last dismissed, `''` when it had none). */
export const updateShown = (update: AppShellUpdate, dismissed: string | undefined): boolean => update.available && dismissed !== (update.version ?? '');

export function UpdateNotice({ update, text, lift }: { readonly update: AppShellUpdate; readonly text: AppShellText; readonly lift?: string | undefined }) {
  const [dismissed, setDismissed] = useState<string | undefined>();
  const { available, version, onReload } = update;
  // A dismiss ends with the availability (`available` false): reset while rendering, not in an effect.
  if (!available && dismissed !== undefined) setDismissed(undefined);
  if (!updateShown(update, dismissed)) return null;
  return <div data-testid="update-notice" data-version={version} data-feedback-ignore="" style={lift ? { marginBottom: lift } : undefined} className="shrink-0 px-[var(--screen-gutter,1rem)] py-2">
    {/* The info look through tokens on the default Alert: a shadcn Alert without the kit's `info` variant draws the same row. */}
    <Alert role="status" className="flex items-center gap-2 border-info bg-info-soft *:[svg]:text-info-soft-foreground">
      <InfoIcon />
      <span data-testid="update-notice-text" className="min-w-0 flex-1">{text.updateAvailable}</span>
      <Button variant="outline" size="sm" data-testid="update-reload" onClick={() => (onReload ?? (() => globalThis.location?.reload()))()}>{text.updateReload}</Button>
      <Button variant="ghost" size="icon-sm" data-testid="update-dismiss" aria-label={text.updateDismiss} onClick={() => setDismissed(version ?? '')}><XIcon /></Button>
    </Alert>
  </div>;
}
