import { describe, expect, it } from 'vitest'
import { createIndex } from '../data/create-index'
import { parseRawSave } from '../save/parse'
import { buildSave } from '../save/testing'
import type { SaveSnapshot } from '../save/types'
import type { AppState } from './types'
import { scarcity } from '../planner/need'
import { miniData, miniState } from '../testing/mini'
import { reduce } from './reducer'
import { snapshotToPatch } from './snapshot'

const index = createIndex(miniData)
const patchOf = (fields: Partial<SaveSnapshot>, on = index) =>
  snapshotToPatch(parseRawSave(buildSave(fields)), on)

// Dodgy Dave with six requests, as in the game.
const sixRequests = createIndex({
  ...miniData,
  goals: { ...miniData.goals, dave: ['y', 'x', 'z', 'w', 't', 'u'].map((item) => ({ item, reward: 'r' })) },
})

// One scarce item whose sources show in a save in each of the three ways, and one that never does.
const flagged = createIndex({
  ...miniData,
  goals: {
    ...miniData.goals,
    scarce: [{ item: 's', sources: [
      { id: 's-1', label: 'Chest', location: 'town', flag: { offset: 0x99e, bit: 7 } },
      { id: 's-2', label: 'Barrel', location: 'town', flag: { offset: 0x9c5, bit: 3 } },
      { id: 's-3', label: 'Other barrel', location: 'town', flag: { offset: 0x9c5, bit: 1 } },
      { id: 's-4', label: 'Fourth prize', location: 'town', medalPrize: 4 },
      { id: 's-5', label: 'Sixth prize', location: 'town', medalPrize: 6 },
      { id: 's-6', label: 'Boss', location: 'town', killCount: { offset: 0x3820 } },
      { id: 's-7', label: 'By hand only', location: 'town' },
    ] }],
  },
})

// Stages three to five have no Zoom destination: the story and trial bytes are all that can prove them.
const storied = createIndex({
  ...miniData,
  stages: [
    { id: 's1', label: 'One' }, { id: 's2', label: 'Two' }, { id: 's3', label: 'Three', storyMin: 0x0b },
    { id: 's4', label: 'Four', storyMin: 0x11 }, { id: 's5', label: 'Five', trialMin: 1 },
  ],
})

