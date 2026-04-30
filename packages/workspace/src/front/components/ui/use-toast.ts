import { toast as workspaceToast, type ToastInput, type ToastVariant } from "../../toast"

type ShadcnToastVariant = ToastVariant | "default" | "destructive"
type ShadcnToastInput = Omit<ToastInput, "variant"> & {
  variant?: ShadcnToastVariant
}

function mapToastVariant(variant: ShadcnToastVariant | undefined): ToastVariant {
  if (variant === "destructive") return "error"
  if (variant === "default") return "info"
  return variant ?? "info"
}

function sendToast(input: string | ShadcnToastInput) {
  if (typeof input === "string") {
    workspaceToast(input)
    return
  }
  workspaceToast({
    ...input,
    variant: mapToastVariant(input.variant),
  })
}

export function useToast() {
  return {
    toast(input: string | ShadcnToastInput) {
      sendToast(input)
    },
  }
}
