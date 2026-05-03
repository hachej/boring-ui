import * as React from 'react'
import { Button, type ButtonProps } from './button'

export type IconButtonProps = Omit<ButtonProps, 'size'> & {
  size?: Extract<ButtonProps['size'], 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'>
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'icon-sm', ...props }, ref) => <Button ref={ref} size={size} {...props} />,
)
IconButton.displayName = 'IconButton'

export { IconButton }
