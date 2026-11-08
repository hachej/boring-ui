// Components, part 5: the app shell (sidebar) and toasts. Both are the kit's real shadcn/ui files.
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { FileIcon, FolderIcon, PlusIcon } from '../../registry/_shared/icons';
import { Bounded, Demo, groupsOf } from './demo.jsx';

export function SidebarDemo() {
  const { variant, size } = groupsOf('sidebar', 'sidebarMenuButtonVariants');
  return (
    <Demo names="Sidebar SidebarProvider SidebarHeader SidebarContent SidebarFooter SidebarGroup SidebarGroupLabel SidebarGroupAction SidebarGroupContent SidebarMenu SidebarMenuItem SidebarMenuButton SidebarMenuAction SidebarMenuBadge SidebarMenuSkeleton SidebarMenuSub SidebarMenuSubItem SidebarMenuSubButton SidebarSeparator SidebarInput SidebarInset SidebarRail SidebarTrigger" title="Sidebar" note="The fixed sidebar (collapsible none): the off-canvas and mobile forms are a Sheet, shown above.">
      <SidebarProvider className="relative h-96 min-h-0 overflow-hidden rounded-lg border border-border">
        <Sidebar collapsible="none">
          <SidebarHeader><SidebarInput aria-label="Search files" placeholder="Search" /></SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupAction aria-label="Add"><PlusIcon /></SidebarGroupAction>
              <SidebarGroupContent>
                <SidebarMenu>
                  {variant.flatMap(name => size.map(sizeName => (
                    <SidebarMenuItem key={`${name}-${sizeName}`} data-ds-variant={`${name}-${sizeName}`}>
                      <SidebarMenuButton variant={name} size={sizeName} isActive={name === 'default' && sizeName === 'default'}><FolderIcon />{name} {sizeName}</SidebarMenuButton>
                      <SidebarMenuAction aria-label="More"><PlusIcon /></SidebarMenuAction>
                      <SidebarMenuBadge>3</SidebarMenuBadge>
                    </SidebarMenuItem>
                  )))}
                  <SidebarMenuItem>
                    <SidebarMenuButton><FileIcon />With sub items</SidebarMenuButton>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem><SidebarMenuSubButton isActive>Sub one</SidebarMenuSubButton></SidebarMenuSubItem>
                      <SidebarMenuSubItem><SidebarMenuSubButton size="sm">Sub two</SidebarMenuSubButton></SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                  <SidebarMenuItem><SidebarMenuSkeleton showIcon /></SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarSeparator />
          <SidebarFooter>Footer</SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset><div className="flex items-center gap-2 p-2"><SidebarTrigger />Inset content</div></SidebarInset>
      </SidebarProvider>
    </Demo>
  );
}

const FIRE = [
  ['success', 'Saved', 'The change is in the workspace.'],
  ['info', 'Heads up', 'A new version is available.'],
  ['warning', 'Almost full', 'The workspace is at 90 percent.'],
  ['error', 'Not saved', 'The file changed on disk.'],
];

export function ToastDemo() {
  useEffect(() => {
    toast.dismiss();
    toast.success(FIRE[0][1], { description: FIRE[0][2] });
    toast.error(FIRE[3][1], { description: FIRE[3][2] });
  }, []);
  return (
    <Demo
      names="Toaster"
      title="Toast"
      note="The kit's Toaster (shadcn/ui/sonner.tsx) is bundled for real and shows real toasts. sonner itself is an app dependency, not the kit's, so this page draws the toasts with a small stand-in renderer: the icons, token colours and offsets are the kit's."
    >
      <div className="flex flex-wrap gap-2">
        {FIRE.map(([type, title, description]) => <Button key={type} size="sm" variant="outline" onClick={() => toast[type](title, { description })}>{type}</Button>)}
      </div>
      <Bounded id="toast" height={260}>
        <div data-ds-overlay="toast" className="size-full"><Toaster /></div>
      </Bounded>
    </Demo>
  );
}
