import { Button } from '../button/button';
import { useAppText } from './app-labels';
import { cn } from '../utils/utils';

/**
 * The "a new version is available" notice: a status line with a Reload button. Render it while `useNewVersion` returns true
 * (`{stale && <NewVersionNotice />}`). Reload is `location.reload()`, so unsaved work in the page is lost: the host decides when to show it.
 */
export function NewVersionNotice({ className }: { readonly className?: string }) {
  const { labels } = useAppText();
  return (
    <div role="status" data-testid="new-version-notice" className={cn('flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-2 text-sm text-foreground', className)}>
      <span>{labels.newVersion}</span>
      <Button variant="outline" size="sm" data-testid="new-version-reload" onClick={() => globalThis.location.reload()}>{labels.reload}</Button>
    </div>
  );
}
