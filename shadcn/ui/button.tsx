import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-xs max-md:min-h-[var(--control-min,2.75rem)] max-md:min-w-[var(--control-min,2.75rem)] pointer-coarse:min-h-[var(--control-min,2.75rem)] pointer-coarse:min-w-[var(--control-min,2.75rem)] font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-input bg-card text-foreground hover:bg-accent aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive-soft text-foreground hover:bg-destructive-soft/80 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[var(--control-h,2.25rem)] gap-1.5 px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-5 gap-1 rounded-[min(var(--radius-md),8px)] px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // A link-style label inside a table row or a sentence (D-1767): text height, no padding, no border; icon-free. The touch floor of the base is cancelled
        // for the layout and kept as a hit area only (an ::after), so a row does not grow. The area reaches the box plus half of the room the layout leaves, up to the 44px
        // floor, so two buttons never share a pixel: next to another inline Button (a row that wraps) the room is the row's --inline-gap-x / --inline-gap-y, none when
        // the row declares nothing; with no inline sibling it is unlimited (the full floor). Rendered with the link variant. In a kit TableCell it is underlined on hover and focus-visible only (D-1814).
        inline:
          "relative h-auto min-h-0 min-w-0 underline in-data-[slot=table-cell]:no-underline in-data-[slot=table-cell]:hover:underline in-data-[slot=table-cell]:focus-visible:underline decoration-current decoration-1 underline-offset-2 max-md:min-h-0 max-md:min-w-0 pointer-coarse:min-h-0 pointer-coarse:min-w-0 gap-0 rounded-sm border-0 p-0 align-baseline text-[length:inherit] leading-[inherit] whitespace-normal text-left [--inline-room:100vmax] [[data-size=inline]~&]:[--inline-room:0px] has-[~[data-size=inline]]:[--inline-room:0px] [--inline-reach-x:clamp(0px,calc((var(--control-min,2.75rem)_-_100%)/2),calc(var(--inline-gap-x,var(--inline-room))/2))] [--inline-reach-y:clamp(0px,calc((var(--control-min,2.75rem)_-_100%)/2),calc(var(--inline-gap-y,var(--inline-room))/2))] max-md:after:absolute pointer-coarse:after:absolute [&::after]:inset-x-[calc(-1*var(--inline-reach-x))] [&::after]:inset-y-[calc(-1*var(--inline-reach-y))]",
        icon: "size-[var(--control-h,2.25rem)]",
        "icon-xs":
          "size-5 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type LinkProps = { href?: unknown; to?: unknown; role?: string }
type SpaceKey = React.KeyboardEvent<HTMLElement> & { preventBaseUIHandler?: () => void }

/** A link is a Button whose `render` element has an `href` or `to` (an `<a>` or a router link), or an explicit `role="link"` (a router link with another prop name), unless `nativeButton` is explicitly true. */
function renderedLink({ nativeButton, render, role: given }: ButtonPrimitive.Props) {
  if (nativeButton === true || !React.isValidElement<LinkProps>(render)) return undefined
  const { href, to, role } = render.props
  return href != null || to != null || given === "link" || role === "link" ? { role } : undefined
}

function Button({
  className,
  variant,
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const link = renderedLink(props)
  const role = props.role ?? link?.role ?? "link"
  // Base UI gives a non-native control role=button and Space activation. A link announces as a link and, like a native one, ignores Space.
  const space = (handler: unknown) => (event: SpaceKey) => {
    ;(handler as ((event: SpaceKey) => void) | undefined)?.(event)
    if (event.key === " ") event.preventBaseUIHandler?.()
  }
  const linkProps = !link
    ? {}
    : {
        ...(props.nativeButton === undefined ? { nativeButton: false } : {}),
        ...(props.role === undefined && link.role === undefined ? { role } : {}),
        ...(role === "link" ? { onKeyDown: space(props.onKeyDown), onKeyUp: space(props.onKeyUp) } : {}),
      }
  return (
    <ButtonPrimitive
      data-slot="button"
      data-size={size}
      className={cn(buttonVariants({ variant: variant === undefined ? (size === "inline" ? "link" : "default") : variant, size, className }))}
      {...props}
      {...linkProps}
    />
  )
}

export { Button, buttonVariants }
