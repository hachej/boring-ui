declare module '@boring/workspace/ui-shadcn' {
  import type { ComponentPropsWithoutRef } from 'react'

  export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
    size?: 'default' | 'sm' | 'lg' | 'icon'
    asChild?: boolean
  }

  export const Button: import('react').ForwardRefExoticComponent<
    ButtonProps & import('react').RefAttributes<HTMLButtonElement>
  >
}
