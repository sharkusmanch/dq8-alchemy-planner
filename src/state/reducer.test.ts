import { describe, expect, it } from 'vitest'
import { createIndex } from '../data/create-index'
import { miniData, miniState } from '../testing/mini'
import { initialState, reduce } from './reducer'
import type { Action, AppState } from './types'

const index = createIndex(miniData)
const run = (state: AppState, action: Action) => reduce(state, action, index)

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

describe('initialState', () => {
  it('is empty with the first stage', () => {
    expect(initialState(index)).toEqual({
      version: 1, inventory: {}, equipped: {}, gold: null, potLevel: 0, pot: null, completed: [],
      brews: { basic: 0, improved: 0 }, stage: 's1', dave: { done: [false], next: 0 }, collected: [], lastImport: null,
      settings: { showSpoilers: false, saveUrl: '' },
    })
  })
  it('uses an empty stage when the data has no stages', () => {
    const empty = createIndex({ ...miniData, stages: [] })
    expect(initialState(empty).stage).toBe('')
  })
})

describe('adjustItem', () => {
  it('adds and removes stock without mutating the input', () => {
    const s = deepFreeze(miniState({ inventory: { a: 2 } }))
    expect(run(s, { type: 'adjustItem', item: 'a', delta: 3 }).state.inventory).toEqual({ a: 5 })
    expect(run(s, { type: 'adjustItem', item: 'b', delta: 1 }).state.inventory).toEqual({ a: 2, b: 1 })
  })
  it('clamps below zero and removes the key', () => {
    const s = miniState({ inventory: { a: 2, b: 1 } })
    const r = run(s, { type: 'adjustItem', item: 'a', delta: -5 })
    expect(r.state.inventory).toEqual({ b: 1 })
    expect('a' in r.state.inventory).toBe(false)
  })
  it('returns the same state when nothing changes', () => {
    const s = miniState({ inventory: { a: 2 } })
    expect(run(s, { type: 'adjustItem', item: 'a', delta: 0 }).state).toBe(s)
    expect(run(s, { type: 'adjustItem', item: 'b', delta: -1 }).state).toBe(s)
  })
  it('rejects an unknown item', () => {
    const s = miniState()
    const r = run(s, { type: 'adjustItem', item: 'nope', delta: 1 })
    expect(r.state).toBe(s)
    expect(r.error).toMatch(/unknown item/i)
  })
})

describe('setGold, setStage, setPotLevel', () => {
  it('sets gold, floors it at zero, and accepts null', () => {
    const s = miniState({ gold: 10 })
    expect(run(s, { type: 'setGold', gold: 99 }).state.gold).toBe(99)
    expect(run(s, { type: 'setGold', gold: -5 }).state.gold).toBe(0)
    expect(run(s, { type: 'setGold', gold: null }).state.gold).toBeNull()
    expect(run(s, { type: 'setGold', gold: 10 }).state).toBe(s)
  })
  it('sets a known stage and rejects an unknown one', () => {
    const s = miniState()
    expect(run(s, { type: 'setStage', stage: 's2' }).state.stage).toBe('s2')
    const bad = run(s, { type: 'setStage', stage: 'zzz' })
    expect(bad.state).toBe(s)
    expect(bad.error).toBeTruthy()
    expect(run(s, { type: 'setStage', stage: 's1' }).state).toBe(s)
  })
  it('sets the pot level', () => {
    const s = miniState({ potLevel: 1 })
    expect(run(s, { type: 'setPotLevel', level: 3 }).state.potLevel).toBe(3)
    expect(run(s, { type: 'setPotLevel', level: 1 }).state).toBe(s)
  })
})

