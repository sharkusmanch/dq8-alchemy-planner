import { describe, expect, it } from 'vitest'
import { parseRawSave } from './parse'
import { buildSave, emptySnapshot } from './testing'
import { HEADER, OFFSET, RECIPE_COUNT, SAVE_SIZE } from './layout'
import { SaveError, type SaveErrorCode, type SaveSnapshot } from './types'

function codeOf(fn: () => unknown): SaveErrorCode {
  try {
    fn()
  } catch (e) {
    if (e instanceof SaveError) return e.code
    throw e
  }
  throw new Error('expected a SaveError')
}

function fullSnapshot(): SaveSnapshot {
  const recipeStatus = new Array<number>(RECIPE_COUNT).fill(0)
  recipeStatus[0] = 3
  recipeStatus[62] = 2
  recipeStatus[183] = 1
  return {
    playTimeFrames: 1234567,
    potLevel: 2,
    potStatus: 1,
    pot: { result: 264, ingredients: [12, 99] },
    gold: 71234,
    bag: [
      { gameId: 5, qty: 3 },
      { gameId: 386, qty: 99 },
      { gameId: 100, qty: 1 },
    ],
    characters: [
      {
        items: [
          { gameId: 65, equipped: true },
          { gameId: 7, equipped: false },
          { gameId: 7, equipped: true },
        ],
      },
      { items: [{ gameId: 3, equipped: false }] },
      { items: [] },
      {
        items: [
          { gameId: 1, equipped: true },
          { gameId: 2, equipped: true },
          { gameId: 4, equipped: true },
          { gameId: 8, equipped: true },
          { gameId: 9, equipped: true },
          { gameId: 10, equipped: false },
        ],
      },
    ],
    recipeStatus,
    brews: { basic: 23, improved: 4, successful: 22 },
    zoomBits: [0, 1, 7, 8, 33],
    daveSequence: 3,
    daveTrades: [1, 2, 0, 1, 0, 0],
    medalPrizes: 7,
    storyProgress: 0x0b,
    trialProgress: 2,
    // a field flag, an event flag, two treasure flags and a monster's 16-bit kill count
    progress: { 0xd9: 0x20, 0x70e: 0x02, 0x99e: 0x80, 0x9c5: 0x0a, 0x3820: 0x2c, 0x3821: 0x01 },
  }
}

