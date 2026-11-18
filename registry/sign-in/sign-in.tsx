'use client';

// The sign-in page of an app on `@hachej/boring-ui-kit/signin`: e-mail and password, Google when the app has its client, account creation by
// invitation (or by the one-use first-owner link). Signed in during an assistant's authorization, it resumes that authorization.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authorizationQuery, firstOwnerToken, follow, signInClient, type Lang, type Options } from './sign-in-client';
import { signInLabels, type SignInLabels } from './sign-in-labels';

export interface SignInPageProps {
  /** Called once the person is signed in (outside an assistant's authorization, which leaves the page instead). */
  readonly onSignedIn: () => void;
  readonly locale?: Lang;
  readonly labels?: Partial<SignInLabels>;
}

export function SignInPage({ onSignedIn, locale = 'fr', labels: given }: SignInPageProps) {
  const t = { ...signInLabels[locale], ...given };
  const api = signInClient(locale);
  const firstOwner = firstOwnerToken();
  const [mode, setMode] = useState<'in' | 'up'>(firstOwner ? 'up' : 'in');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  // Back from Google or from Studio with a refusal: Better Auth puts it in the address.
  const [error, setError] = useState<string | undefined>(() => {
    const params = new URLSearchParams(location.search);
    const failed = params.get('error');
    return failed ? params.get('error_description') ?? (/link|studio/i.test(failed) ? t.studioRefused : t.failed) : undefined;
  });
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Options>({ google: false, studio: false, app: '' });
  useEffect(() => { void api.options().then(setOptions).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (new URLSearchParams(location.search).has('error')) history.replaceState(null, '', location.pathname); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(undefined);
    try {
      if (mode === 'in') await api.signIn(email, password);
      else await api.signUp(name, email, password, firstOwner || undefined);
      const query = authorizationQuery();
      if (query && follow(await api.resume(query))) return;
      if (firstOwner) history.replaceState(null, '', '/');
      onSignedIn();
    } catch (failure) { setError((failure as Error).message || t.failed); } finally { setBusy(false); }
  };
  const withGoogle = async () => {
    setBusy(true); setError(undefined);
    try { if (!follow(await api.google())) setBusy(false); } catch (failure) { setError((failure as Error).message); setBusy(false); }
  };

  const app = options.app;
  return <main className="mx-auto mt-24 grid w-full max-w-sm gap-4 px-4">
    <div className="grid gap-1">
      <h1 className="m-0 text-xl font-semibold">{mode === 'in' ? t.signInTitle : t.signUpTitle}</h1>
      <p className="m-0 text-sm text-muted-foreground">{firstOwner ? t.firstOwnerLead(app) : mode === 'in' ? t.signInLead(app) : t.signUpLead(app)}</p>
    </div>
    {options.google && !firstOwner && <>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void withGoogle()}>{t.google}</Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />{t.or}<span className="h-px flex-1 bg-border" /></div>
    </>}
    <form className="grid gap-3" onSubmit={e => void submit(e)}>
      {mode === 'up' && <div className="grid gap-1.5">
        <Label htmlFor="sign-in-name">{t.name}</Label>
        <Input id="sign-in-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
      </div>}
      <div className="grid gap-1.5">
        <Label htmlFor="sign-in-email">{t.email}</Label>
        <Input id="sign-in-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="sign-in-password">{t.password}</Label>
        <Input id="sign-in-password" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
      </div>
      {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? t.working : mode === 'in' ? t.signIn : t.signUp}</Button>
    </form>
    {!firstOwner && <Button type="button" variant="link" className="justify-self-center" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(undefined); }}>
      {mode === 'in' ? t.toSignUp : t.toSignIn}
    </Button>}
  </main>;
}
