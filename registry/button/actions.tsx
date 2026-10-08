'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, ReactNode } from 'react';
import { CheckIcon, EllipsisIcon } from 'lucide-react';
import { Button, IconButton } from './button';
import { cn } from '../utils/utils';

/** An icon the host may pass for any of the blocks' icons: any component that takes a class name (every lucide icon does). */
export type BlockIcon = ComponentType<{ readonly className?: string | undefined; readonly 'aria-hidden'?: boolean | 'true' | 'false' | undefined }>;

/**
 * A host action added to a block's bar or row (the chat header, the floating chat's bar, the artifact panel, a conversation row, a reply),
 * next to the block's own buttons. `header` (the default) is a button in the bar: icon only when `icon` is given (the label is then its
 * accessible name and tooltip), otherwise the label. `menu` puts it in the block's "…" menu. Its test id is `<surface>-<id>` (see each block).
 */
export interface BlockAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: BlockIcon | undefined;
  readonly onSelect: () => void;
  readonly placement?: 'header' | 'menu' | undefined;
  readonly disabled?: boolean | undefined;
}

/** One row of a menu. With `checked` set (true or false) the row is a radio choice, otherwise a plain action. */
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** Small text after the label, for example "Latest". */
  readonly hint?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
  readonly onSelect: () => void;
}

export interface ActionMenuProps {
  /** Accessible name and tooltip of the trigger; also the name of the menu. */
  readonly label: string;
  readonly icon: ReactNode;
  readonly items: readonly MenuItem[];
  readonly testId?: string;
  /** Which edge of the trigger the menu lines up with. */
  readonly align?: 'start' | 'end';
  /** The trigger's size: the viewer bar's (default) or a small chat button. */
  readonly size?: 'icon-bar' | 'icon-sm';
  readonly className?: string;
}

const ITEM = 'flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-45 max-sm:h-11 pointer-coarse:h-11';

/**
 * An icon button that opens a small menu: arrow keys, Home/End and roving focus, Escape (focus returns to the trigger), Tab and an outside
 * press close it. The one menu of the blocks' "…" buttons and the viewers' version history.
 */
export function ActionMenu({ label, icon, items, testId = 'menu', align = 'end', size = 'icon-bar', className }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const radio = items.some(item => item.checked !== undefined);

  useEffect(() => {
    if (!open) return;
    const list = root.current?.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)');
    const wanted = root.current?.querySelector<HTMLElement>('[aria-checked=true]:not(:disabled)') ?? list?.[0];
    wanted?.focus();
    const away = (event: Event) => { if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => { event.preventDefault(); rows[(index + rows.length) % rows.length]?.focus(); };
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(false);
    else if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(-1);
  };

  return <div ref={root} data-viewer-menu className={cn('relative', className)} onKeyDown={event => { if (open) keys(event); }}>
    <IconButton ref={trigger} label={label} size={size} data-testid={testId} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setOpen(true); } }}>{icon}</IconButton>
    {open && <div id={menuId} role="menu" aria-label={label} data-testid={`${testId}-list`}
      className={cn('absolute top-full z-50 mt-1 grid max-h-72 min-w-48 gap-0.5 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg', 'max-sm:fixed max-sm:inset-x-2 max-sm:top-auto max-sm:bottom-2 max-sm:mt-0 max-sm:max-h-[70vh] max-sm:rounded-xl max-sm:p-1.5', align === 'end' ? 'right-0' : 'left-0')}>
      {items.map(item => <button key={item.id} type="button" tabIndex={-1} role={radio ? 'menuitemradio' : 'menuitem'} {...(radio ? { 'aria-checked': item.checked === true } : {})}
        disabled={item.disabled} data-testid={item.testId ?? `${testId}-${item.id}`} data-item={item.id} className={ITEM}
        onClick={() => { close(true); item.onSelect(); }}>
        {item.icon ?? (radio ? <span className="size-4 shrink-0">{item.checked && <CheckIcon className="size-4" aria-hidden="true" />}</span> : null)}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.hint && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{item.hint}</span>}
      </button>)}
    </div>}
  </div>;
}

/** A host action as a menu row (for a block that already has a "…" menu of its own). */
export function actionMenuItem(action: BlockAction, testId: string): MenuItem {
  const Icon = action.icon;
  return { id: action.id, label: action.label, ...(Icon ? { icon: <Icon className="size-4" aria-hidden="true" /> } : {}), ...(action.disabled ? { disabled: true } : {}), testId: `${testId}-${action.id}`, onSelect: action.onSelect };
}

/** The `header` actions of a list. */
export const headerActions = (actions: readonly BlockAction[] | undefined): readonly BlockAction[] => (actions ?? []).filter(action => action.placement !== 'menu');
/** The `menu` actions of a list. */
export const menuActions = (actions: readonly BlockAction[] | undefined): readonly BlockAction[] => (actions ?? []).filter(action => action.placement === 'menu');

/** One `header` action as a bar button: the icon with the label as its name and tooltip, or the label as text. */
export function ActionButton({ action, testId, size = 'icon-sm', className }: { readonly action: BlockAction; readonly testId: string; readonly size?: 'icon-sm' | 'icon-bar'; readonly className?: string }) {
  const Icon = action.icon;
  if (Icon) return <IconButton label={action.label} size={size} data-testid={`${testId}-${action.id}`} data-action={action.id} disabled={action.disabled} onClick={action.onSelect} className={className}>
    <Icon className="size-4" aria-hidden="true" /></IconButton>;
  return <Button size="sm" variant="ghost" data-testid={`${testId}-${action.id}`} data-action={action.id} disabled={action.disabled} onClick={action.onSelect} title={action.label}
    className={cn('max-w-40 min-w-0 text-muted-foreground', className)}><span className="truncate">{action.label}</span></Button>;
}

/**
 * A block's host actions where it has no "…" menu of its own: the `header` ones as buttons, then one "…" menu (test id `<testId>-more`)
 * holding the `menu` ones. Each action's test id is `<testId>-<id>`. Nothing is rendered for an empty list.
 */
export function BlockActions({ actions, testId, menuLabel, size = 'icon-sm', className }: {
  readonly actions: readonly BlockAction[] | undefined;
  readonly testId: string;
  /** The "…" button's name. */
  readonly menuLabel: string;
  readonly size?: 'icon-sm' | 'icon-bar';
  readonly className?: string;
}) {
  const buttons = headerActions(actions), menu = menuActions(actions);
  if (!buttons.length && !menu.length) return null;
  return <div data-boring="block-actions" data-actions={testId} className={cn('flex shrink-0 items-center gap-0.5', className)}>
    {buttons.map(action => <ActionButton key={action.id} action={action} testId={testId} size={size} />)}
    {menu.length > 0 && <ActionMenu label={menuLabel} size={size} testId={`${testId}-more`} icon={<EllipsisIcon className="size-4" aria-hidden="true" />}
      items={menu.map(action => actionMenuItem(action, testId))} />}
  </div>;
}
