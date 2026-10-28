'use client';

import { useId } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { TypeIcon, CodeXmlIcon, EllipsisIcon, ListIcon, PencilLineIcon } from 'lucide-react';
import { MarkdownEditor as RuntimeMarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import type { MarkdownEditorMenuProps, MarkdownEditorProps } from '@hachej/boring-ui-kit/markdown-editor';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ActionMenuContent, useMenuPortal } from '../button/actions';
import { editorControls } from '../button/editor-controls';

export type { MarkdownEditorProps } from '@hachej/boring-ui-kit/markdown-editor';

/** Shared by the standalone editor and the viewer's existing overflow menu. */
export function MarkdownMenuItems({ labels, mode, onModeChange, richDisabledReason, outline, testId = 'markdown' }: MarkdownEditorMenuProps) {
  const reasonId = useId();
  const row = 'min-h-8 max-sm:min-h-12 pointer-coarse:min-h-12';
  return <>
    <DropdownMenuGroup><DropdownMenuRadioGroup aria-label={labels.editorMode} value={mode} onValueChange={value => { if (value === 'rich' || value === 'source') onModeChange(value); }}>
      <DropdownMenuRadioItem value="rich" disabled={!!richDisabledReason} closeOnClick title={richDisabledReason ?? labels.formatted} aria-label={labels.formatted} aria-describedby={richDisabledReason ? reasonId : undefined} data-testid={`${testId}-mode-rich`} className={row}>
        <PencilLineIcon aria-hidden="true" /><span className="flex min-w-0 flex-col"><span>{labels.formatted}</span>{richDisabledReason && <span id={reasonId} className="whitespace-normal">{richDisabledReason}</span>}</span>
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="source" closeOnClick aria-label={labels.markdown} data-testid={`${testId}-mode-source`} className={row}><CodeXmlIcon aria-hidden="true" />{labels.markdown}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup></DropdownMenuGroup>
    {outline && <><DropdownMenuSeparator /><DropdownMenuGroup>
      <DropdownMenuCheckboxItem checked={outline.shown} closeOnClick onCheckedChange={outline.onChange} data-testid={`${testId}-outline`} className={row}><ListIcon aria-hidden="true" />{labels.showOutline}</DropdownMenuCheckboxItem>
    </DropdownMenuGroup></>}
  </>;
}

function MarkdownViewOptions(props: MarkdownEditorMenuProps) {
  const { ref: portalRef, container: portalContainer } = useMenuPortal();
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button ref={portalRef} variant="ghost" size="icon-sm" aria-label={props.labels.moreActions} title={props.labels.moreActions}><EllipsisIcon data-icon="inline-start" aria-hidden="true" /></Button>} />
    <ActionMenuContent label={props.labels.moreActions} testId="markdown-more" items={[]} container={portalContainer}><MarkdownMenuItems {...props} /></ActionMenuContent>
  </DropdownMenu>;
}

/** The host Toggle supplies the visible pressed state as well as toggle-button semantics. */
export function MarkdownFormattingControl({ 'aria-pressed': pressed, value, ...props }: ComponentPropsWithRef<'button'>) {
  return <Toggle size="sm" pressed={pressed === true || pressed === 'true'} value={value === undefined ? undefined : String(value)} {...props} className="max-sm:min-h-12! max-sm:min-w-12! pointer-coarse:min-h-12! pointer-coarse:min-w-12!"><TypeIcon data-icon="inline-start" aria-hidden="true" /></Toggle>;
}

const markdownControls = { ...editorControls, markdownMenu: MarkdownViewOptions, formattingControl: MarkdownFormattingControl };

export function MarkdownEditor({ className, ...props }: MarkdownEditorProps) {
  return <RuntimeMarkdownEditor components={markdownControls} {...props} className={['boring-markdown-recipe', className].filter(Boolean).join(' ')} />;
}
