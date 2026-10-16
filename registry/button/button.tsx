import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../utils/utils';

const variants = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-background hover:bg-muted',
  ghost: 'border-0 bg-transparent shadow-none hover:bg-muted/60 hover:text-foreground active:bg-muted',
  /** A ghost button whose resting text is muted (viewer bars). */
  quiet: 'border-0 bg-transparent text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground active:bg-muted',
  destructive: 'bg-destructive text-white hover:bg-destructive/90',
} as const;
// Targets are at least 32px with a pointer and 44px on a phone or coarse pointer.
// `bar` and `icon-bar` are the compact viewer-bar sizes: 44px on touch, with the tighter radius of a toolbar.
const sizes = {
  sm: 'h-8 gap-1.5 px-3 text-xs max-sm:h-11 pointer-coarse:h-11',
  md: 'h-9 gap-1.5 px-3.5 text-sm max-sm:h-11 pointer-coarse:h-11',
  icon: 'size-9 max-sm:size-11 pointer-coarse:size-11',
  'icon-sm': 'size-8 max-sm:size-11 pointer-coarse:size-11',
  bar: 'h-8 gap-1.5 rounded-md px-3 text-xs max-sm:h-11 pointer-coarse:h-11',
  'icon-bar': 'size-8 rounded-md max-sm:size-11 pointer-coarse:size-11',
} as const;

/** A 20px navigation glyph with the same light stroke as the phone's new-chat pencil. */
export function NavigationMenuIcon({ className }: { readonly className?: string | undefined }) {
  return <svg className={cn(className, 'size-5')} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 8h16M4 16h10" /></svg>;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: keyof typeof variants;
  readonly size?: keyof typeof sizes;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** shadcn-style button shared by every item. Always `type="button"` unless a form submit is requested. */
export function Button({ className, variant = 'ghost', size = 'md', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(
    'inline-flex min-h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-md font-medium max-sm:min-h-11 max-sm:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11 whitespace-nowrap transition-colors outline-none',
    'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none',
    variants[variant], sizes[size], className)} {...props} />;
}

/** A bar button: an icon with an accessible name and a tooltip (quiet and bar-sized unless told otherwise). */
export function IconButton({ label, children, variant = 'quiet', size = 'icon-bar', ...props }: { readonly label: string; readonly children: ReactNode } & Omit<ButtonProps, 'children'>) {
  return <Button variant={variant} size={size} aria-label={label} title={label} {...props}>{children}</Button>;
}
