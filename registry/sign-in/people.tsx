'use client';

// The owner's invitation list: who may create an account in the app, and with which role. Owners only (the routes refuse anyone else).
// In an app linked to Studio, owners come from Studio: `canInviteOwners` is false there and the list holds members.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { signInClient, type Invitation, type Lang } from './sign-in-client';
import { signInLabels, type SignInLabels } from './sign-in-labels';

export interface PeopleListProps {
  readonly locale?: Lang;
  readonly labels?: Partial<SignInLabels>;
  /** Offer « as owner » (Studio itself, or an app not linked to Studio). */
  readonly canInviteOwners?: boolean;
}

export function PeopleList({ locale = 'fr', labels: given, canInviteOwners = false }: PeopleListProps) {
  const t = { ...signInLabels[locale], ...given };
  const api = signInClient(locale);
  const [people, setPeople] = useState<readonly Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const [error, setError] = useState<string>();
  const load = () => { void api.people().then(setPeople, (e: Error) => setError(e.message)); };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (run: () => Promise<unknown>) => { setError(undefined); try { await run(); load(); } catch (e) { setError((e as Error).message); } };
  const invite = (event: FormEvent) => { event.preventDefault(); void act(async () => { await api.invite(email, role); setEmail(''); }); };

  // Every grid is one `minmax(0, 1fr)` column (`grid-cols-1`): an implicit column grows to its widest line, so a long address would push the
  // list wider than the screen it sits in. The address truncates inside its row instead, and « Retirer » stays in view.
  return <section className="grid grid-cols-1 gap-3">
    <div className="grid grid-cols-1 gap-1">
      <h2 className="m-0 text-base font-semibold">{t.peopleTitle}</h2>
      <p className="m-0 text-sm text-muted-foreground">{t.peopleLead}</p>
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={invite}>
      <Input className="min-w-0 flex-1 basis-48" type="email" required placeholder={t.email} aria-label={t.email} data-testid="people-email" value={email} onChange={e => setEmail(e.target.value)} />
      {canInviteOwners && <NativeSelect aria-label={t.peopleTitle} data-testid="people-role" value={role} onChange={e => setRole(e.target.value as 'owner' | 'member')}>
        <NativeSelectOption value="member">{t.asMember}</NativeSelectOption>
        <NativeSelectOption value="owner">{t.asOwner}</NativeSelectOption>
      </NativeSelect>}
      <Button type="submit" data-testid="people-invite">{t.invite}</Button>
    </form>
    {error && <p role="alert" data-testid="people-error" className="m-0 text-sm text-destructive">{error}</p>}
    {people.length === 0 ? <p data-testid="people-empty" className="m-0 text-sm text-muted-foreground">{t.nobody}</p> : <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0">
      {people.map(p => <li key={p.email} data-testid="people-row" className="flex min-w-0 items-center gap-2 text-sm">
        <span title={p.email} className="min-w-0 flex-1 truncate">{p.email}</span>
        <span className="shrink-0 text-muted-foreground">{p.role === 'owner' ? t.owner : t.member}</span>
        <Button size="sm" variant="ghost" className="shrink-0" data-testid="people-remove" onClick={() => void act(() => api.uninvite(p.email))}>{t.remove}</Button>
      </li>)}
    </ul>}
  </section>;
}
