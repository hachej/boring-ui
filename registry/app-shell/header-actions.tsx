'use client';

// The header actions (`ScreenHeaderAction`) and their renderer, shared by the screen header and the AgentLayer header: up to two icon or label
// buttons (or links), the rest in « … ». Imports nothing from header.tsx or agent-layer.tsx (the shell's import graph has no cycle).
import { useState } from 'react';
import type { ComponentType, MouseEvent } from 'react';
import { EllipsisIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '../utils/utils';
import { afterBack } from './back';
import { AppSheet, SHEET_ROW } from './sheet';
import type { AppShellText } from './text';

interface Icon { className?: string }
export interface ScreenHeaderAction {
  readonly id: string;
  /** The accessible name and the tooltip. */
  readonly label: string;
  readonly icon: ComponentType<Icon>;
  /** `'always'` also shows the label as text next to the icon (default: icon only, at every width). */
  readonly showLabel?: 'always';
  /** The action is a link (an anchor); `onSelect` still runs on click. `target` and `rel` are set only when the host passes them. */
  readonly href?: string;
  readonly target?: string;
  readonly rel?: string;
  readonly onSelect: () => void;
}

export const ICON_BUTTON = 'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
const LABEL_BUTTON = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11';

/** One action as a control: an anchor when it has `href`, else a button. `onSelect` is the caller's run (it reads the live action at click time). */
function ActionControl({ action, prefix, onSelect }: { readonly action: ScreenHeaderAction; readonly prefix: string; readonly onSelect: () => void }) {
  const className = action.showLabel === 'always' ? LABEL_BUTTON : ICON_BUTTON;
  const content = <><action.icon className="size-4" aria-hidden="true" />{action.showLabel === 'always' && action.label}</>;
  return action.href !== undefined
    ? <a href={action.href} target={action.target} rel={action.rel} data-testid={`${prefix}-action-${action.id}`} aria-label={action.label} title={action.label} onClick={onSelect} className={className}>{content}</a>
    : <button type="button" data-testid={`${prefix}-action-${action.id}`} aria-label={action.label} title={action.label} onClick={onSelect} className={className}>{content}</button>;
}

/** Up to two actions as controls; the rest go in « … » (a sheet when compact, a menu otherwise). `prefix` names the test ids. Shared with the AgentLayer header. */
export function HeaderActions({ actions, compact, text, prefix, run }: { readonly actions: readonly ScreenHeaderAction[]; readonly compact: boolean; readonly text: AppShellText; readonly prefix: string; readonly run: (id: string) => void }) {
  const shown = actions.slice(0, 2), extra = actions.slice(2);
  const [sheetOpen, setSheetOpen] = useState(false);
  // A link in the phone sheet: the sheet closes first and a same-tab navigation waits for its history entry (afterBack), so the Back
  // manager never undoes it. A new tab, or a modified click, keeps the browser's own default.
  const sheetLink = (event: MouseEvent<HTMLAnchorElement>, action: ScreenHeaderAction) => {
    setSheetOpen(false);
    if ((action.target !== undefined && action.target !== '_self') || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) { afterBack(() => run(action.id)); return; }
    event.preventDefault();
    const href = action.href ?? '';
    afterBack(() => { run(action.id); window.location.assign(href); });
  };
  return <>
    {shown.map(action => <ActionControl key={action.id} action={action} prefix={prefix} onSelect={() => run(action.id)} />)}
    {extra.length > 0 && (compact
      ? <>
        <button type="button" data-testid={`${prefix}-more`} aria-label={text.actions} title={text.actions} onClick={() => setSheetOpen(true)} className={ICON_BUTTON}><EllipsisIcon className="size-4" aria-hidden="true" /></button>
        <AppSheet open={sheetOpen} onOpenChange={setSheetOpen} title={text.actions}>
          {extra.map(action => action.href === undefined
            ? <button key={action.id} type="button" data-testid={`${prefix}-action-${action.id}`} className={SHEET_ROW} onClick={() => { setSheetOpen(false); afterBack(() => run(action.id)); }}><action.icon className="size-4" />{action.label}</button>
            : <a key={action.id} href={action.href} target={action.target} rel={action.rel} data-testid={`${prefix}-action-${action.id}`} className={SHEET_ROW} onClick={event => sheetLink(event, action)}><action.icon className="size-4" />{action.label}</a>)}
        </AppSheet>
      </>
      : <DropdownMenu>
        <DropdownMenuTrigger data-testid={`${prefix}-more`} aria-label={text.actions} className={cn(ICON_BUTTON, 'data-popup-open:bg-accent')}><EllipsisIcon className="size-4" aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="app-shell w-48">
          {extra.map(action => <DropdownMenuItem key={action.id} data-testid={`${prefix}-action-${action.id}`} className="pointer-coarse:min-h-11" onClick={() => run(action.id)}
            render={action.href === undefined ? undefined : <a href={action.href} target={action.target} rel={action.rel} />}><action.icon className="size-4" />{action.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>)}
  </>;
}

