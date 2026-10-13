'use client';

// The account menu: the compact sheet's content (`AccountMenu`) and the expanded sidebar's footer (`NavUser`, the sidebar-07 pattern).
// Both list « Améliorer l'app » (when the app has an `improve` agent, opened in the AgentLayer), the app's own `menu`, then sign out.
import { ChevronsUpDownIcon, LogOutIcon, SparklesIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useAgentLayer } from './agent-layer';
import { afterBack } from './back';
import { SHEET_ROW } from './sheet';
import type { AppShellText } from './text';

export interface AccountSpec {
  readonly name: string;
  readonly email?: string;
  readonly signOut?: () => void;
  readonly menu: readonly { readonly label: string; readonly onSelect: () => void }[];
}

/** « Jean Dupont » gives « JD »; one word gives its first letter. */
export function initials(name: string): string {
  const letters = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]!.toUpperCase());
  return letters.join('') || '?';
}

export function AccountAvatar({ account, size }: { readonly account: AccountSpec | undefined; readonly size?: 'default' | 'lg' }) {
  return <Avatar {...(size ? { size } : {})}><AvatarFallback>{initials(account?.name ?? '')}</AvatarFallback></Avatar>;
}

/** The compact account sheet's content. Every choice closes the sheet first (`done`). */
export function AccountMenu({ account, improve, text, done }: { readonly account: AccountSpec | undefined; readonly improve: boolean; readonly text: AppShellText; readonly done: () => void }) {
  const layer = useAgentLayer();
  const choose = (action: () => void) => () => { done(); afterBack(action); };
  return <div data-testid="account-menu">
    {account && <div className="flex items-center gap-3 px-4 py-3">
      <AccountAvatar account={account} size="lg" />
      <div className="min-w-0"><p className="m-0 truncate font-medium">{account.name}</p>{account.email && <p className="m-0 truncate text-xs text-muted-foreground">{account.email}</p>}</div>
    </div>}
    {improve && <button type="button" data-testid="account-improve" className={SHEET_ROW} onClick={choose(() => layer.open('improve'))}><SparklesIcon className="size-4" aria-hidden="true" />{text.improve}</button>}
    {account?.menu.map(entry => <button key={entry.label} type="button" className={SHEET_ROW} onClick={choose(entry.onSelect)}>{entry.label}</button>)}
    {account?.signOut && <button type="button" data-testid="account-sign-out" className={SHEET_ROW} onClick={choose(account.signOut)}><LogOutIcon className="size-4" aria-hidden="true" />{text.signOut}</button>}
  </div>;
}

/** The expanded sidebar footer: avatar, name and a dropdown with the same entries as the compact sheet. */
export function NavUser({ account, improve, text }: { readonly account: AccountSpec | undefined; readonly improve: boolean; readonly text: AppShellText }) {
  const layer = useAgentLayer();
  if (!account && !improve) return null;
  return <SidebarMenu><SidebarMenuItem>
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" data-testid="nav-user" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11 data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}>
        <AccountAvatar account={account} />
        <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{account?.name ?? text.account}</span>
          {account?.email && <span className="truncate text-xs text-muted-foreground">{account.email}</span>}
        </div>
        <ChevronsUpDownIcon className="ml-auto size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={4} className="w-56 min-w-56">
        {improve && <DropdownMenuItem className="pointer-coarse:min-h-11" data-testid="account-improve" onClick={() => layer.open('improve')}><SparklesIcon className="size-4" aria-hidden="true" />{text.improve}</DropdownMenuItem>}
        {account?.menu.map(entry => <DropdownMenuItem key={entry.label} className="pointer-coarse:min-h-11" onClick={entry.onSelect}>{entry.label}</DropdownMenuItem>)}
        {account?.signOut && <><DropdownMenuSeparator /><DropdownMenuItem className="pointer-coarse:min-h-11" data-testid="account-sign-out" onClick={account.signOut}><LogOutIcon className="size-4" aria-hidden="true" />{text.signOut}</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  </SidebarMenuItem></SidebarMenu>;
}
