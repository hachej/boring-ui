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

export function SidebarMenuSub({ className = '', ...props }: ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu-sub" data-sidebar="menu-sub"
    className={`mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 ${className}`} {...props} />;
}
