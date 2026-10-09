'use client';

// Adapted from shadcn/ui sidebar-11 and sidebar menu primitives at
// 6ea090075cd537d3b792c6c1a625e2448b6ede26. MIT; see THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from 'react';

export function SidebarMenu({ className = '', ...props }: ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" data-sidebar="menu" className={`flex w-full min-w-0 flex-col gap-1 ${className}`} {...props} />;
}

export function SidebarMenuItem({ className = '', ...props }: ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className={`group/menu-item relative ${className}`} {...props} />;
}

export function SidebarMenuButton({ className = '', isActive = false, ...props }: ComponentProps<'button'> & { readonly isActive?: boolean }) {
  return <button type="button" data-slot="sidebar-menu-button" data-sidebar="menu-button" data-size="default" data-active={isActive}
    className={`peer/menu-button flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 ${className}`} {...props} />;
}

export function SidebarMenuSub({ className = '', ...props }: ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu-sub" data-sidebar="menu-sub"
    className={`mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 ${className}`} {...props} />;
}