// game ids: a1 b2 c3 d4 q5 s6 x7 y8 z9 w10 p11 t12 u13 v14
describe('snapshotToPatch', () => {
  it('splits equipped from unequipped character items and adds the bag', () => {
    const p = patchOf({
      bag: [{ gameId: 1, qty: 3 }, { gameId: 2, qty: 1 }],
      characters: [
        { items: [{ gameId: 1, equipped: false }, { gameId: 3, equipped: true }] },
        { items: [{ gameId: 3, equipped: true }, { gameId: 2, equipped: false }, { gameId: 2, equipped: false }] },
        { items: [] }, { items: [] },
      ],
      gold: 1234,
      potLevel: 2,
    })
    expect(p.inventory).toEqual({ a: 4, b: 3 })
    expect(p.equipped).toEqual({ c: 2 })
    expect(p.gold).toBe(1234)
    expect(p.potLevel).toBe(2)
  })

  it('maps completed recipes from status bit 0 only', () => {
    const status = new Array<number>(184).fill(0)
    status[0] = 3
    status[2] = 2 // learned, not completed
    status[5] = 1
    expect(patchOf({ recipeStatus: status }).completed).toEqual([0, 5])
  })

  it('maps the pot and finds the matching recipe', () => {
    const p = patchOf({ pot: { result: 7, ingredients: [2, 1] }, potLevel: 1 })
    expect(p.pot).toEqual({ recipe: 0, result: 'x', ingredients: ['b', 'a'] })
  })

  it('picks the lowest matching recipe and handles repeated ingredients', () => {
    expect(patchOf({ pot: { result: 7, ingredients: [1, 1] } }).pot?.recipe).toBe(6)
    expect(patchOf({ pot: { result: 10, ingredients: [2, 1, 2] } }).pot?.recipe).toBe(3)
  })

  it('leaves pot.recipe null when no recipe matches, and the pot null when empty', () => {
    expect(patchOf({ pot: { result: 7, ingredients: [3, 4] } }).pot).toEqual({ recipe: null, result: 'x', ingredients: ['c', 'd'] })
    expect(patchOf({}).pot).toBeNull()
  })

  it('marks each Dodgy Dave request handed in at least once, in whatever order', () => {
    // Dave moves on past a request that was never handed in, so the done ones need not come first.
    expect(patchOf({ daveTrades: [0, 0, 1, 0, 1, 1], daveSequence: 5 }, sixRequests).dave)
      .toEqual({ done: [false, false, true, false, true, true], next: 5 })
    expect(patchOf({ daveTrades: [1, 0, 1, 1, 1, 0], daveSequence: 5 }, sixRequests).dave)
      .toEqual({ done: [true, false, true, true, true, false], next: 5 })
    expect(patchOf({ daveTrades: [2, 1, 0, 0, 0, 0], daveSequence: 2 }, sixRequests).dave)
      .toEqual({ done: [true, true, false, false, false, false], next: 2 })
    expect(patchOf({}, sixRequests).dave).toEqual({ done: [false, false, false, false, false, false], next: 0 })
  })

  it('has one flag per request in the data, and starts over for a sequence value past the last', () => {
    expect(patchOf({ daveTrades: [1, 1, 1, 0, 0, 0], daveSequence: 3 }).dave).toEqual({ done: [true], next: 0 })
  })

  it('maps brew counters', () => {
    expect(patchOf({ brews: { basic: 12, improved: 4, successful: 9 } }).brews).toEqual({ basic: 12, improved: 4 })
  })

  it('takes the stage from the latest unlocked location', () => {
    expect(patchOf({ zoomBits: [0, 1] }).stage).toBe('s2')
    expect(patchOf({ zoomBits: [1] }).stage).toBe('s2')
    expect(patchOf({ zoomBits: [0] }).stage).toBe('s1')
    expect(patchOf({ zoomBits: [] }).stage).toBe('s1')
    expect(patchOf({ zoomBits: [20] }).stage).toBe('s1')
  })

  it('takes the later of the zoomed stage and the stage at which the save\'s pot arrives', () => {
    // Several stages have no Zoom destination, so the pot can prove a later stage than Zoom does.
    expect(patchOf({ zoomBits: [0], potLevel: 2 }).stage).toBe('s2')
    expect(patchOf({ zoomBits: [], potLevel: 3 }).stage).toBe('s2')
    expect(patchOf({ zoomBits: [0, 1], potLevel: 1 }).stage).toBe('s2')
    expect(patchOf({ zoomBits: [0], potLevel: 1 }).stage).toBe('s1')
    expect(patchOf({ zoomBits: [1], potLevel: 0 }).stage).toBe('s2')
  })

  it('ignores a pot stage that the data leaves empty', () => {
    const noPotStages = createIndex({
      ...miniData, goals: { ...miniData.goals, potStages: { basic: '', improved: '', instant: '' } },
    })
    const snap = parseRawSave(buildSave({ zoomBits: [0], potLevel: 2 }))
    expect(snapshotToPatch(snap, noPotStages).stage).toBe('s1')
  })

  it('skips unknown game ids and counts the slots that held them', () => {
    const sparse = createIndex({ ...miniData, items: miniData.items.filter((i) => i.id !== 'b') })
    const patch = patchOf({ bag: [{ gameId: 1, qty: 1 }, { gameId: 2, qty: 5 }] }, sparse)
    expect(patch.inventory).toEqual({ a: 1 })
    expect(patch.unknownItems).toBe(1)
    expect(patchOf({ bag: [{ gameId: 1, qty: 1 }] }).unknownItems).toBe(0)
  })

  it('counts unknown ids in the bag, on characters and in the pot', () => {
    const patch = patchOf({
      bag: [{ gameId: 387, qty: 9 }, { gameId: 388, qty: 1 }, { gameId: 1, qty: 2 }],
      characters: [{ items: [{ gameId: 400, equipped: true }, { gameId: 2, equipped: false }] }],
      pot: { result: 7, ingredients: [1, 999] },
    })
    expect(patch.unknownItems).toBe(4)
    expect(patch.inventory).toEqual({ a: 2, b: 1 })
    expect(patch.equipped).toEqual({})
    expect(patch.pot).toEqual({ recipe: null, result: 'x', ingredients: ['a'] })
  })
})

