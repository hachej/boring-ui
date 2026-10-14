// The few kit components a preview may import (`@/components/ui/button|card|badge`), small look-alikes of the shadcn ones, styled by the app's
// tokens. The frame cannot import the app's own components: it has none.
import type { ComponentProps } from 'react';

const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

export function Button({ className, variant, ...rest }: ComponentProps<'button'> & { variant?: 'default' | 'outline' | 'ghost' }) {
  const look = variant === 'outline' ? 'border border-border bg-background hover:bg-muted' : variant === 'ghost' ? 'hover:bg-muted' : 'bg-primary text-primary-foreground hover:opacity-90';
  return <button type="button" className={join('inline-flex min-h-9 items-center justify-center gap-1 rounded-md px-3 py-1 text-sm font-medium', look, className)} {...rest} />;
}
export const Card = ({ className, ...rest }: ComponentProps<'div'>) => <div className={join('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)} {...rest} />;
export const CardHeader = ({ className, ...rest }: ComponentProps<'div'>) => <div className={join('flex flex-col gap-1 p-4', className)} {...rest} />;
export const CardTitle = ({ className, ...rest }: ComponentProps<'div'>) => <div className={join('font-semibold leading-none', className)} {...rest} />;
export const CardDescription = ({ className, ...rest }: ComponentProps<'div'>) => <div className={join('text-sm text-muted-foreground', className)} {...rest} />;
export const CardContent = ({ className, ...rest }: ComponentProps<'div'>) => <div className={join('p-4 pt-0', className)} {...rest} />;
export const CardFooter = ({ className, ...rest }: ComponentProps<'div'>) => <div className={join('flex items-center p-4 pt-0', className)} {...rest} />;
export const Badge = ({ className, ...rest }: ComponentProps<'span'>) => <span className={join('inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground', className)} {...rest} />;
