export type ToastVariant = 'default' | 'destructive' | 'info' | 'success' | 'warning' | 'error'

export type ToastInput = string | {
  title?: string
  description?: string
  variant?: ToastVariant
}

export type ToastApi = {
  toast: (input: ToastInput) => void
}

export function useToast(): ToastApi {
  return {
    toast(input) {
      if (typeof window === 'undefined') return
      if (typeof input === 'string') {
        toast(input)
        return
      }
      const variant = input.variant === 'destructive'
        ? 'error'
        : input.variant === 'default' || input.variant === 'warning'
          ? 'info'
          : input.variant
      toast({ ...input, variant })
    },
  }
}
import { toast } from './toast'
