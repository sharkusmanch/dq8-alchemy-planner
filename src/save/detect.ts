import { isCardImage, listCardSaves, type CardSave } from './card'
import { SAVE_SIZE } from './layout'
import { SaveError } from './types'

export type SaveFile = { kind: 'raw'; bytes: Uint8Array } | { kind: 'card'; saves: CardSave[] }

/**
 * Classify an uploaded or fetched file: a PS2 memory card image (by its magic) or a raw
 * 23,776-byte save.
 * @throws SaveError 'card-format' (damaged card), 'no-saves' (card without a DQ8 save),
 *   or 'size' (neither a card nor a raw save)
 */
export function readSaveFile(bytes: Uint8Array): SaveFile {
  if (isCardImage(bytes)) {
    const saves = listCardSaves(bytes)
    if (saves.length === 0) throw new SaveError('no-saves', 'This memory card has no Dragon Quest VIII save')
    return { kind: 'card', saves }
  }
  if (bytes.length === SAVE_SIZE) return { kind: 'raw', bytes }
  throw new SaveError(
    'size',
    `This is not a Dragon Quest VIII PS2 save or memory card: expected 23,776 bytes or a .ps2 card image, got ${bytes.length}`,
  )
}
