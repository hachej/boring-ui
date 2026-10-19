'use client';

import '@hachej/boring-ui-kit/file-tree.css';
import { FileTree as PackageFileTree, FileTreeView as PackageFileTreeView } from '@hachej/boring-ui-kit/file-tree-view';
import type { FileTreeComponents, FileTreeActionsProps, FileTreeButtonProps, FileTreeVersionsProps, FileTreeProps as PackageFileTreeProps, FileTreeViewProps as PackageFileTreeViewProps } from '@hachej/boring-ui-kit/file-tree-view';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { SidebarMenu, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { VersionHistoryRows, frenchVersionHistoryLabels } from '../version-history/version-history';
import { cn } from '../utils/utils';

// Only touch-target layout is added; appearance remains the consumer's shadcn Button.
function LibraryButton({ className, ...props }: FileTreeButtonProps) {
  return <Button {...props} className={cn('max-sm:min-h-11 max-sm:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11', className)} />;
}

function FileActions({ label, icon, items }: FileTreeActionsProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const portal = useRef<HTMLElement | null>(null);
  return <DropdownMenu>
    <DropdownMenuTrigger ref={trigger} render={<LibraryButton type="button" variant="ghost" size="icon" ref={node => { portal.current = node?.ownerDocument.body ?? null; }} />} data-file-more aria-label={label}>{icon}</DropdownMenuTrigger>
    <DropdownMenuPortal container={portal}>
      <DropdownMenuContent data-boring="file-actions" align="end" finalFocus={trigger} className="w-max max-w-(--available-width)">
        {items.map(item => <DropdownMenuItem key={item.id} data-action={item.id} onClick={item.onSelect} className="max-sm:min-h-11 pointer-coarse:min-h-11">{item.icon}{item.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenu>;
}

function FileVersions({ versions, current, onSelect, locale, earlierVersion }: FileTreeVersionsProps) {
  return <VersionHistoryRows versions={versions.map(version => ({ id: version.revision, label: earlierVersion, savedAt: version.savedAt, ...(version.source ? { source: version.source } : {}) }))}
    current={current} onSelect={onSelect} testId="file-history-versions" {...(locale === 'fr' ? { labels: frenchVersionHistoryLabels } : {})} />;
}

function FileTreeEmpty({ icon, title, description, className, children }: Parameters<FileTreeComponents['Empty']>[0]) {
  return <Empty className={className}>
    <EmptyHeader>
      {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
      <EmptyTitle>{title}</EmptyTitle>
      {description && <EmptyDescription>{description}</EmptyDescription>}
    </EmptyHeader>
    {children && <EmptyContent>{children}</EmptyContent>}
  </Empty>;
}

export const fileTreeComponents = {
  Button: LibraryButton, Actions: FileActions, Versions: FileVersions,
  Menu: SidebarMenu, MenuItem: SidebarMenuItem, MenuSub: SidebarMenuSub, Input, Separator: () => <Separator />,
  Collapsible, CollapsibleTrigger, CollapsibleContent, Empty: FileTreeEmpty,
  Progress: ({ value, 'aria-label': label }: { readonly value: number | null; readonly 'aria-label': string }) => <Progress value={value} aria-label={label} />,
} satisfies FileTreeComponents;
export type FileTreeProps = Omit<PackageFileTreeProps, 'components'>;
export type FileTreeViewProps = Omit<PackageFileTreeViewProps, 'components'>;

export function FileTree(props: FileTreeProps) {
  return <PackageFileTree {...props} components={fileTreeComponents} />;
}
export function FileTreeView(props: FileTreeViewProps) {
  return <PackageFileTreeView {...props} components={fileTreeComponents} />;
}
export { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
export type { FileTreeController } from '@hachej/boring-ui-kit/file-tree';
