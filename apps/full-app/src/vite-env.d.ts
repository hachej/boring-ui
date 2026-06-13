/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' to show the Buy-credits button (server must have LS checkout wired). */
  readonly VITE_CREDITS_BUY_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
