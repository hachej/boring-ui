'use client';

import { Fragment, useCallback, useRef } from 'react';
import type { ComponentProps, ComponentType, ReactNode, RefObject } from 'react';
import { EllipsisIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
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

type ActionIconSize = Extract<ComponentProps<typeof Button>['size'], 'icon' | 'icon-sm'>;

export function ActionMenuItemContent({ item, testId }: { readonly item: MenuItem; readonly testId: string }) {
  return <>
    {item.icon && <span className="text-muted-foreground">{item.icon}</span>}
    <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span>{item.description && <span data-testid={`${testId}-description`} className="block text-xs text-muted-foreground">{item.description}</span>}</span>
    {item.hint && <span data-testid={`${testId}-hint`} className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
    {item.shortcut && <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>}
  </>;
}

/**
 * Portal target and trigger ref for a menu that must open in its trigger's own document (a viewer in a pop-out window).
 * Put `ref` on the trigger button and `container` on `ActionMenuContent`.
 */
export function useMenuPortal() {
  const container = useRef<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => { container.current = node?.ownerDocument.body ?? null; }, []);
  return { container, ref };
}

/** Maps host menu items to the consumer's shadcn dropdown items inside a `DropdownMenu`; the primitives own focus, positioning and dismissal. */
export function ActionMenuContent({ label, testId, items, container, align = 'end', children }: { readonly label: string; readonly testId: string; readonly items: readonly MenuItem[]; readonly container?: RefObject<HTMLElement | null>; readonly align?: 'start' | 'end'; readonly children?: ReactNode }) {
  const groups: MenuItem[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (!last || item.separatorBefore || last[0]?.group !== item.group) groups.push([item]);
    else last.push(item);
  }
  const rows = groups.map((group, index) => <Fragment key={group[0]!.id}>
    {index > 0 && <DropdownMenuSeparator />}
    <DropdownMenuGroup>
      {group[0]?.group && <DropdownMenuLabel>{group[0].group}</DropdownMenuLabel>}
      {group.map(item => {
        const common = { disabled: item.disabled, 'data-testid': item.testId ?? `${testId}-${item.id}`, 'data-item': item.id, onClick: item.onSelect, className: 'min-h-8 max-sm:min-h-10 pointer-coarse:min-h-10' };
        const content = <ActionMenuItemContent item={item} testId={testId} />;
        return item.checked !== undefined
          ? <DropdownMenuRadioItem key={item.id} value={item.id} {...common}>{content}</DropdownMenuRadioItem>
          : <DropdownMenuItem key={item.id} variant={item.destructive ? 'destructive' : 'default'} {...common}>{content}</DropdownMenuItem>;
      })}
    </DropdownMenuGroup>
  </Fragment>);
  return <DropdownMenuPortal {...(container ? { container } : {})}>
    <DropdownMenuContent align={align} aria-label={label} data-testid={`${testId}-list`} className="w-64 max-w-[calc(100vw-1rem)]">
      {children}
      {items.some(item => item.checked !== undefined) ? <DropdownMenuRadioGroup value={items.find(item => item.checked)?.id ?? ''}>{rows}</DropdownMenuRadioGroup> : rows}
    </DropdownMenuContent>
  </DropdownMenuPortal>;
}

export function actionMenuItem(action: BlockAction, testId: string): MenuItem {
  const Icon = action.icon;
  return { id: action.id, label: action.label, ...(Icon ? { icon: <Icon data-icon="inline-start" aria-hidden="true" /> } : {}), ...(action.disabled ? { disabled: true } : {}), ...(action.destructive ? { destructive: true } : {}), testId: `${testId}-${action.id}`, onSelect: action.onSelect };
}

export const headerActions = (actions: readonly BlockAction[] | undefined): readonly BlockAction[] => (actions ?? []).filter(action => action.placement !== 'menu');
export const menuActions = (actions: readonly BlockAction[] | undefined): readonly BlockAction[] => (actions ?? []).filter(action => action.placement === 'menu');

export function ActionButton({ action, testId, size = 'icon-sm', className, iconOnly = false }: { readonly action: BlockAction; readonly testId: string; readonly size?: ActionIconSize; readonly className?: string; readonly iconOnly?: boolean }) {
  const Icon = action.icon ?? (iconOnly ? EllipsisIcon : undefined);
  const content = Icon ? <Icon data-icon="inline-start" aria-hidden="true" /> : <span className="truncate">{action.label}</span>;
  const layout = cn(!Icon && 'max-w-40 min-w-0', className);
  if (action.pressed !== undefined) return <Toggle size={size === 'icon' ? 'default' : 'sm'} aria-label={action.label} title={action.label} data-testid={`${testId}-${action.id}`} data-action={action.id} disabled={action.disabled} pressed={action.pressed} onPressedChange={() => action.onSelect()} className={layout}>{content}</Toggle>;
  return <Button size={Icon ? size : 'sm'} variant="ghost" aria-label={action.label} title={action.label} data-testid={`${testId}-${action.id}`} data-action={action.id} disabled={action.disabled} onClick={action.onSelect} className={layout}>{content}</Button>;
}

export function BlockActions({ actions, testId, menuLabel, size = 'icon-sm', className, iconOnly = false }: {
  readonly actions: readonly BlockAction[] | undefined;
  readonly testId: string;
  readonly menuLabel: string;
  readonly size?: ActionIconSize;
  readonly className?: string;
  readonly iconOnly?: boolean;
}) {
  const { container, ref: portalRef } = useMenuPortal();
  const buttons = headerActions(actions), menu = menuActions(actions);
  if (!buttons.length && !menu.length) return null;
  const moreId = `${testId}-more`;
  return <div data-boring="block-actions" data-actions={testId} className={cn('flex shrink-0 items-center gap-0.5', className)}>
    {buttons.map(action => <ActionButton key={action.id} action={action} testId={testId} size={size} iconOnly={iconOnly} />)}
    {menu.length > 0 && <DropdownMenu>
      <DropdownMenuTrigger render={<Button ref={portalRef} variant="ghost" aria-label={menuLabel} title={menuLabel} size={size} data-testid={moreId}><EllipsisIcon data-icon="inline-start" aria-hidden="true" /></Button>} />
      <ActionMenuContent label={menuLabel} testId={moreId} container={container} items={menu.map(action => actionMenuItem(action, testId))} />
    </DropdownMenu>}
  </div>;
}
