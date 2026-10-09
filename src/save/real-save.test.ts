import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRawSave } from './parse'

const PATH = 'sources/real_save_slot6.bin'
/** Game id of Giant Mallet in the RA code note table at 0x409a10. */
const GIANT_MALLET = 0x41

describe.skipIf(!existsSync(PATH))('real save (slot 6)', () => {
  const snap = () => parseRawSave(new Uint8Array(readFileSync(PATH)))

  it('decodes the known state of the slot', () => {
    const s = snap()
    expect(s.bag).toHaveLength(43)
    expect(s.gold).toBe(3671)
    expect(s.potLevel).toBe(1)
    expect(s.potStatus).toBe(1)
    expect(s.pot?.result).toBe(0x108)
    expect(s.brews.basic).toBe(23)
    expect(s.brews.successful).toBe(22)
    expect(s.zoomBits).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(s.daveTrades).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('is at the third story chapter with no trial beaten and no medal prize collected', () => {
    expect(snap()).toMatchObject({ storyProgress: 0x03, trialProgress: 0, medalPrizes: 0 })
  })

  it('has defeated Geyzer once and has not opened the Herb Grotto chest', () => {
    const { progress } = snap()
    expect(progress[0x3820]).toBe(1) // Geyzer's kill count
    expect(progress[0x99e]).toBeUndefined() // Herb Grotto treasure flags
  })

  it('has 11 recipe status bytes with bit 0 set, for the expected recipes', () => {
    const completed = snap()
      .recipeStatus.map((status, recipe) => ((status & 1) !== 0 ? recipe : -1))
      .filter((recipe) => recipe >= 0)
    expect(completed).toEqual([0, 1, 6, 9, 11, 15, 62, 71, 93, 141, 170])
  })

  it('has 22 character items, 11 equipped, and Yangus wields the Giant Mallet', () => {
    const s = snap()
    const items = s.characters.flatMap((c) => c.items)
    expect(items).toHaveLength(22)
    expect(items.filter((i) => i.equipped)).toHaveLength(11)
    expect(s.characters[1]!.items.filter((i) => i.equipped).map((i) => i.gameId)).toContain(GIANT_MALLET)
  })
})
