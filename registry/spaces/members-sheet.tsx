'use client';

// The open space's members and roles, the invite link, remove, leave, and every administrator access to it.
// What a person may do is the host's to decide: the sheet only hides what would be refused.
import { useState } from 'react';
import { copyToClipboard } from '@hachej/boring-files/platform';
import { CopyIcon, LogOutIcon, ShieldAlertIcon, UserMinusIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent } from '@/components/ui/item';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { spaceErrorMessage, spacesLabels } from './spaces-labels';
import type { SpacesLabels } from './spaces-labels';
import type { SpaceMember, SpaceRoleOption, SpaceView } from './use-spaces';

export interface MembersSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly view: SpaceView | null;
  readonly roles: readonly SpaceRoleOption[];
  /** The person looking: never offered to remove themselves. */
  readonly me: string;
  readonly onInvite: (email: string, role: string) => Promise<{ readonly link: string }>;
  readonly onSetRole: (person: string, role: string) => Promise<unknown>;
  readonly onRemove: (person: string) => Promise<unknown>;
  readonly onLeave: () => Promise<unknown>;
  readonly labels?: SpacesLabels;
}

type Act = (run: () => Promise<unknown>) => Promise<void>;

function RoleSelect({ roles, value, onChange, className, label }: { readonly roles: readonly SpaceRoleOption[]; readonly value: string; readonly onChange: (role: string) => void; readonly className: string; readonly label: string }) {
  return <NativeSelect aria-label={label} value={value} onChange={event => onChange(event.target.value)} className={className}>
    {roles.map(role => <NativeSelectOption key={role.id} value={role.id}>{role.label}</NativeSelectOption>)}
  </NativeSelect>;
}

function MemberRow({ member, editable, me, roles, labels, onSetRole, onRemove }: { readonly member: SpaceMember; readonly editable: boolean; readonly me: string; readonly roles: readonly SpaceRoleOption[]; readonly labels: SpacesLabels; readonly onSetRole: (role: string) => void; readonly onRemove: () => void }) {
  const managed = editable && member.person && member.person !== me;
  return <li className="flex items-center gap-2 px-3 py-2" data-testid={`member-${member.person ?? member.name}`}>
    <span className="flex-1 truncate text-sm">{member.name || member.person}{member.person === me ? labels.you : ''}</span>
    {managed
      ? <RoleSelect roles={roles} value={member.role} onChange={onSetRole} className="w-36" label={labels.role} />
      : <span className="text-xs text-muted-foreground">{roles.find(role => role.id === member.role)?.label ?? member.role}</span>}
    {managed && <Button size="icon" variant="ghost" aria-label={labels.remove} title={labels.remove} onClick={onRemove}><UserMinusIcon className="size-4" /></Button>}
  </li>;
}

function InviteForm({ roles, labels, onInvite, act }: { readonly roles: readonly SpaceRoleOption[]; readonly labels: SpacesLabels; readonly onInvite: MembersSheetProps['onInvite']; readonly act: Act }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles.find(option => !option.manage)?.id ?? roles[0]?.id ?? '');
  const [link, setLink] = useState<string | null>(null);
  const submit = () => act(async () => { setLink((await onInvite(email.trim(), role)).link); setEmail(''); });
  return <section className="flex flex-col gap-2" aria-label={labels.invite}>
    <h3 className="text-sm font-medium">{labels.invite}</h3>
    <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <Input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder={labels.emailPlaceholder} aria-label={labels.email} data-testid="invite-email" />
      <div className="flex gap-2">
        <RoleSelect roles={roles} value={role} onChange={setRole} className="flex-1" label={labels.role} />
        <Button type="submit" data-testid="invite-submit">{labels.createLink}</Button>
      </div>
    </form>
    {link && <Item variant="muted" size="sm" data-testid="invite-link">
      <ItemContent className="min-w-0"><span className="truncate text-xs">{link}</span></ItemContent>
      <ItemActions><Button size="icon" variant="ghost" aria-label={labels.copy} onClick={() => void copyToClipboard(link)}><CopyIcon className="size-4" /></Button></ItemActions>
    </Item>}
    {link && <p className="text-xs text-muted-foreground">{labels.inviteHint}</p>}
  </section>;
}

export function MembersSheet({ open, onOpenChange, view, roles, me, onInvite, onSetRole, onRemove, onLeave, labels = spacesLabels }: MembersSheetProps) {
  const [error, setError] = useState<string | null>(null);
  const myRole = view?.space.role ?? null;
  const manager = Boolean(roles.find(role => role.id === myRole)?.manage);
  const access = manager ? view?.access ?? [] : [];
  const act: Act = async run => { setError(null); try { await run(); } catch (problem) { setError(spaceErrorMessage(problem, labels)); } };
  return <Sheet open={open} onOpenChange={next => onOpenChange(next)}>
    <SheetContent side="right" className="w-full sm:max-w-md" data-testid="members-sheet">
      <SheetHeader>
        <SheetTitle>{view?.space.title ?? '…'}</SheetTitle>
        <SheetDescription>{labels.membersDescription}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-6">
        {error && <p role="alert" className="text-sm text-destructive" data-testid="members-error">{error}</p>}
        <section className="flex flex-col gap-2" aria-label={labels.members}>
          <h3 className="text-sm font-medium">{labels.members}</h3>
          <ul className="flex flex-col divide-y">
            {(view?.members ?? []).map(member => <MemberRow key={member.person ?? member.name} member={member} editable={manager} me={me} roles={roles} labels={labels}
              onSetRole={role => void act(() => onSetRole(member.person!, role))} onRemove={() => void act(() => onRemove(member.person!))} />)}
          </ul>
        </section>
        {manager && <InviteForm key={view?.space.id} roles={roles} labels={labels} onInvite={onInvite} act={act} />}
        {access.length > 0 && <section className="flex flex-col gap-2" aria-label={labels.adminAccess} data-testid="admin-access">
          <h3 className="text-sm font-medium">{labels.adminAccess}</h3>
          <ul className="flex flex-col gap-1">
            {access.map(entry => <li key={entry.at} className="flex items-start gap-2 text-sm">
              <ShieldAlertIcon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
              <span>{labels.adminAccessEntry(entry)}</span>
            </li>)}
          </ul>
        </section>}
        {myRole && <Button variant="outline" className="self-start" onClick={() => void act(onLeave)} data-testid="leave-space"><LogOutIcon className="size-4" />{labels.leave}</Button>}
      </div>
    </SheetContent>
  </Sheet>;
}
