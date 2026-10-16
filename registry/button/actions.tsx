'use client';

import { Fragment } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { EllipsisIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu';
import { Button, IconButton } from './button';
import { cn } from '../utils/utils';

export type BlockIcon = ComponentType<{ readonly className?: string | undefined; readonly 'aria-hidden'?: boolean | 'true' | 'false' | undefined }>;

/** Host actions in a header, reply footer or menu. The host retains all execution policy. */
export interface BlockAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: BlockIcon | undefined;
  readonly onSelect: () => void;
  readonly placement?: 'header' | 'menu' | undefined;
  readonly disabled?: boolean | undefined;
  readonly pressed?: boolean | undefined;
  readonly destructive?: boolean | undefined;
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly hint?: string;
  readonly shortcut?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly separatorBefore?: boolean;
  readonly group?: string;
  readonly testId?: string;
  readonly onSelect: () => void;
}

export interface ActionMenuProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly items: readonly MenuItem[];
  readonly testId?: string;
  readonly align?: 'start' | 'end';
  readonly size?: 'icon-bar' | 'icon-sm';
  readonly className?: string;
  readonly children?: ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
}

/** Only maps host actions to the consumer's shadcn Base UI menu. The primitive owns focus, positioning and dismissal. */
export function ActionMenu({ label, icon, items, testId = 'menu', align = 'end', size = 'icon-bar', className, children, onOpenChange }: ActionMenuProps) {
  const groups: MenuItem[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (!last || item.separatorBefore || last[0]?.group !== item.group) groups.push([item]);
    else last.push(item);
  }
  const choices = items.some(item => item.checked !== undefined);
  const rows = groups.map((group, index) => <Fragment key={group[0]!.id}>
    {index > 0 && <DropdownMenuSeparator />}
    <DropdownMenuGroup>
      {group[0]?.group && <DropdownMenuLabel>{group[0].group}</DropdownMenuLabel>}
      {group.map(item => {
        const content = <>
          {item.icon && <span className="text-muted-foreground">{item.icon}</span>}
          <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span>{item.description && <span data-testid={`${testId}-description`} className="block text-xs text-muted-foreground">{item.description}</span>}</span>
          {item.hint && <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
          {item.shortcut && <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>}
        </>;
        const common = { disabled: item.disabled, 'data-testid': item.testId ?? `${testId}-${item.id}`, 'data-item': item.id, onClick: item.onSelect, className: 'min-h-8 px-2.5 max-sm:min-h-10 pointer-coarse:min-h-10' };
        return item.checked !== undefined
          ? <DropdownMenuRadioItem key={item.id} value={item.id} {...common}>{content}</DropdownMenuRadioItem>
          : <DropdownMenuItem key={item.id} variant={item.destructive ? 'destructive' : 'default'} {...common}>{content}</DropdownMenuItem>;
      })}
    </DropdownMenuGroup>
  </Fragment>);
  return <DropdownMenu onOpenChange={open => onOpenChange?.(open)}>
    <DropdownMenuTrigger render={<IconButton label={label} size={size} data-testid={testId} className={className}>{icon}</IconButton>} />
    <DropdownMenuContent align={align} aria-label={label} data-testid={`${testId}-list`} className="w-64 max-w-[calc(100vw-1rem)]">
      {children}
      {choices ? <DropdownMenuRadioGroup value={items.find(item => item.checked)?.id ?? ''}>{rows}</DropdownMenuRadioGroup> : rows}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function actionMenuItem(action: BlockAction, testId: string): MenuItem {
  const Icon = action.icon;
  return { id: action.id, label: action.label, ...(Icon ? { icon: <Icon className="size-4" aria-hidden="true" /> } : {}), ...(action.disabled ? { disabled: true } : {}), ...(action.destructive ? { destructive: true } : {}), testId: `${testId}-${action.id}`, onSelect: action.onSelect };
}

export const headerActions = (actions: readonly BlockAction[] | undefined): readonly BlockAction[] => (actions ?? []).filter(action => action.placement !== 'menu');
export const menuActions = (actions: readonly BlockAction[] | undefined): readonly BlockAction[] => (actions ?? []).filter(action => action.placement === 'menu');

export function ActionButton({ action, testId, size = 'icon-sm', className, iconOnly = false }: { readonly action: BlockAction; readonly testId: string; readonly size?: 'icon-sm' | 'icon-bar'; readonly className?: string; readonly iconOnly?: boolean }) {
  const Icon = action.icon ?? (iconOnly ? EllipsisIcon : undefined);
  if (Icon) return <IconButton label={action.label} size={size} data-testid={`${testId}-${action.id}`} data-action={action.id} disabled={action.disabled} {...(action.pressed === undefined ? {} : { 'aria-pressed': action.pressed })} onClick={action.onSelect} className={className}>
    <Icon className="size-4" aria-hidden="true" /></IconButton>;
  return <Button size="sm" variant="ghost" data-testid={`${testId}-${action.id}`} data-action={action.id} disabled={action.disabled} {...(action.pressed === undefined ? {} : { 'aria-pressed': action.pressed })} onClick={action.onSelect} title={action.label}
    className={cn('max-w-40 min-w-0 text-muted-foreground', className)}><span className="truncate">{action.label}</span></Button>;
}

export function BlockActions({ actions, testId, menuLabel, size = 'icon-sm', className, iconOnly = false }: {
  readonly actions: readonly BlockAction[] | undefined;
  readonly testId: string;
  readonly menuLabel: string;
  readonly size?: 'icon-sm' | 'icon-bar';
  readonly className?: string;
  readonly iconOnly?: boolean;
}) {
  const buttons = headerActions(actions), menu = menuActions(actions);
  if (!buttons.length && !menu.length) return null;
  return <div data-boring="block-actions" data-actions={testId} className={cn('flex shrink-0 items-center gap-0.5', className)}>
    {buttons.map(action => <ActionButton key={action.id} action={action} testId={testId} size={size} iconOnly={iconOnly} />)}
    {menu.length > 0 && <ActionMenu label={menuLabel} size={size} testId={`${testId}-more`} icon={<EllipsisIcon className="size-4" aria-hidden="true" />}
      items={menu.map(action => actionMenuItem(action, testId))} />}
  </div>;
}
