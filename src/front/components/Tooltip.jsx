import { Children, isValidElement, useMemo } from 'react'
import {
  Tooltip as PrimitiveTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip'

export default function Tooltip({
  label,
  shortcut = '',
  side = 'top',
  children,
  disabled = false,
}) {
  const content = useMemo(() => {
    const text = String(label || '').trim()
    if (!text) return ''
    const shortcutText = String(shortcut || '').trim()
    return shortcutText ? `${text} (${shortcutText})` : text
  }, [label, shortcut])

  const child = Children.only(children)
  if (disabled || !content) return child

  const triggerChild = isValidElement(child) ? child : <span>{child}</span>

  return (
    <TooltipProvider delayDuration={400}>
      <PrimitiveTooltip>
        <TooltipTrigger asChild>
          <span className="ui-tooltip-anchor">{triggerChild}</span>
        </TooltipTrigger>
        <TooltipContent className="ui-tooltip" side={side} sideOffset={8}>
          <span className="ui-tooltip-label">{label}</span>
          {shortcut ? <kbd className="ui-tooltip-shortcut">{shortcut}</kbd> : null}
        </TooltipContent>
      </PrimitiveTooltip>
    </TooltipProvider>
  )
}
