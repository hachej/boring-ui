import * as React from 'react'
import { cn } from './lib'
import { Button, type ButtonProps } from './button'

export type ToolbarProps = React.ComponentProps<'div'>

function Toolbar({ className, ...props }: ToolbarProps) {
  return (
    <div
      data-slot="toolbar"
      role="toolbar"
      className={cn('flex items-center gap-1 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden', className)}
      {...props}
    />
  )
}

export type ToolbarGroupProps = React.ComponentProps<'div'>

function ToolbarGroup({ className, ...props }: ToolbarGroupProps) {
  return <div data-slot="toolbar-group" className={cn('flex items-center gap-0.5', className)} {...props} />
}

export type ToolbarButtonProps = ButtonProps

function ToolbarButton({ className, variant = 'ghost', size = 'icon-sm', ...props }: ToolbarButtonProps) {
  return <Button data-slot="toolbar-button" variant={variant} size={size} className={cn('shrink-0', className)} {...props} />
}

export type ToolbarSeparatorProps = React.ComponentProps<'div'>

function ToolbarSeparator({ className, ...props }: ToolbarSeparatorProps) {
  return <div data-slot="toolbar-separator" aria-hidden="true" className={cn('mx-1 h-4 w-px shrink-0 bg-border/60', className)} {...props} />
}

export { Toolbar, ToolbarGroup, ToolbarButton, ToolbarSeparator }
