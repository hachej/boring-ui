import * as React from 'react'
import { cn } from './lib'

export type AvatarProps = React.ComponentProps<'div'>

function Avatar({ className, ...props }: AvatarProps) {
  return (
    <div
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full bg-muted text-foreground', className)}
      {...props}
    />
  )
}

export type AvatarFallbackProps = React.ComponentProps<'span'>

function AvatarFallback({ className, ...props }: AvatarFallbackProps) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn('flex size-full items-center justify-center text-xs font-medium uppercase', className)}
      {...props}
    />
  )
}

export type InitialsAvatarProps = AvatarProps & {
  initials: React.ReactNode
}

function InitialsAvatar({ initials, className, ...props }: InitialsAvatarProps) {
  return (
    <Avatar className={className} {...props}>
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  )
}

export { Avatar, AvatarFallback, InitialsAvatar }
