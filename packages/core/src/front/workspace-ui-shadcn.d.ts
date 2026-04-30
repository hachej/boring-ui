declare module '@boring/workspace/ui-shadcn' {
  import type { ComponentPropsWithoutRef, ForwardRefExoticComponent, RefAttributes } from 'react'
  import type { JSX } from 'react'

  export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
    size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'
    asChild?: boolean
  }

  export const Button: ForwardRefExoticComponent<
    ButtonProps & RefAttributes<HTMLButtonElement>
  >

  export const Card: (props: ComponentPropsWithoutRef<'div'>) => JSX.Element
  export const CardHeader: (props: ComponentPropsWithoutRef<'div'>) => JSX.Element
  export const CardTitle: (props: ComponentPropsWithoutRef<'div'>) => JSX.Element
  export const CardDescription: (props: ComponentPropsWithoutRef<'div'>) => JSX.Element
  export const CardContent: (props: ComponentPropsWithoutRef<'div'>) => JSX.Element
  export const CardFooter: (props: ComponentPropsWithoutRef<'div'>) => JSX.Element

  export const DropdownMenu: (props: any) => JSX.Element
  export const DropdownMenuTrigger: (props: any) => JSX.Element
  export const DropdownMenuContent: (props: any) => JSX.Element
  export const DropdownMenuItem: (props: any) => JSX.Element
  export const DropdownMenuLabel: (props: any) => JSX.Element
  export const DropdownMenuSeparator: (props: any) => JSX.Element
  export const DropdownMenuSub: (props: any) => JSX.Element
  export const DropdownMenuSubTrigger: (props: any) => JSX.Element
  export const DropdownMenuSubContent: (props: any) => JSX.Element

  export const AlertDialog: (props: any) => JSX.Element
  export const AlertDialogCancel: (props: any) => JSX.Element
  export const AlertDialogContent: (props: any) => JSX.Element
  export const AlertDialogDescription: (props: any) => JSX.Element
  export const AlertDialogFooter: (props: any) => JSX.Element
  export const AlertDialogHeader: (props: any) => JSX.Element
  export const AlertDialogTitle: (props: any) => JSX.Element
  export const AlertDialogTrigger: (props: any) => JSX.Element

  export const Dialog: (props: any) => JSX.Element
  export const DialogContent: (props: any) => JSX.Element
  export const DialogHeader: (props: any) => JSX.Element
  export const DialogTitle: (props: any) => JSX.Element
  export const DialogDescription: (props: any) => JSX.Element
  export const DialogFooter: (props: any) => JSX.Element

  export const Separator: (props: any) => JSX.Element

  export const Input: ForwardRefExoticComponent<
    ComponentPropsWithoutRef<'input'> & RefAttributes<HTMLInputElement>
  >
  export const Label: ForwardRefExoticComponent<
    ComponentPropsWithoutRef<'label'> & RefAttributes<HTMLLabelElement>
  >

  export function useToast(): {
    toast: (args: {
      title?: string
      description?: string
      variant?: 'default' | 'destructive'
    }) => void
  }
}
