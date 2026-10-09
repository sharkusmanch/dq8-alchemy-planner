import { describe, expect, it } from 'vitest'
import { createIndex } from '../data/create-index'
import type { AppState } from '../state/types'
import { miniData, miniState } from '../testing/mini'
import { consumesScarce, scarcity, totalNeed } from './need'

const index = createIndex(miniData)
const daveWantsX = createIndex({ ...structuredClone(miniData), goals: { ...structuredClone(miniData.goals), dave: [{ item: 'x', reward: 'r' }] } })

describe('totalNeed', () => {
  it('counts what the whole run still has to buy or gather', () => {
    expect(totalNeed(index, miniState())).toEqual({
      toBuy: { a: 8, b: 5, d: 1 }, toGather: { c: 1, s: 2 }, repeatBrews: 0, goldEstimate: 185,
    })
  })

  it('adds repeat brews for craftable shortfalls that no shop sells', () => {
    expect(totalNeed(daveWantsX, miniState())).toEqual({
      toBuy: { a: 10, b: 5, d: 1 }, toGather: { c: 1, s: 2 }, repeatBrews: 1, goldEstimate: 205,
    })
  })

  it('expands a shortfall into repeat brews even when the recipe has no gold route', () => {
    const data = structuredClone(miniData)
    data.items.push(
      { id: 'm', gameId: 15, name: 'M', category: 'item' }, { id: 'n', gameId: 16, name: 'N', category: 'item' },
    )
    data.recipes.push({ recipeIndex: 10, result: 'm', ingredients: ['t', 'a'] }, { recipeIndex: 11, result: 'n', ingredients: ['t', 'b'] })
    const withMore = createIndex(data)
    // t is used twice, made once, not sold; its only recipe (7: s + a) needs a found item.
    expect(totalNeed(withMore, miniState())).toEqual({
      toBuy: { a: 10, b: 6, d: 1 }, toGather: { c: 1, s: 3 }, repeatBrews: 1, goldEstimate: 225,
    })
    expect(scarcity(withMore, miniState())[0]).toMatchObject({ item: 's', needed: 3 })
  })

  it('does not expand a loop with no gold route over and over', () => {
    const data = structuredClone(miniData)
    data.shops[1]!.stock = ['a', 'b']          // nothing sells q: p and q only make each other
    data.goals.dave = [{ item: 'p', reward: 'r' }]
    const need = totalNeed(createIndex(data), miniState())
    expect(need.repeatBrews).toBeLessThan(10)
  })

  it('is empty when everything is done', () => {
    const state = miniState({ completed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], dave: { done: [true], next: 0 } })
    expect(totalNeed(index, state)).toEqual({ toBuy: {}, toGather: {}, repeatBrews: 0, goldEstimate: 0 })
  })

  it('counts the Dodgy Dave requests not handed in, wherever they are in his order', () => {
    // Requests for t, u and v, which nothing else consumes once every recipe is done.
    const three = createIndex({
      ...structuredClone(miniData),
      goals: { ...structuredClone(miniData.goals), dave: ['t', 'u', 'v'].map((item) => ({ item, reward: 'r' })) },
    })
    const done = (...flags: boolean[]) =>
      miniState({ completed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], dave: { done: flags, next: 0 } })
    // Each owed request is one repeat brew: t = s + a, u = s + b, v = d + a.
    expect(totalNeed(three, done(false, true, false))).toMatchObject({ toBuy: { a: 2, d: 1 }, toGather: { s: 1 }, repeatBrews: 2 })
    expect(totalNeed(three, done(true, false, true))).toMatchObject({ toBuy: { b: 1 }, toGather: { s: 1 }, repeatBrews: 1 })
    expect(totalNeed(three, done(true, true, true))).toMatchObject({ toBuy: {}, toGather: {}, repeatBrews: 0 })
  })

  it('subtracts stock and the pending pot result', () => {
    const need = totalNeed(index, miniState({ inventory: { a: 3, s: 1 }, pot: { recipe: 6, result: 'x', ingredients: ['a', 'a'] } }))
    // recipe 6 is in the pot: its 2 a are no longer needed and x is already produced.
    expect(need.toBuy).toEqual({ a: 3, b: 5, d: 1 })
    expect(need.toGather).toEqual({ c: 1, s: 1 })
  })

  it('terminates on cycles that no shop can start', () => {
    const data = structuredClone(miniData)
    // p and q only make each other: nothing sells either, and Dave wants one more p than the recipes make.
    data.shops[1]!.stock = ['a', 'b']
    data.goals.dave = [{ item: 'p', reward: 'r' }]
    const need = totalNeed(createIndex(data), miniState())
    expect(Number.isFinite(need.goldEstimate)).toBe(true)
  })
})

describe('scarcity', () => {
  it('reports one entry per scarce item', () => {
    expect(scarcity(index, miniState())).toEqual([
      { item: 's', inStock: 0, needed: 2, uncollected: 2, atRisk: false, gap: 0, farmable: [] },
    ])
  })
  it('lists the monster drops of a scarce item as farmable, and nothing else', () => {
    const data = structuredClone(miniData)
    const drop = { item: 's', kind: 'drop' as const, where: 'Drop: Slimer' }
    const rare = { item: 's', kind: 'rare-drop' as const, where: 'Rare drop: Golem' }
    data.sources.push(drop, rare, { item: 's', kind: 'casino', where: 'Casino prize', location: 'town', tokens: 5 })
    data.sources.push({ item: 'c', kind: 'drop', where: 'Drop: Bat' })
    const [report] = scarcity(createIndex(data), miniState({ collected: ['s-1'] }))
    expect(report?.farmable).toEqual([drop, rare])
    // Being farmable changes neither the risk nor the gap.
    expect(report).toMatchObject({ atRisk: true, gap: 1, uncollected: 1, needed: 2 })
  })
  it('counts drops as farmable whatever the story stage', () => {
    const data = structuredClone(miniData)
    data.sources.push({ item: 's', kind: 'drop', where: 'Drop: Slimer' })
    expect(scarcity(createIndex(data), miniState({ stage: 's1' }))[0]?.farmable).toHaveLength(1)
  })
  it('flags a run that cannot reach the needed count', () => {
    const [report] = scarcity(index, miniState({ collected: ['s-1'] }))
    expect(report).toMatchObject({ inStock: 0, needed: 2, uncollected: 1, atRisk: true, gap: 1 })
  })
  it('counts stock against need', () => {
    const [report] = scarcity(index, miniState({ inventory: { s: 2 }, collected: ['s-1', 's-2'] }))
    expect(report).toMatchObject({ inStock: 2, uncollected: 0, atRisk: false, gap: 0 })
  })
})

describe('consumesScarce', () => {
  const at = (overrides: Partial<AppState>, recipe: number) => consumesScarce(index, miniState(overrides), recipe)
  it('names scarce ingredients of a repeat brew, whatever the stock', () => {
    expect(at({ completed: [7], inventory: { s: 1 } }, 7)).toEqual(['s'])
    expect(at({ completed: [7], inventory: { s: 5 } }, 7)).toEqual(['s'])
  })
  it('is empty for a mandatory brew or a recipe without scarce ingredients', () => {
    expect(at({ completed: [7] }, 8)).toEqual([])
    expect(at({ completed: [0] }, 0)).toEqual([])
    expect(at({}, 7)).toEqual([])
  })
})
