import type { ComponentType, ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';

type Icon = ComponentType<{ 'data-icon'?: string; 'aria-hidden'?: boolean }>;

export type SidebarListChild = {
  id: string;
  label: string;
  icon?: Icon;
  active?: boolean;
  onSelect: () => void;
};

export type SidebarListItem = {
  id: string;
  label: string;
  /** A string is the avatar's letters (default: the first letter of the label); an icon replaces the avatar. */
  avatar?: string | Icon;
  /** Shown on the right; nothing when 0 or missing. */
  count?: number;
  active?: boolean;
  onSelect: () => void;
  /** The sub-items shown under the row while it is expanded. */
  children?: readonly SidebarListChild[];
};

export type SidebarListProps = {
  /** The group's title (« Clients »). */
  label: string;
  /** A small button beside the title (« + create »). */
  action?: { label: string; icon: Icon; onSelect: () => void };
  items: readonly SidebarListItem[];
  /** The id of the item whose children show. Default: the active item. */
  expanded?: string;
  /** Shown when `items` is empty. */
  empty?: ReactNode;
};

const initial = (label: string) => (label.trim().charAt(0) || '?').toUpperCase();

function Lead({ item }: { item: SidebarListItem }) {
  if (typeof item.avatar === 'function') {
    const Icon = item.avatar;
    return <Icon data-icon="inline-start" aria-hidden />;
  }
  return (
    <Avatar size="sm" aria-hidden>
      <AvatarFallback>{(item.avatar ?? initial(item.label)).slice(0, 2)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * A list of records in the left pane: a titled group, one row per record (avatar or icon, label, count) and the open row unfolds its sub-items.
 * Only the kit's sidebar primitives: on the collapsed icon rail the rows shrink to their avatars, the counts, labels and sub-items fold away by themselves.
 * Sub-rows are small SidebarMenuButtons (a real button, same 12px text and touch floor), because SidebarMenuSubButton renders an anchor.
 * In an AppShell, render it from `NavItem.sidebar` (the shell passes `{ collapsed }`; the primitives already fold, so ignore it):
 *
 *   { id: 'clients', label: 'Clients', icon: UsersIcon, sidebar: () => (
 *     <SidebarList label="Clients" action={{ label: 'New client', icon: PlusIcon, onSelect: create }}
 *       items={clients.map(c => ({ id: c.id, label: c.name, count: c.missing, active: c.id === current, onSelect: () => open(c.id),
 *         children: screens.map(s => ({ id: s.id, label: s.label, icon: s.icon, active: s.id === screen, onSelect: () => go(c.id, s.id) })) }))} />
 *   ) }
 *
 * Install: `npx boring-ui-blocks add sidebar-list` (needs the shadcn `sidebar` and `avatar` components).
 */
export function SidebarList({ label, action, items, expanded, empty }: SidebarListProps) {
  const open = expanded ?? items.find(item => item.active)?.id;
  return (
    <SidebarGroup aria-label={label}>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      {action ? (
        <SidebarGroupAction aria-label={action.label} title={action.label} onClick={action.onSelect}>
          <action.icon aria-hidden />
        </SidebarGroupAction>
      ) : null}
      {items.length === 0 && empty ? <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">{empty}</p> : null}
      <SidebarMenu>
        {items.map(item => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              isActive={item.active}
              tooltip={item.label}
              title={item.label}
              aria-expanded={item.children?.length ? item.id === open : undefined}
              className={item.count ? 'pr-9' : undefined}
              onClick={item.onSelect}
            >
              <Lead item={item} />
              <span>{item.label}</span>
            </SidebarMenuButton>
            {item.count ? <SidebarMenuBadge>{item.count}</SidebarMenuBadge> : null}
            {item.id === open && item.children?.length ? (
              <SidebarMenuSub aria-label={item.label}>
                {item.children.map(child => (
                  <SidebarMenuSubItem key={child.id}>
                    <SidebarMenuButton size="sm" isActive={child.active} aria-current={child.active ? 'page' : undefined} onClick={child.onSelect}>
                      {child.icon ? <child.icon data-icon="inline-start" aria-hidden /> : null}
                      <span>{child.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            ) : null}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
