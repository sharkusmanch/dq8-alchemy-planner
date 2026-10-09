import { SaveError, type SaveSnapshot } from './types'
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

export { RECIPE_COUNT, SAVE_SIZE } from './layout'

/**
 * Decode a raw DQ8 (PS2, SLUS-21207) save dump into a snapshot. Item ids are passed on as they are: whoever
 * maps them to items decides what to do with one it does not know.
 * @throws SaveError for a wrong size, an empty slot, a file that does not start like a save, or a bad pot
 */
export function parseRawSave(bytes: Uint8Array): SaveSnapshot {
  if (bytes.length !== SAVE_SIZE) {
    throw new SaveError(
      'size',
      `This is not a Dragon Quest VIII PS2 save: expected 23,776 bytes, got ${bytes.length}`,
    )
  }
  if (bytes.every((byte) => byte === 0)) throw new SaveError('empty', 'This save slot is empty')
  if (HEADER.some((byte, i) => bytes[i] !== byte)) {
    throw new SaveError('format', 'This is not a Dragon Quest VIII PS2 save')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u8 = (offset: number): number => view.getUint8(offset)
  const u16 = (offset: number): number => view.getUint16(offset, true)
  const u32 = (offset: number): number => view.getUint32(offset, true)

  const potLevel = u8(OFFSET.potLevel)
  const potStatus = u8(OFFSET.potStatus)
  if (potLevel > 3) {
    throw new SaveError('pot', `This save has an invalid alchemy pot level (${potLevel}); it may be corrupt`)
  }
  if (potStatus > 2) {
    throw new SaveError('pot', `This save has an invalid alchemy pot status (${potStatus}); it may be corrupt`)
  }

  const bag: SaveSnapshot['bag'] = []
  for (let slot = 0; slot < BAG_SLOTS; slot++) {
    const id = u16(OFFSET.bag + slot * 4)
    if (id === 0) continue
    bag.push({ gameId: id, qty: u16(OFFSET.bag + slot * 4 + 2) })
  }

  const characters: SaveSnapshot['characters'] = []
  for (let c = 0; c < CHARACTER_COUNT; c++) {
    // Equipped fields hold raw slot numbers, so resolve them before empty slots are dropped.
    const equippedSlots = new Set<number>()
    for (let k = 0; k < EQUIPPED_CATEGORIES; k++) {
      const slot = u16(OFFSET.equipped + EQUIPPED_STRIDE * c + 2 * k)
      if (slot < CHARACTER_SLOTS) equippedSlots.add(slot)
    }
    const items: SaveSnapshot['characters'][number]['items'] = []
    for (let slot = 0; slot < CHARACTER_SLOTS; slot++) {
      const id = u16(OFFSET.characterItems + CHARACTER_STRIDE * c + slot * 4)
      if (id === 0) continue
      items.push({ gameId: id, equipped: equippedSlots.has(slot) })
    }
    characters.push({ items })
  }

  // Pot bytes are stale when the pot is empty, so they are only read otherwise.
  let pot: SaveSnapshot['pot'] = null
  if (potStatus !== 0) {
    const result = u16(OFFSET.pot + POT_FIELDS[0])
    const ingredients: number[] = []
    for (const field of POT_FIELDS.slice(1)) {
      const id = u16(OFFSET.pot + field)
      if (id !== 0) ingredients.push(id)
    }
    pot = { result, ingredients }
  }

  const zoomBits: number[] = []
  for (let k = 0; k < ZOOM_BYTES; k++) {
    const byte = u8(OFFSET.zoomBits + k)
    for (let n = 0; n < 8; n++) if (byte & (1 << n)) zoomBits.push(k * 8 + n)
  }

  const recipeStatus: number[] = []
  for (let n = 0; n < RECIPE_COUNT; n++) recipeStatus.push(u8(OFFSET.recipeStatus + n))

  const daveTrades: number[] = []
  for (let k = 0; k < DAVE_TRADE_COUNT; k++) daveTrades.push(u16(OFFSET.daveTrades + 2 * k))

  const progress: SaveSnapshot['progress'] = {}
  for (const [first, end] of PROGRESS_BLOCKS) {
    for (let offset = first; offset < end; offset++) {
      const byte = u8(offset)
      if (byte !== 0) progress[offset] = byte
    }
  }

  return {
    playTimeFrames: u32(OFFSET.playTimeFrames),
    potLevel: potLevel as SaveSnapshot['potLevel'],
    potStatus: potStatus as SaveSnapshot['potStatus'],
    pot,
    gold: u32(OFFSET.gold),
    bag,
    characters,
    recipeStatus,
    brews: {
      basic: u32(OFFSET.basicBrews),
      improved: u32(OFFSET.improvedBrews),
      successful: u16(OFFSET.successfulBrews),
    },
    zoomBits,
    daveSequence: u8(OFFSET.daveSequence),
    daveTrades,
    medalPrizes: u16(OFFSET.medalPrizes),
    storyProgress: u8(OFFSET.storyProgress),
    trialProgress: u8(OFFSET.trialProgress),
    progress,
  }
}