describe('snapshotToPatch: scarce sources the save shows as taken', () => {
  it('ticks exactly the sources whose flag is set or whose medal prize has been given', () => {
    const patch = patchOf({ progress: { 0x99e: 0x80, 0x9c5: 0x02 }, medalPrizes: 4 }, flagged)
    expect(patch.collected).toEqual(['s-1', 's-3', 's-4'])
  })

  it('reads one bit: the other bits of the byte belong to other chests', () => {
    expect(patchOf({ progress: { 0x99e: 0x7f, 0x9c5: 0xf5 } }, flagged).collected).toEqual([])
    expect(patchOf({ progress: { 0x9c5: 0x08 } }, flagged).collected).toEqual(['s-2'])
  })

  it('ticks a medal prize once that many prizes have been given', () => {
    expect(patchOf({ medalPrizes: 3 }, flagged).collected).toEqual([])
    expect(patchOf({ medalPrizes: 6 }, flagged).collected).toEqual(['s-4', 's-5'])
    expect(patchOf({ medalPrizes: 11 }, flagged).collected).toEqual(['s-4', 's-5'])
  })

  it('ticks a boss source once the boss has been killed', () => {
    expect(patchOf({ progress: { 0x3820: 1 } }, flagged).collected).toEqual(['s-6'])
    expect(patchOf({ progress: { 0x3821: 1 } }, flagged).collected).toEqual(['s-6']) // a 16-bit count of 256
    expect(patchOf({ progress: { 0x3822: 1 } }, flagged).collected).toEqual([])
  })

  it('ticks nothing for a fresh save, and never a source the data gives no sign for', () => {
    expect(patchOf({}, flagged).collected).toEqual([])
    expect(patchOf({}).collected).toEqual([])
    const everything = patchOf({ progress: { 0x99e: 0xff, 0x9c5: 0xff, 0x3820: 9 }, medalPrizes: 11 }, flagged)
    expect(everything.collected).toEqual(['s-1', 's-2', 's-3', 's-4', 's-5', 's-6'])
  })

  it('leaves the planner counting only the sources still out there after the import', () => {
    const snap = parseRawSave(buildSave({ progress: { 0x99e: 0x80, 0x9c5: 0x02 }, medalPrizes: 4 }))
    const before = miniState()
    expect(scarcity(flagged, before)[0]).toMatchObject({ uncollected: 7, atRisk: false })
    const { state } = reduce(before, {
      type: 'applySnapshot', patch: snapshotToPatch(snap, flagged), source: 'upload', hash: 'h', playTimeFrames: 1, at: 't',
    }, flagged)
    expect(state.collected).toEqual(['s-1', 's-3', 's-4'])
    expect(scarcity(flagged, state)[0]).toMatchObject({ item: 's', needed: 2, uncollected: 4, atRisk: false })
  })

  it('ends with the ticks of the save imported last, when a later save was imported by mistake first', () => {
    const importing = (state: AppState, fields: Partial<SaveSnapshot>) => reduce(state, {
      type: 'applySnapshot', patch: patchOf(fields, flagged), source: 'upload', hash: 'h', playTimeFrames: 1, at: 't',
    }, flagged).state
    // The wrong slot: a late save with every source taken.
    const late = importing(miniState(), { progress: { 0x99e: 0x80, 0x9c5: 0x0a, 0x3820: 1 }, medalPrizes: 11 })
    expect(late.collected).toEqual(['s-1', 's-2', 's-3', 's-4', 's-5', 's-6'])
    expect(scarcity(flagged, late)[0]).toMatchObject({ uncollected: 1, atRisk: true })
    // The right slot: an early save with one chest opened.
    const early = importing(late, { progress: { 0x99e: 0x80 } })
    expect(early.collected).toEqual(['s-1'])
    expect(scarcity(flagged, early)[0]).toMatchObject({ uncollected: 6, atRisk: false })
    // A tick on the one source no save can show is the player's own, and stays through both.
    const byHand = importing(importing({ ...miniState(), collected: ['s-7'] }, { medalPrizes: 11 }), {})
    expect(byHand.collected).toEqual(['s-7'])
  })
})

describe('snapshotToPatch: stage from the story', () => {
  const stageOf = (fields: Partial<SaveSnapshot>) => patchOf(fields, storied).stage

  it('reaches a stage once the story chapter is at least its storyMin', () => {
    expect(stageOf({ storyProgress: 0x0a })).toBe('s1')
    expect(stageOf({ storyProgress: 0x0b })).toBe('s3')
    expect(stageOf({ storyProgress: 0x10 })).toBe('s3')
    expect(stageOf({ storyProgress: 0x11 })).toBe('s4')
  })

  it('reaches a stage once the trials beaten are at least its trialMin', () => {
    expect(stageOf({ storyProgress: 0x11, trialProgress: 0 })).toBe('s4')
    expect(stageOf({ storyProgress: 0x11, trialProgress: 1 })).toBe('s5')
    expect(stageOf({ trialProgress: 6 })).toBe('s5')
  })

  it('takes the latest of the Zoom stage, the pot stage and the story stage', () => {
    expect(stageOf({ zoomBits: [1], storyProgress: 0x03 })).toBe('s2')
    expect(stageOf({ zoomBits: [1], storyProgress: 0x0b })).toBe('s3')
    expect(stageOf({ potLevel: 2, storyProgress: 0x01 })).toBe('s2')
    expect(stageOf({ potLevel: 2, zoomBits: [0, 1], storyProgress: 0x11 })).toBe('s4')
  })

  it('ignores the story bytes for stages without a storyMin or trialMin', () => {
    expect(patchOf({ storyProgress: 0x11, trialProgress: 6 }).stage).toBe('s1')
  })
})
