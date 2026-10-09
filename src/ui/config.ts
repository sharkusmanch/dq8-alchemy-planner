/**
 * Build-time default for the save URL. A self-hosted copy is built with VITE_DEFAULT_SAVE_URL=./save and serves the
 * newest save at that path on its own origin; the public build leaves it empty.
 */
export const defaultSaveUrl: string = (import.meta.env.VITE_DEFAULT_SAVE_URL ?? '').trim()
