import { describe, expect, it } from 'vitest'
import { createIndex } from '../data/create-index'
import type { AppState } from '../state/types'
import { miniData, miniState } from '../testing/mini'
import { makeContext } from './context'
import { buildQueue } from './queue'
import { shoppingList } from './shopping'
import type { Queue, RecipePlan } from './types'

const listFor = (overrides: Partial<AppState>, everything = false) => {
  const ctx = makeContext(createIndex(miniData), miniState(overrides))
  return shoppingList(ctx, buildQueue(ctx), { everything })
}

describe('shoppingList', () => {
  it('stops at the first entry that does not fit the gold', () => {
    const list = listFor({ gold: 25 })
    expect(list.entriesCovered).toBe(1)
    expect(list.total).toBe(20)
    expect(list.affordable).toBe(false)
    expect(list.groups).toHaveLength(1)
    expect(list.groups[0]).toMatchObject({ location: 'town', subtotal: 20 })
    expect(list.groups[0]!.lines.map((l) => [l.item, l.qty, l.unitPrice, l.shop.id])).toEqual([['a', 2, 10, 'town-shop']])
  })
  it('takes everything when asked, or when gold is unknown', () => {
    for (const list of [listFor({ gold: 25 }, true), listFor({ gold: null })]) {
      expect(list.entriesCovered).toBe(5)
      expect(list.total).toBe(140)
      expect(list.affordable).toBe(true)
      expect(list.groups.map((g) => g.location)).toEqual(['town'])
      expect(list.groups[0]!.lines.map((l) => [l.item, l.qty])).toEqual([['a', 5], ['b', 2], ['q', 1]])
    }
  })
  it('buys nothing with no gold', () => {
    expect(listFor({ gold: 0 })).toEqual({ groups: [], total: 0, affordable: false, entriesCovered: 0 })
  })
  it('is empty and affordable for an empty queue', () => {
    expect(listFor({ potLevel: 0 })).toEqual({ groups: [], total: 0, affordable: true, entriesCovered: 0 })
  })
})

describe('shop assignment', () => {
  const data = structuredClone(miniData)
  data.shops.find((s) => s.id === 'far-shop')!.stock = ['d', 't', 'a']
  const ctx = makeContext(createIndex(data), miniState({ stage: 's2' }))
  const entry = (recipe: number, ...purchases: [string, number][]): RecipePlan => ({
    recipe, status: 'buy', cost: 0, steps: [{ recipe, mandatory: true }], gather: [], blockedBy: [],
    purchases: purchases.map(([item, qty]) => ({ item, qty, unitPrice: 10 })),
  })
  const queue = (...entries: RecipePlan[]): Queue => ({ entries, gather: [], blocked: 0, later: 0 })

  it('puts a multi-shop item where most lines already are', () => {
    const list = shoppingList(ctx, queue(entry(0, ['a', 1], ['b', 1]), entry(1, ['d', 1], ['t', 1], ['a', 1])), { everything: true })
    expect(list.groups.map((g) => [g.location, g.lines.map((l) => [l.item, l.qty])])).toEqual([
      ['town', [['b', 1]]],
      ['far', [['a', 2], ['d', 1], ['t', 1]]],
    ])
    expect(list.total).toBe(50)
  })
  it('breaks ties by the earlier stage', () => {
    const list = shoppingList(ctx, queue(entry(0, ['a', 1], ['b', 1], ['d', 1])), { everything: true })
    expect(list.groups[0]).toMatchObject({ location: 'town' })
    expect(list.groups[0]!.lines.map((l) => l.item)).toEqual(['a', 'b'])
  })
})
