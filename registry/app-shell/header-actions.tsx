'use client';

// The header actions (`ScreenHeaderAction`) and their renderer, shared by the screen header and the AgentLayer header: up to two icon or label
// buttons (or links), the rest in « … ». Imports nothing from header.tsx or agent-layer.tsx (the shell's import graph has no cycle).
import { useState } from 'react';
import type { ComponentType, MouseEvent } from 'react';
import { EllipsisIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { afterBack } from './back';
import { AppSheet, SHEET_ROW } from './app-sheet';
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

/** One action as a control: an anchor when it has `href`, else a button. `onSelect` is the caller's run (it reads the live action at click time). */
function ActionControl({ action, prefix, onSelect }: { readonly action: ScreenHeaderAction; readonly prefix: string; readonly onSelect: () => void }) {
  const content = <><action.icon data-icon="inline-start" aria-hidden="true" />{action.showLabel === 'always' && action.label}</>;
  return <Button variant="ghost" size={action.showLabel === 'always' ? 'default' : 'icon'}
    {...(action.href !== undefined ? { nativeButton: false, render: <a href={action.href} target={action.target} rel={action.rel} /> } : {})}
    data-testid={`${prefix}-action-${action.id}`} aria-label={action.label} title={action.label} onClick={onSelect}>{content}</Button>;
}

/** Up to two actions as controls; the rest go in « … » (a sheet when compact, a menu otherwise). `prefix` names the test ids. Shared with the AgentLayer header. */
export function HeaderActions({ actions, compact, text, prefix, run }: { readonly actions: readonly ScreenHeaderAction[]; readonly compact: boolean; readonly text: AppShellText; readonly prefix: string; readonly run: (id: string) => void }) {
  const shown = actions.slice(0, 2), extra = actions.slice(2);
  const [sheetOpen, setSheetOpen] = useState(false);
  // A link in the phone sheet: the sheet closes first and a same-tab navigation waits for its history entry (afterBack), so the Back
  // manager never undoes it. A new tab, or a modified click, keeps the browser's own default.
  const sheetLink = (event: MouseEvent<HTMLElement>, action: ScreenHeaderAction) => {
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
        <Button variant="ghost" size="icon" data-testid={`${prefix}-more`} aria-label={text.actions} title={text.actions} onClick={() => setSheetOpen(true)}><EllipsisIcon data-icon="inline-start" aria-hidden="true" /></Button>
        <AppSheet open={sheetOpen} onOpenChange={setSheetOpen} title={text.actions}>
          {extra.map(action => action.href === undefined
            ? <Button key={action.id} variant="ghost" size="lg" data-testid={`${prefix}-action-${action.id}`} className={SHEET_ROW} onClick={() => { setSheetOpen(false); afterBack(() => run(action.id)); }}><action.icon data-icon="inline-start" />{action.label}</Button>
            : <Button key={action.id} variant="ghost" size="lg" nativeButton={false} render={<a href={action.href} target={action.target} rel={action.rel} />} data-testid={`${prefix}-action-${action.id}`} className={SHEET_ROW} onClick={event => sheetLink(event, action)}><action.icon data-icon="inline-start" />{action.label}</Button>)}
        </AppSheet>
      </>
      : <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} data-testid={`${prefix}-more`} aria-label={text.actions} title={text.actions}><EllipsisIcon data-icon="inline-start" aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="app-shell w-48">
          {extra.map(action => <DropdownMenuItem key={action.id} data-testid={`${prefix}-action-${action.id}`} className="pointer-coarse:min-h-11" onClick={() => run(action.id)}
            render={action.href === undefined ? undefined : <a href={action.href} target={action.target} rel={action.rel} />}><action.icon className="size-4" />{action.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>)}
  </>;
}

