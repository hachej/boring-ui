/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Lemon Squeezy hosted-checkout URL for a credit pack (build-time). */
  readonly VITE_CREDITS_CHECKOUT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
