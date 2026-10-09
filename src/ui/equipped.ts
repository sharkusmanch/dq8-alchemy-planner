import type { ItemId } from '../data/types'
import type { AppState } from '../state/types'

/** Shown where the app would otherwise send the player to find an item that a character is wearing. */
export const EQUIPPED_NOTE = 'Equipped on a character — unequip it to use it'

/** Units of the item that characters have equipped. They are not stock: the pot cannot take them. */
export const equippedCount = (state: AppState, item: ItemId): number => state.equipped[item] ?? 0
