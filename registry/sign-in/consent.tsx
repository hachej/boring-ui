'use client';

// The « Allow » page of an assistant's sign-in to /mcp (Better Auth's OAuth provider sends the person here with a signed query).
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authorizationQuery, follow, signInClient, type Lang } from './sign-in-client';
import { signInLabels, type SignInLabels } from './sign-in-labels';

export interface ConsentPageProps {
  /** The app's name, as the person reads it. */
  readonly appName: string;
  readonly locale?: Lang;
  readonly labels?: Partial<SignInLabels>;
}

export function ConsentPage({ appName, locale = 'fr', labels: given }: ConsentPageProps) {
  const t = { ...signInLabels[locale], ...given };
  const query = authorizationQuery();
  const scope = new URLSearchParams(query).get('scope') ?? 'openid profile email offline_access';
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const answer = async (accept: boolean) => {
    setBusy(true); setError(undefined);
    try { if (!follow(await signInClient(locale).consent(accept, scope, query))) setError(t.consentFailed); }
    catch (failure) { setError((failure as Error).message || t.consentFailed); } finally { setBusy(false); }
  };
  return <main className="mx-auto mt-24 grid w-full max-w-sm gap-4 px-4">
    <h1 className="m-0 text-xl font-semibold">{t.consentTitle}</h1>
    <p className="m-0 text-sm text-muted-foreground">{t.consentText(appName)}</p>
    {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
    <div className="flex gap-2">
      <Button className="flex-1" disabled={busy || !query} onClick={() => void answer(true)}>{t.allow}</Button>
      <Button className="flex-1" variant="outline" disabled={busy || !query} onClick={() => void answer(false)}>{t.deny}</Button>
    </div>
  </main>;
}
