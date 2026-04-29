import type { ToastInput, ToastVariant } from "../../toast"

type ShadcnToastVariant = ToastVariant | "default" | "destructive"
type ShadcnToastInput = Omit<ToastInput, "variant"> & {
  variant?: ShadcnToastVariant
}

function mapToastVariant(variant: ShadcnToastVariant | undefined): ToastVariant {
  if (variant === "destructive") return "error"
  if (variant === "default") return "info"
  return variant ?? "info"
}

async function sendToast(input: string | ShadcnToastInput) {
  const { toast } = await import("../../toast")
  if (typeof input === "string") {
    toast(input)
    return
  }
  toast({
    ...input,
    variant: mapToastVariant(input.variant),
  })
}

export function useToast() {
  return {
    toast(input: string | ShadcnToastInput) {
      void sendToast(input)
    },
  }
}
