import type { SaveSnapshot } from './types'
import {
  BAG_SLOTS,
  CHARACTER_COUNT,
  CHARACTER_SLOTS,
  CHARACTER_STRIDE,
  DAVE_TRADE_COUNT,
  EQUIPPED_CATEGORIES,
  EQUIPPED_STRIDE,
  HEADER,
  OFFSET,
  POT_FIELDS,
  PROGRESS_BLOCKS,
  RECIPE_COUNT,
  SAVE_SIZE,
  ZOOM_BYTES,
} from './layout'

/** The snapshot buildSave starts from before applying overrides. */
export function emptySnapshot(): SaveSnapshot {
  return {
    playTimeFrames: 3600,
    potLevel: 0,
    potStatus: 0,
    pot: null,
    gold: 0,
    bag: [],
    characters: Array.from({ length: CHARACTER_COUNT }, () => ({ items: [] })),
    recipeStatus: new Array<number>(RECIPE_COUNT).fill(0),
    brews: { basic: 0, improved: 0, successful: 0 },
    zoomBits: [],
    daveSequence: 0,
    daveTrades: new Array<number>(DAVE_TRADE_COUNT).fill(0),
    medalPrizes: 0,
    storyProgress: 0,
    trialProgress: 0,
    progress: {},
  }
}

/**
 * Test helper: serialise a snapshot into a 23,776-byte raw save.
 * Items are written to raw slots 0..n-1 in order; equipped items fill the weapon, armour,
 * shield, headgear, accessory fields in order (at most five per character).
 * A pot given without an explicit potStatus is written as brewing (status 1).
 * `progress` bytes are written at their file offsets, which must lie inside the progress blocks.
 */
export function buildSave(fields: Partial<SaveSnapshot> = {}): Uint8Array {
  const snap: SaveSnapshot = { ...emptySnapshot(), ...fields }
  if (fields.pot && fields.potStatus === undefined) snap.potStatus = 1

  const bytes = new Uint8Array(SAVE_SIZE)
  const view = new DataView(bytes.buffer)

  bytes.set(HEADER)
  view.setUint32(OFFSET.playTimeFrames, snap.playTimeFrames, true)
  bytes[OFFSET.potLevel] = snap.potLevel
  view.setUint16(OFFSET.medalPrizes, snap.medalPrizes, true)
  view.setUint16(OFFSET.successfulBrews, snap.brews.successful, true)
  bytes[OFFSET.trialProgress] = snap.trialProgress
  bytes[OFFSET.storyProgress] = snap.storyProgress
  for (const [key, byte] of Object.entries(snap.progress)) {
    const offset = Number(key)
    if (!PROGRESS_BLOCKS.some(([first, end]) => offset >= first && offset < end)) {
      throw new Error(`offset ${offset} is outside the progress blocks`)
    }
    bytes[offset] = byte
  }
  for (const bit of snap.zoomBits) {
    const byte = bit >> 3
    if (byte >= ZOOM_BYTES) throw new Error(`zoom bit ${bit} is out of range`)
    bytes[OFFSET.zoomBits + byte] = (bytes[OFFSET.zoomBits + byte] ?? 0) | (1 << (bit & 7))
  }
  view.setUint32(OFFSET.gold, snap.gold, true)

  if (snap.bag.length > BAG_SLOTS) throw new Error('too many bag stacks')
  snap.bag.forEach((stack, i) => {
    view.setUint16(OFFSET.bag + i * 4, stack.gameId, true)
    view.setUint16(OFFSET.bag + i * 4 + 2, stack.qty, true)
  })

  for (let c = 0; c < CHARACTER_COUNT; c++) {
    const items = snap.characters[c]?.items ?? []
    if (items.length > CHARACTER_SLOTS) throw new Error('too many character items')
    const equippedBase = OFFSET.equipped + EQUIPPED_STRIDE * c
    for (let k = 0; k < EQUIPPED_CATEGORIES; k++) view.setUint16(equippedBase + 2 * k, 0xffff, true)
    let nextCategory = 0
    items.forEach((item, slot) => {
      view.setUint16(OFFSET.characterItems + CHARACTER_STRIDE * c + 4 * slot, item.gameId, true)
      if (!item.equipped) return
      if (nextCategory >= EQUIPPED_CATEGORIES) throw new Error('more than five equipped items')
      view.setUint16(equippedBase + 2 * nextCategory++, slot, true)
    })
  }

  if (snap.pot) {
    view.setUint16(OFFSET.pot + POT_FIELDS[0], snap.pot.result, true)
    snap.pot.ingredients.slice(0, 3).forEach((id, i) => {
      view.setUint16(OFFSET.pot + POT_FIELDS[i + 1]!, id, true)
    })
  }
  view.setUint32(OFFSET.basicBrews, snap.brews.basic, true)
  view.setUint32(OFFSET.improvedBrews, snap.brews.improved, true)
  bytes[OFFSET.potStatus] = snap.potStatus
  snap.recipeStatus.forEach((status, n) => {
    if (n < RECIPE_COUNT) bytes[OFFSET.recipeStatus + n] = status
  })
  snap.daveTrades.forEach((count, k) => {
    if (k < DAVE_TRADE_COUNT) view.setUint16(OFFSET.daveTrades + 2 * k, count, true)
  })
  bytes[OFFSET.daveSequence] = snap.daveSequence
  return bytes
}