describe('parseRawSave', () => {
  it('round-trips a full snapshot', () => {
    const snap = fullSnapshot()
    expect(parseRawSave(buildSave(snap))).toEqual(snap)
  })

  it('builds 23,776 bytes with a default play time of 3600 frames', () => {
    const bytes = buildSave()
    expect(bytes.length).toBe(SAVE_SIZE)
    expect(parseRawSave(bytes)).toEqual(emptySnapshot())
    expect(parseRawSave(bytes).playTimeFrames).toBe(3600)
  })

  it('resolves equipped flags against raw slot numbers before dropping empty slots', () => {
    const bytes = new Uint8Array(SAVE_SIZE)
    bytes.set(HEADER)
    const view = new DataView(bytes.buffer)
    view.setUint32(OFFSET.playTimeFrames, 100, true)
    // Yangus (character 1): items in raw slots 0, 1 and 5; weapon = raw slot 5.
    const itemBase = OFFSET.characterItems + 0x30
    view.setUint16(itemBase + 0 * 4, 11, true)
    view.setUint16(itemBase + 1 * 4, 12, true)
    view.setUint16(itemBase + 5 * 4, 13, true)
    const equippedBase = OFFSET.equipped + 10
    view.setUint16(equippedBase, 5, true)
    for (let k = 1; k < 5; k++) view.setUint16(equippedBase + 2 * k, 0xffff, true)
    // Everyone else: nothing equipped.
    for (const c of [0, 2, 3]) {
      for (let k = 0; k < 5; k++) view.setUint16(OFFSET.equipped + 10 * c + 2 * k, 0xffff, true)
    }
    const snap = parseRawSave(bytes)
    expect(snap.characters[1]!.items).toEqual([
      { gameId: 11, equipped: false },
      { gameId: 12, equipped: false },
      { gameId: 13, equipped: true },
    ])
  })

  it('reports a wrong size first', () => {
    expect(codeOf(() => parseRawSave(new Uint8Array(0)))).toBe('size')
    expect(codeOf(() => parseRawSave(new Uint8Array(10)))).toBe('size')
    expect(() => parseRawSave(new Uint8Array(10))).toThrow(
      /^This is not a Dragon Quest VIII PS2 save: expected 23,776 bytes, got 10$/,
    )
  })

  it('reports an empty slot only for a file of zero bytes', () => {
    expect(codeOf(() => parseRawSave(new Uint8Array(SAVE_SIZE)))).toBe('empty')
    expect(() => parseRawSave(new Uint8Array(SAVE_SIZE))).toThrow(/^This save slot is empty$/)
  })

  it('accepts a save made in the first seconds, with a play time of 0', () => {
    const snap = parseRawSave(buildSave({ playTimeFrames: 0, gold: 50 }))
    expect(snap.playTimeFrames).toBe(0)
    expect(snap.gold).toBe(50)
  })

  it('rejects a file that does not start like a save, after the size and empty checks', () => {
    expect(codeOf(() => parseRawSave(new Uint8Array(SAVE_SIZE).fill(0xff)))).toBe('format')
    const noHeader = buildSave({ gold: 5 })
    noHeader.fill(0, 0, HEADER.length)
    expect(codeOf(() => parseRawSave(noHeader))).toBe('format')
    expect(() => parseRawSave(noHeader)).toThrow(/^This is not a Dragon Quest VIII PS2 save$/)
    const wrongHeader = buildSave()
    wrongHeader[0] = 0x11
    expect(codeOf(() => parseRawSave(wrongHeader))).toBe('format')
  })

  it('rejects a pot level above 3', () => {
    const bytes = buildSave()
    bytes[OFFSET.potLevel] = 4
    expect(codeOf(() => parseRawSave(bytes))).toBe('pot')
  })

  it('rejects a pot status above 2', () => {
    const bytes = buildSave()
    bytes[OFFSET.potStatus] = 3
    expect(codeOf(() => parseRawSave(bytes))).toBe('pot')
  })

  it('keeps item ids it does not know, in the bag, in character slots and in the pot', () => {
    // A cheat-device save can hold ids above the item table; whoever maps ids to items skips them.
    expect(parseRawSave(buildSave({ bag: [{ gameId: 387, qty: 1 }, { gameId: 9999, qty: 2 }] })).bag)
      .toEqual([{ gameId: 387, qty: 1 }, { gameId: 9999, qty: 2 }])
    const character = buildSave({ characters: [{ items: [{ gameId: 388, equipped: false }] }] })
    expect(parseRawSave(character).characters[0]!.items).toEqual([{ gameId: 388, equipped: false }])
    const pot = buildSave({ pot: { result: 9999, ingredients: [1, 2] } })
    expect(parseRawSave(pot).pot).toEqual({ result: 9999, ingredients: [1, 2] })
  })

  it('reads the medal prize count, the story chapter and the trials beaten', () => {
    const bytes = buildSave()
    const view = new DataView(bytes.buffer)
    view.setUint16(OFFSET.medalPrizes, 11, true)
    bytes[OFFSET.storyProgress] = 0x11
    bytes[OFFSET.trialProgress] = 6
    expect(parseRawSave(bytes)).toMatchObject({ medalPrizes: 11, storyProgress: 0x11, trialProgress: 6 })
  })

  it('keeps the non-zero bytes of the progress blocks by file offset, and nothing outside them', () => {
    const bytes = buildSave({ gold: 0x01020304 })
    bytes[0x99e] = 0x80 // a treasure flag
    bytes[0x74d] = 0x10 // an event flag
    bytes[0x3b20] = 1 // a monster record
    bytes[0x800] = 0xff // between the blocks
    const snap = parseRawSave(bytes)
    expect(snap.progress).toEqual({ 0x74d: 0x10, 0x99e: 0x80, 0x3b20: 1 })
    expect(snap.gold).toBe(0x01020304)
  })

  it('cannot build a save with a progress byte outside the progress blocks', () => {
    expect(() => buildSave({ progress: { [OFFSET.gold]: 1 } })).toThrow(/outside the progress blocks/)
  })

  it('parses a two-ingredient pot and a three-ingredient pot', () => {
    const two = parseRawSave(buildSave({ pot: { result: 5, ingredients: [1, 2] } }))
    expect(two.pot?.ingredients).toHaveLength(2)
    const three = parseRawSave(buildSave({ pot: { result: 5, ingredients: [1, 2, 3] } }))
    expect(three.pot?.ingredients).toEqual([1, 2, 3])
  })

  it('gives pot: null when the pot status is 0, even with stale pot bytes', () => {
    const bytes = buildSave({ pot: { result: 5, ingredients: [1, 2] }, potStatus: 0 })
    expect(parseRawSave(bytes).pot).toBeNull()
  })
})
