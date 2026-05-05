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
      window.dispatchEvent(new CustomEvent('boring-ui:toast', { detail: input }))
    },
  }
}