describe('toggleCompleted and toggleCollected', () => {
  it('toggles recipes keeping the list sorted and unique', () => {
    let s = miniState({ completed: [1, 5] })
    s = run(s, { type: 'toggleCompleted', recipe: 3 }).state
    expect(s.completed).toEqual([1, 3, 5])
    s = run(s, { type: 'toggleCompleted', recipe: 1 }).state
    expect(s.completed).toEqual([3, 5])
  })
  it('toggles collected sources', () => {
    let s = miniState()
    s = run(s, { type: 'toggleCollected', sourceId: 's-1' }).state
    expect(s.collected).toEqual(['s-1'])
    s = run(s, { type: 'toggleCollected', sourceId: 's-1' }).state
    expect(s.collected).toEqual([])
  })
})

describe('daveHandIn', () => {
  // Six requests, as in the game: y x z w t u.
  const six = createIndex({
    ...miniData,
    goals: { ...miniData.goals, dave: ['y', 'x', 'z', 'w', 't', 'u'].map((item) => ({ item, reward: 'r' })) },
  })
  const none = [false, false, false, false, false, false]

  it('removes the requested item, marks the request done and moves on to the next', () => {
    const s = miniState({ inventory: { y: 2 } })
    const r = run(s, { type: 'daveHandIn' })
    expect(r.error).toBeUndefined()
    expect(r.state.inventory).toEqual({ y: 1 })
    expect(r.state.dave).toEqual({ done: [true], next: 0 })
  })
  it('hands in the request Dave wants now, not the first one that is not done', () => {
    // Dave moved on past the first two requests without getting them.
    const s = miniState({ inventory: { y: 1, z: 1 }, dave: { done: none, next: 2 } })
    const r = reduce(s, { type: 'daveHandIn' }, six)
    expect(r.error).toBeUndefined()
    expect(r.state.inventory).toEqual({ y: 1 })
    expect(r.state.dave).toEqual({ done: [false, false, true, false, false, false], next: 3 })
  })
  it('wraps to the first request after the last', () => {
    const s = miniState({ inventory: { u: 1 }, dave: { done: [true, false, true, true, true, false], next: 5 } })
    const r = reduce(s, { type: 'daveHandIn' }, six)
    expect(r.state.dave).toEqual({ done: [true, false, true, true, true, true], next: 0 })
    expect(r.state.inventory).toEqual({})
  })
  it('names the item of the request Dave wants when it is not in stock', () => {
    const s = miniState({ inventory: { y: 1 }, dave: { done: none, next: 2 } })
    const r = reduce(s, { type: 'daveHandIn' }, six)
    expect(r.state).toBe(s)
    expect(r.error).toMatch(/need Z/)
  })
  it('is rejected without the item', () => {
    const s = miniState({ inventory: { a: 1 } })
    const r = run(s, { type: 'daveHandIn' })
    expect(r.state).toBe(s)
    expect(r.error).toBeTruthy()
  })
  it('is rejected when every request is done', () => {
    const s = miniState({ inventory: { y: 1 }, dave: { done: [true], next: 0 } })
    const r = run(s, { type: 'daveHandIn' })
    expect(r.state).toBe(s)
    expect(r.error).toMatch(/all/i)
  })
  it('does not use equipped copies', () => {
    const s = miniState({ equipped: { y: 1 } })
    expect(run(s, { type: 'daveHandIn' }).state).toBe(s)
  })
})

describe('setDaveNext', () => {
  const six = createIndex({
    ...miniData,
    goals: { ...miniData.goals, dave: ['y', 'x', 'z', 'w', 't', 'u'].map((item) => ({ item, reward: 'r' })) },
  })
  const start = () => miniState({ inventory: { y: 1 }, dave: { done: [true, false, false, false, false, false], next: 1 } })

  it('sets the request Dave wants now and touches neither the flags nor the bag', () => {
    const r = reduce(start(), { type: 'setDaveNext', request: 4 }, six)
    expect(r.error).toBeUndefined()
    expect(r.state.dave).toEqual({ done: [true, false, false, false, false, false], next: 4 })
    expect(r.state.inventory).toEqual({ y: 1 })
  })
  it('can point back at a request that is already done', () => {
    expect(reduce(start(), { type: 'setDaveNext', request: 0 }, six).state.dave.next).toBe(0)
  })
  it('returns the same state when he already wants that request', () => {
    const s = start()
    expect(reduce(s, { type: 'setDaveNext', request: 1 }, six).state).toBe(s)
  })
  it('rejects a request the data does not have', () => {
    const s = start()
    for (const request of [-1, 6, 2.5]) {
      const r = reduce(s, { type: 'setDaveNext', request }, six)
      expect(r.state).toBe(s)
      expect(r.error).toBeTruthy()
    }
  })
  it('makes the next hand-in serve that request', () => {
    const moved = reduce(miniState({ inventory: { w: 1 }, dave: { done: [], next: 0 } }), { type: 'setDaveNext', request: 3 }, six).state
    const r = reduce(moved, { type: 'daveHandIn' }, six)
    expect(r.error).toBeUndefined()
    expect(r.state.dave).toEqual({ done: [false, false, false, true, false, false], next: 4 })
    expect(r.state.inventory).toEqual({})
  })
})

