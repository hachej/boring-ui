import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../utils/utils';

const variants = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-background hover:bg-muted',
  ghost: 'hover:bg-muted hover:text-foreground',
  /** A ghost button whose resting text is muted (viewer bars). */
  quiet: 'text-muted-foreground hover:bg-muted hover:text-foreground',
  destructive: 'bg-destructive text-white hover:bg-destructive/90',
} as const;
// Touch targets: on a phone or any coarse pointer every button is at least 40px (icon buttons 44px), whatever its desktop size.
// `bar` and `icon-bar` are the compact viewer-bar sizes: 44px on touch, with the tighter radius of a toolbar.
const sizes = {
  sm: 'h-7 gap-1 px-2.5 text-xs max-sm:h-10 pointer-coarse:h-10',
  md: 'h-9 gap-1.5 px-3.5 text-sm max-sm:h-11 pointer-coarse:h-11',
  icon: 'size-9 max-sm:size-11 pointer-coarse:size-11',
  'icon-sm': 'size-7 max-sm:size-10 pointer-coarse:size-10',
  bar: 'h-8 gap-1.5 rounded-md px-3 text-xs max-sm:h-11 pointer-coarse:h-11',
  'icon-bar': 'size-8 rounded-md max-sm:size-11 pointer-coarse:size-11',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: keyof typeof variants;
  readonly size?: keyof typeof sizes;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** shadcn-style button shared by every item. Always `type="button"` unless a form submit is requested. */
export function Button({ className, variant = 'ghost', size = 'md', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(
    'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors outline-none',
    'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none',
    variants[variant], sizes[size], className)} {...props} />;
}

/** A bar button: an icon with an accessible name and a tooltip (quiet and bar-sized unless told otherwise). */
export function IconButton({ label, children, variant = 'quiet', size = 'icon-bar', ...props }: { readonly label: string; readonly children: ReactNode } & Omit<ButtonProps, 'children'>) {
  return <Button variant={variant} size={size} aria-label={label} title={label} {...props}>{children}</Button>;
}
