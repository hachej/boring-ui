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

  return <section className="grid gap-3">
    <div className="grid gap-1">
      <h2 className="m-0 text-base font-semibold">{t.peopleTitle}</h2>
      <p className="m-0 text-sm text-muted-foreground">{t.peopleLead}</p>
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={invite}>
      <Input className="min-w-48 flex-1" type="email" required placeholder={t.email} aria-label={t.email} value={email} onChange={e => setEmail(e.target.value)} />
      {canInviteOwners && <NativeSelect aria-label={t.peopleTitle} value={role} onChange={e => setRole(e.target.value as 'owner' | 'member')}>
        <NativeSelectOption value="member">{t.asMember}</NativeSelectOption>
        <NativeSelectOption value="owner">{t.asOwner}</NativeSelectOption>
      </NativeSelect>}
      <Button type="submit">{t.invite}</Button>
    </form>
    {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
    {people.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{t.nobody}</p> : <ul className="m-0 grid list-none gap-1 p-0">
      {people.map(p => <li key={p.email} className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">{p.email}</span>
        <span className="text-muted-foreground">{p.role === 'owner' ? t.owner : t.member}</span>
        <Button size="sm" variant="ghost" onClick={() => void act(() => api.uninvite(p.email))}>{t.remove}</Button>
      </li>)}
    </ul>}
  </section>;
}
