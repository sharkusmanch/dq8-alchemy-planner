import { defaultSaveUrl } from './config'

export interface EffectiveSaveUrl {
  /** The address to fetch; empty when neither the player nor the build supplies one. */
  url: string
  /** True when `url` is the build's default because the player's own box is empty. */
  builtIn: boolean
}

/** The player's own URL when they entered one, otherwise the build default. */
export function effectiveSaveUrl(playerUrl: string): EffectiveSaveUrl {
  const own = playerUrl.trim()
  if (own !== '') return { url: own, builtIn: false }
  return { url: defaultSaveUrl, builtIn: defaultSaveUrl !== '' }
}
