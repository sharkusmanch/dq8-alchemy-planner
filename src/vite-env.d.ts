/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Save URL used when the player has not entered one. Empty or unset in the public build. */
  readonly VITE_DEFAULT_SAVE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