describe('toggleDave', () => {
  const six = createIndex({
    ...miniData,
    goals: { ...miniData.goals, dave: ['y', 'x', 'z', 'w', 't', 'u'].map((item) => ({ item, reward: 'r' })) },
  })
  const start = () => miniState({ inventory: { z: 1 }, dave: { done: [true, false, false, false, false, false], next: 1 } })

  it('flips one request by hand and touches neither the bag nor the request Dave wants', () => {
    let s = reduce(start(), { type: 'toggleDave', request: 2 }, six).state
    expect(s.dave).toEqual({ done: [true, false, true, false, false, false], next: 1 })
    expect(s.inventory).toEqual({ z: 1 })
    s = reduce(s, { type: 'toggleDave', request: 0 }, six).state
    expect(s.dave).toEqual({ done: [false, false, true, false, false, false], next: 1 })
  })
  it('rejects a request the data does not have', () => {
    const s = start()
    for (const request of [-1, 6, 1.5]) {
      const r = reduce(s, { type: 'toggleDave', request }, six)
      expect(r.state).toBe(s)
      expect(r.error).toBeTruthy()
    }
  })
})

describe('buy', () => {
  it('adds stock and subtracts known gold', () => {
    const r = run(miniState({ gold: 100 }), { type: 'buy', item: 'a', qty: 3 })
    expect(r.state.inventory).toEqual({ a: 3 })
    expect(r.state.gold).toBe(70)
  })
  it('floors gold at zero', () => {
    expect(run(miniState({ gold: 20 }), { type: 'buy', item: 'q', qty: 3 }).state.gold).toBe(0)
  })
  it('leaves unknown gold null', () => {
    const r = run(miniState({ gold: null }), { type: 'buy', item: 'a', qty: 2 })
    expect(r.state.gold).toBeNull()
    expect(r.state.inventory).toEqual({ a: 2 })
  })
  it('adds stock without touching gold for an item with no price', () => {
    const r = run(miniState({ gold: 100 }), { type: 'buy', item: 'c', qty: 2 })
    expect(r.state.inventory).toEqual({ c: 2 })
    expect(r.state.gold).toBe(100)
  })
  it('rejects a non-positive quantity or an unknown item', () => {
    const s = miniState()
    expect(run(s, { type: 'buy', item: 'a', qty: 0 }).state).toBe(s)
    expect(run(s, { type: 'buy', item: 'nope', qty: 1 }).error).toBeTruthy()
  })
})

