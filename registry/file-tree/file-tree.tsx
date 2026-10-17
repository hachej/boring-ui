'use client';

import '@hachej/boring-ui-kit/file-tree.css';
import { FileTree as PackageFileTree, FileTreeView as PackageFileTreeView } from '@hachej/boring-ui-kit/file-tree-view';
import type { FileTreeComponents, FileTreeActionsProps, FileTreeButtonProps, FileTreeProps as PackageFileTreeProps, FileTreeViewProps as PackageFileTreeViewProps } from '@hachej/boring-ui-kit/file-tree-view';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../dropdown-menu/dropdown-menu';
import { cn } from '../utils/utils';

// Only touch-target layout is added; appearance remains the consumer's shadcn Button.
function LibraryButton({ className, ...props }: FileTreeButtonProps) {
  return <Button {...props} className={cn('max-sm:min-h-11 max-sm:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11', className)} />;
}

function FileActionMenu({ label, icon, items }: FileTreeActionsProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  return <DropdownMenu>
    <DropdownMenuTrigger ref={trigger} render={<LibraryButton type="button" variant="ghost" size="icon" />} data-file-more aria-label={label}>{icon}</DropdownMenuTrigger>
    <DropdownMenuContent data-boring="file-actions" align="end" finalFocus={trigger} className="w-max max-w-(--available-width)">
      {items.map(item => <DropdownMenuItem key={item.id} data-action={item.id} onClick={item.onSelect} className="max-sm:min-h-11 pointer-coarse:min-h-11">{item.icon}{item.label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export const fileTreeComponents = { Button: LibraryButton, Actions: FileActionMenu } satisfies FileTreeComponents;
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
