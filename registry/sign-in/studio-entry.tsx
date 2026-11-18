'use client';

// The « Studio » entry of an app's left pane, for its owners only: a nav item (the shape AppShell's `nav` takes) whose screen opens the
// app's page in Studio. Studio's own session decides what happens there: straight in when signed in, Studio's sign-in otherwise.
import type { ComponentType, ReactNode } from 'react';
import { ExternalLinkIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import type { Lang, Me } from './sign-in-client';
import { signInLabels, type SignInLabels } from './sign-in-labels';

export interface StudioNavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly render: () => ReactNode;
}

/** The entry when the signed-in person owns the app (the routes give `studio` to owners only), else nothing to add. */
export function studioNavItem(me: Me | null | undefined, locale: Lang = 'fr', given?: Partial<SignInLabels>): readonly StudioNavItem[] {
  const studio = me?.studio;
  if (!studio) return [];
  const t = { ...signInLabels[locale], ...given };
  return [{
    id: 'studio', label: t.studio, icon: ExternalLinkIcon,
    render: () => <main className="mx-auto mt-16 grid w-full max-w-sm gap-3 px-4">
      <p className="m-0 text-sm text-muted-foreground">{t.studioLead}</p>
      <Button nativeButton={false} render={<a href={studio} />}>{t.openStudio}</Button>
    </main>,
  }];
}