describe('collectPot', () => {
  it('moves the pot result into stock and empties the pot', () => {
    const s = miniState({ pot: { recipe: 0, result: 'x', ingredients: ['a', 'b'] }, inventory: { x: 1 } })
    const r = run(s, { type: 'collectPot' })
    expect(r.state.pot).toBeNull()
    expect(r.state.inventory).toEqual({ x: 2 })
  })
  it('returns the same state on an empty pot', () => {
    const s = miniState()
    expect(run(s, { type: 'collectPot' }).state).toBe(s)
  })
  it('completes the recipe that was in the pot, keeping the list sorted', () => {
    // An imported save can hold a brew whose recipe is not flagged done yet.
    const s = deepFreeze(miniState({ completed: [0, 5], pot: { recipe: 1, result: 'y', ingredients: ['x', 'a'] } }))
    const r = run(s, { type: 'collectPot' })
    expect(r.state.completed).toEqual([0, 1, 5])
    expect(r.state.pot).toBeNull()
    expect(r.state.inventory).toEqual({ y: 1 })
  })
  it('does not list a recipe twice, and leaves the list alone when the pot matches no recipe', () => {
    const done = miniState({ completed: [0, 1], pot: { recipe: 1, result: 'y', ingredients: ['x', 'a'] } })
    expect(run(done, { type: 'collectPot' }).state.completed).toEqual([0, 1])
    const unknown = miniState({ completed: [0], pot: { recipe: null, result: 'x', ingredients: ['c', 'd'] } })
    expect(run(unknown, { type: 'collectPot' }).state.completed).toEqual([0])
  })
})

describe('brew', () => {
  it('at pot level 1 removes ingredients, fills the pot and counts the brew', () => {
    const s = deepFreeze(miniState({ potLevel: 1, inventory: { a: 2, b: 1 } }))
    const r = run(s, { type: 'brew', recipe: 0 })
    expect(r.error).toBeUndefined()
    expect(r.state.inventory).toEqual({ a: 1 })
    expect(r.state.pot).toEqual({ recipe: 0, result: 'x', ingredients: ['a', 'b'] })
    expect(r.state.completed).toEqual([0])
    expect(r.state.brews).toEqual({ basic: 1, improved: 0 })
  })
  it('at pot level 2 handles a three-ingredient recipe and counts improved', () => {
    const s = miniState({ potLevel: 2, inventory: { a: 1, b: 2 } })
    const r = run(s, { type: 'brew', recipe: 3 })
    expect(r.state.inventory).toEqual({})
    expect(r.state.pot).toEqual({ recipe: 3, result: 'w', ingredients: ['a', 'b', 'b'] })
    expect(r.state.brews).toEqual({ basic: 0, improved: 1 })
  })
  it('at pot level 3 puts the result straight into stock with no counter', () => {
    const s = miniState({ potLevel: 3, inventory: { a: 1, b: 1 } })
    const r = run(s, { type: 'brew', recipe: 0 })
    expect(r.state.inventory).toEqual({ x: 1 })
    expect(r.state.pot).toBeNull()
    expect(r.state.brews).toEqual({ basic: 0, improved: 0 })
    expect(r.state.completed).toEqual([0])
  })
  it('collects an occupied pot first', () => {
    const s = miniState({
      potLevel: 1, inventory: { a: 1, b: 1 }, completed: [6],
      pot: { recipe: 6, result: 'x', ingredients: ['a', 'a'] },
    })
    const r = run(s, { type: 'brew', recipe: 0 })
    expect(r.state.inventory).toEqual({ x: 1 })
    expect(r.state.pot).toEqual({ recipe: 0, result: 'x', ingredients: ['a', 'b'] })
    expect(r.state.completed).toEqual([0, 6])
  })
  it('completes the recipe of the pot it collects as well as the one it brews', () => {
    const s = deepFreeze(miniState({
      potLevel: 1, inventory: { a: 1, b: 1 }, completed: [5],
      pot: { recipe: 6, result: 'x', ingredients: ['a', 'a'] },
    }))
    const r = run(s, { type: 'brew', recipe: 0 })
    expect(r.error).toBeUndefined()
    expect(r.state.completed).toEqual([0, 5, 6])
    expect(r.state.inventory).toEqual({ x: 1 })
  })
  it('completes the collected recipe in the instant pot too', () => {
    const s = miniState({
      potLevel: 3, inventory: { a: 1, b: 1 }, pot: { recipe: 6, result: 'x', ingredients: ['a', 'a'] },
    })
    const r = run(s, { type: 'brew', recipe: 0 })
    expect(r.state.completed).toEqual([0, 6])
    expect(r.state.inventory).toEqual({ x: 2 })
    expect(r.state.pot).toBeNull()
  })
  it('can use the pending pot result as an ingredient', () => {
    const s = miniState({
      potLevel: 1, inventory: { a: 1 }, completed: [0],
      pot: { recipe: 0, result: 'x', ingredients: ['a', 'b'] },
    })
    const r = run(s, { type: 'brew', recipe: 1 })
    expect(r.error).toBeUndefined()
    expect(r.state.inventory).toEqual({})
    expect(r.state.pot).toEqual({ recipe: 1, result: 'y', ingredients: ['x', 'a'] })
  })
  it('rejects a brew whose ingredients are missing and leaves an occupied pot alone', () => {
    const s = miniState({
      potLevel: 1, inventory: { b: 1 },
      pot: { recipe: 0, result: 'x', ingredients: ['a', 'b'] },
    })
    const r = run(s, { type: 'brew', recipe: 7 })
    expect(r.state).toBe(s)
    expect(r.error).toBeTruthy()
    expect(r.state.pot).toEqual({ recipe: 0, result: 'x', ingredients: ['a', 'b'] })
  })
  it('the second of two brews with stock for one is rejected and nothing goes negative', () => {
    const s0 = miniState({ potLevel: 1, inventory: { a: 1, b: 1 } })
    const first = run(s0, { type: 'brew', recipe: 0 })
    const second = run(first.state, { type: 'brew', recipe: 0 })
    expect(second.error).toBeTruthy()
    expect(second.state).toBe(first.state)
    for (const n of Object.values(second.state.inventory)) expect(n).toBeGreaterThanOrEqual(0)
  })
  it('needs two units when a recipe uses the same item twice', () => {
    const one = miniState({ inventory: { a: 1 } })
    expect(run(one, { type: 'brew', recipe: 6 }).error).toBeTruthy()
    const two = miniState({ inventory: { a: 2 } })
    expect(run(two, { type: 'brew', recipe: 6 }).state.pot?.result).toBe('x')
  })
  it('is rejected without a pot', () => {
    const s = miniState({ potLevel: 0, inventory: { a: 1, b: 1 } })
    const r = run(s, { type: 'brew', recipe: 0 })
    expect(r.state).toBe(s)
    expect(r.error).toBe("You don't have the alchemy pot yet")
  })
  it('rejects a three-ingredient recipe at pot level 1', () => {
    const s = miniState({ potLevel: 1, inventory: { a: 1, b: 2 } })
    const r = run(s, { type: 'brew', recipe: 3 })
    expect(r.state).toBe(s)
    expect(r.error).toBe('This recipe needs the improved pot')
  })
  it('rejects an unknown recipe', () => {
    const s = miniState()
    expect(run(s, { type: 'brew', recipe: 99 }).error).toBeTruthy()
  })
  it('does not count equipped items as ingredients', () => {
    const s = miniState({ equipped: { a: 1, b: 1 } })
    expect(run(s, { type: 'brew', recipe: 0 }).state).toBe(s)
  })
})

