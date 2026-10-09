/** Byte layout of the raw DQ8 (PS2, SLUS-21207) save: file offset = RAM address - SAVE_BASE. */
export const SAVE_BASE = 0x408e00
export const SAVE_SIZE = 23776
export const RECIPE_COUNT = 184

/** The four bytes every save file starts with. */
export const HEADER = [0x10, 0x00, 0x00, 0x00] as const

const at = (address: number): number => address - SAVE_BASE

export const OFFSET = {
  playTimeFrames: at(0x408e40),
  potLevel: at(0x408f9e),
  medalPrizes: at(0x408fae),
  successfulBrews: at(0x408fe2),
  trialProgress: at(0x408fe6),
  zoomBits: at(0x409090),
  storyProgress: at(0x4092b0),
  gold: at(0x409840),
  characterItems: at(0x409a10),
  bag: at(0x409ad0),
  equipped: at(0x40a250),
  pot: at(0x40e850),
  basicBrews: at(0x40e870),
  improvedBrews: at(0x40e874),
  potStatus: at(0x40e87c),
  recipeStatus: at(0x40e87d),
  daveTrades: at(0x40ea80),
  daveSequence: at(0x40eac0),
} as const

export const CHARACTER_COUNT = 4
export const CHARACTER_SLOTS = 12
export const CHARACTER_STRIDE = 0x30
export const BAG_SLOTS = 396
export const EQUIPPED_CATEGORIES = 5
export const EQUIPPED_STRIDE = 10
/** Byte distance between the pot's result and each ingredient field. */
export const POT_FIELDS = [0, 0x4, 0x8, 0xc] as const
export const ZOOM_BYTES = 5
export const DAVE_TRADE_COUNT = 6

/**
 * Blocks kept raw on the snapshot, as [first offset, offset after the last]. No other parsed field lies in one.
 * In order: field treasure flags (animals), event flags, treasure flags (chests and containers), and the
 * monster records (0x20 bytes a monster, kill count first).
 */
export const PROGRESS_BLOCKS = [
  [at(0x408ed0), at(0x408ef0)],
  [at(0x4094f0), at(0x409600)],
  [at(0x4096f0), at(0x409800)],
  [at(0x40a5a0), at(0x40ca80)],
] as const
