'use client';

// The sign-in page of an app on `@hachej/boring-ui-kit/signin`: e-mail and password, Google when the app has its client, account creation by
// invitation (or by the one-use first-owner link, which the Worker confirms before the page shows the owner's sign-up). Signed in during an
// assistant's authorization, it resumes that authorization.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { authorizationQuery, firstOwnerToken, follow, signInClient, type Lang, type Options } from './sign-in-client';
import { signInLabels, type SignInLabels } from './sign-in-labels';

export interface SignInPageProps {
  /** Called once the person is signed in (outside an assistant's authorization, which leaves the page instead). */
  readonly onSignedIn: () => void;
  readonly locale?: Lang;
  readonly labels?: Partial<SignInLabels>;
}

/** The page's one column; `grid-cols-1` keeps a long line from widening it past the phone. Its text colour is the one the switch links inherit. */
const FRAME = 'mx-auto mt-24 grid w-full max-w-sm grid-cols-1 gap-4 px-4 text-foreground';
/** The block's full-width buttons are 48 px on a phone; the kit's own floor (`--control-min`, 44) stays for every other button. */
const TALL = 'max-md:min-h-12 pointer-coarse:min-h-12';
/** The two switch links: a `ghost` button, which takes the page's text colour (`FRAME`) where `link` takes the primary (a light primary does not read as text), underlined. */
const SWITCH = 'justify-self-center underline underline-offset-4';

/** `checking` until the Worker has said whether the first-owner link is good; `none` when the page was not opened from such a link. */
type Link = 'none' | 'checking' | 'valid' | 'refused';

export function SignInPage({ onSignedIn, locale = 'fr', labels: given }: SignInPageProps) {
  const t = { ...signInLabels[locale], ...given };
  const api = signInClient(locale);
  const token = firstOwnerToken();
  const [link, setLink] = useState<Link>(token ? 'checking' : 'none');
  const [mode, setMode] = useState<'in' | 'up'>('in');
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
  // The owner's sign-up shows only once the Worker says the link is good; if it cannot answer, the page stays the ordinary sign-in.
  useEffect(() => {
    if (!token) return;
    let live = true;
    api.firstOwnerValid(token).then(ok => { if (live) { setMode(ok ? 'up' : 'in'); setLink(ok ? 'valid' : 'refused'); } }, () => { if (live) setLink('none'); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const owner = link === 'valid';
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(undefined);
    try {
      if (mode === 'in') await api.signIn(email, password);
      else await api.signUp(name, email, password, owner ? token : undefined);
      const query = authorizationQuery();
      if (query && follow(await api.resume(query))) return;
      if (owner) history.replaceState(null, '', '/');
      onSignedIn();
    } catch (failure) { setError((failure as Error).message || t.failed); } finally { setBusy(false); }
  };
  const withGoogle = async () => {
    setBusy(true); setError(undefined);
    try { if (!follow(await api.google())) setBusy(false); } catch (failure) { setError((failure as Error).message); setBusy(false); }
  };

  if (link === 'checking') return <main className={FRAME}>
    <div role="status" aria-busy="true" aria-label={t.working} data-testid="sign-in-first-owner-wait" className="grid place-items-center py-24">
      <Spinner aria-hidden="true" role="presentation" />
    </div>
  </main>;
  const app = options.app;
  return <main className={FRAME}>
    {link === 'refused' && <p role="alert" data-testid="sign-in-link-refused" className="m-0 text-sm text-destructive">{t.linkRefused}</p>}
    <div className="grid grid-cols-1 gap-1">
      <h1 className="m-0 text-xl font-semibold">{mode === 'in' ? t.signInTitle : t.signUpTitle}</h1>
      <p className="m-0 text-sm text-muted-foreground">{owner ? t.firstOwnerLead(app) : mode === 'in' ? t.signInLead(app) : t.signUpLead(app)}</p>
    </div>
    {options.google && !owner && <>
      <Button type="button" variant="outline" className={TALL} data-testid="sign-in-google" disabled={busy} onClick={() => void withGoogle()}>{t.google}</Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />{t.or}<span className="h-px flex-1 bg-border" /></div>
    </>}
    <form className="grid grid-cols-1 gap-3" onSubmit={e => void submit(e)}>
      {mode === 'up' && <div className="grid grid-cols-1 gap-1.5">
        <Label htmlFor="sign-in-name">{t.name}</Label>
        <Input id="sign-in-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
      </div>}
      <div className="grid grid-cols-1 gap-1.5">
        <Label htmlFor="sign-in-email">{t.email}</Label>
        <Input id="sign-in-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        <Label htmlFor="sign-in-password">{t.password}</Label>
        <Input id="sign-in-password" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
      </div>
      <Button type="submit" className={TALL} data-testid="sign-in-submit" disabled={busy}>{busy ? t.working : mode === 'in' ? t.signIn : t.signUp}</Button>
      {error && <p role="alert" data-testid="sign-in-error" className="m-0 text-sm text-destructive">{error}</p>}
    </form>
    {!owner && <Button type="button" variant="ghost" className={SWITCH} data-testid="sign-in-switch" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(undefined); }}>
      {mode === 'in' ? t.toSignUp : t.toSignIn}
    </Button>}
  </main>;
}
