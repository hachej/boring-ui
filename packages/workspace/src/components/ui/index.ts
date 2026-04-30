export * from "./alert-dialog"
export * from "./badge"
export * from "./button"
export * from "./card"
export * from "./checkbox"
export * from "./command"
export * from "./dialog"
export * from "./dropdown-menu"
export * from "./input"
export * from "./label"
export * from "./popover"
export * from "./scroll-area"
export * from "./select"
export * from "./separator"
export * from "./sheet"
export * from "./tabs"
export * from "./tooltip"

import { toast } from "../../toast"

interface ToastArgs {
  title?: string
  description?: string
  variant?: "default" | "destructive"
}

export function useToast() {
  return {
    toast(args: ToastArgs) {
      const input = {
        title: args.title,
        description: args.description,
      }
      return args.variant === "destructive"
        ? toast.error(input)
        : toast(input)
    },
  }
}