describe('applySnapshot', () => {
  const patch = {
    inventory: { a: 5 }, equipped: { c: 1 }, gold: 321, potLevel: 2 as const,
    pot: { recipe: 0, result: 'x', ingredients: ['a', 'b'] }, completed: [0, 4],
    brews: { basic: 7, improved: 3 }, dave: { done: [true], next: 0 }, collected: [] as string[], stage: 's2',
    unknownItems: 0,
  }
  const act = (over: Partial<Extract<Action, { type: 'applySnapshot' }>> = {}): Action => ({
    type: 'applySnapshot', patch, source: 'upload', hash: 'h1', playTimeFrames: 99, at: '2026-10-09T00:00:00Z', ...over,
  })
  // Three sources a save can show as taken, one for each kind of sign, and one it cannot.
  const signed = createIndex({
    ...miniData,
    goals: { ...miniData.goals, scarce: [{ item: 's', sources: [
      { id: 's-1', label: 'Chest', location: 'town', flag: { offset: 0x99e, bit: 7 } },
      { id: 's-2', label: 'Prize', location: 'town', medalPrize: 4 },
      { id: 's-3', label: 'Boss', location: 'town', killCount: { offset: 0x3820 } },
      { id: 's-4', label: 'By hand only', location: 'town' },
    ] }] },
  })
  const collectedAfter = (before: string[], fromSave: string[]) =>
    reduce(miniState({ collected: before }), act({ patch: { ...patch, collected: fromSave } }), signed).state.collected

  it('replaces the listed fields and keeps the settings and the ticks on sources without a save sign', () => {
    const s = miniState({
      inventory: { b: 9 }, collected: ['s-1'], settings: { showSpoilers: false, saveUrl: 'https://x' },
      completed: [8], dave: { done: [false], next: 0 }, stage: 's1',
    })
    const r = run(s, act())
    expect(r.state).toMatchObject({
      inventory: { a: 5 }, equipped: { c: 1 }, gold: 321, potLevel: 2, completed: [0, 4],
      brews: { basic: 7, improved: 3 }, dave: { done: [true], next: 0 }, stage: 's2', collected: ['s-1'],
      settings: { showSpoilers: false, saveUrl: 'https://x' },
    })
    expect(r.state.pot).toEqual(patch.pot)
    expect(r.state.lastImport).toEqual({ at: '2026-10-09T00:00:00Z', source: 'upload', hash: 'h1', playTimeFrames: 99 })
  })
  it('takes the tick of every source that has a save sign from the save, like the bag', () => {
    expect(collectedAfter([], ['s-1', 's-3'])).toEqual(['s-1', 's-3'])
    expect(collectedAfter(['s-1', 's-2', 's-3'], ['s-2'])).toEqual(['s-2'])
    expect(collectedAfter(['s-1', 's-2', 's-3'], [])).toEqual([])
  })
  it('clears a tick made by hand on a source the save shows as still there', () => {
    expect(collectedAfter(['s-1'], [])).toEqual([])
    expect(collectedAfter(['s-1'], ['s-2'])).toEqual(['s-2'])
  })
  it('keeps a tick made by hand on a source the save has no sign for', () => {
    expect(collectedAfter(['s-4'], [])).toEqual(['s-4'])
    expect(collectedAfter(['s-1', 's-4'], ['s-2'])).toEqual(['s-4', 's-2'])
    expect(collectedAfter(['s-4', 's-2'], ['s-2'])).toEqual(['s-4', 's-2'])
  })
  it('takes Dodgy Dave from the save, done or not', () => {
    const s = miniState({ dave: { done: [true], next: 0 } })
    const r = run(s, act({ patch: { ...patch, dave: { done: [false], next: 0 } } }))
    expect(r.state.dave).toEqual({ done: [false], next: 0 })
  })
  it('only moves the stage forward', () => {
    const later = miniState({ stage: 's2' })
    expect(run(later, act({ patch: { ...patch, stage: 's1' } })).state.stage).toBe('s2')
    expect(run(miniState({ stage: 's1' }), act()).state.stage).toBe('s2')
  })
})

describe('importState, reset, setSetting', () => {
  it('importState replaces the state', () => {
    const next = miniState({ gold: 5 })
    expect(run(miniState(), { type: 'importState', state: next }).state).toBe(next)
  })
  it('reset returns the initial state', () => {
    expect(run(miniState({ gold: 5, inventory: { a: 1 } }), { type: 'reset' }).state).toEqual(initialState(index))
  })
  it('setSetting changes one setting and checks the value type', () => {
    const s = miniState()
    expect(run(s, { type: 'setSetting', key: 'showSpoilers', value: false }).state.settings.showSpoilers).toBe(false)
    expect(run(s, { type: 'setSetting', key: 'saveUrl', value: 'https://u' }).state.settings.saveUrl).toBe('https://u')
    expect(run(s, { type: 'setSetting', key: 'saveUrl', value: true }).state).toBe(s)
    expect(run(s, { type: 'setSetting', key: 'showSpoilers', value: true }).state).toBe(s)
  })
})
