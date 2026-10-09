import { describe, expect, it } from 'vitest'
import { createIndex } from '../data/create-index'
import type { GameData } from '../data/types'
import type { RecipePlan } from './types'
import type { AppState } from '../state/types'
import { miniData, miniState } from '../testing/mini'
import { planAll, planRecipe, unitCost } from './acquire'
import { makeContext } from './context'

const ctxFor = (overrides: Partial<AppState> = {}, horizon?: 'now' | 'ever', data: GameData = miniData) =>
  makeContext(createIndex(data), miniState(overrides), horizon)
const plans = (overrides: Partial<AppState> = {}) => planAll(ctxFor(overrides))
const planOf = (all: RecipePlan[], recipe: number): RecipePlan => {
  const plan = all.find((p) => p.recipe === recipe)
  if (!plan) throw new Error(`no plan for ${recipe}`)
  return plan
}
const summary = (overrides: Partial<AppState> = {}) =>
  plans(overrides).map((p) => `${p.recipe}:${p.status}:${p.cost}`)

describe('unitCost', () => {
  const ctx = ctxFor()
  it('prices shop items, brewed items and unobtainable items', () => {
    expect(unitCost(ctx, 'a')).toBe(10)
    expect(unitCost(ctx, 'x')).toBe(20)
    expect(unitCost(ctx, 'p')).toBe(60)
    expect(unitCost(ctx, 'q')).toBe(50)
    expect(unitCost(ctx, 'c')).toBe(Infinity)
  })
  it('respects the horizon for shops that are not reachable yet', () => {
    expect(unitCost(ctx, 'd')).toBe(Infinity)
    expect(unitCost(ctxFor({}, 'ever'), 'd')).toBe(5)
  })
  it('terminates on the p/q cycle', () => {
    expect(unitCost(ctxFor({ potLevel: 2 }), 'p')).toBe(60)
  })
  it('is shop first even when a recipe is cheaper', () => {
    const data = structuredClone(miniData)
    data.items.find((i) => i.id === 'x')!.buy = 100
    data.shops.find((s) => s.id === 'town-shop')!.stock.push('x')
    expect(unitCost(ctxFor({}, undefined, data), 'x')).toBe(100)
  })
})

describe('planAll', () => {
  it('assigns statuses and costs at the default state', () => {
    expect(summary()).toEqual([
      '0:buy:30', '1:chain:30', '2:gather:Infinity', '3:later:Infinity', '4:buy:60',
      '5:chain:80', '6:buy:20', '7:gather:Infinity', '8:gather:Infinity', '9:blocked:Infinity',
    ])
  })
  it('lists steps, gather items and blockers', () => {
    const all = plans()
    expect(planOf(all, 1).steps).toEqual([{ recipe: 6, mandatory: true }, { recipe: 1, mandatory: true }])
    expect(planOf(all, 1).purchases).toEqual([{ item: 'a', qty: 3, unitPrice: 10 }])
    expect(planOf(all, 5).steps).toEqual([{ recipe: 4, mandatory: true }, { recipe: 5, mandatory: true }])
    expect(planOf(all, 2).gather).toHaveLength(1)
    expect(planOf(all, 2).gather[0]?.item).toBe('c')
    expect(planOf(all, 2).gather[0]?.sources).toHaveLength(1)
    expect(planOf(all, 2).steps).toEqual([])
    expect(planOf(all, 9).blockedBy).toEqual(['d'])
    expect(planOf(all, 9).purchases).toEqual([])
  })
  it('uses stock before buying', () => {
    expect(planOf(plans({ inventory: { a: 2 } }), 6)).toMatchObject({ status: 'ready', cost: 0 })
    expect(planOf(plans({ inventory: { x: 1, a: 1 } }), 1)).toMatchObject({ status: 'ready', cost: 0 })
    expect(planOf(plans({ inventory: { a: 1 } }), 6)).toMatchObject({ status: 'buy', cost: 10 })
  })
  it('marks an already completed intermediate as not mandatory', () => {
    const plan = planOf(plans({ completed: [6] }), 1)
    expect(plan.status).toBe('chain')
    expect(plan.cost).toBe(30)
    expect(plan.steps[0]).toEqual({ recipe: 6, mandatory: false })
  })
  it('follows the pot level and stage', () => {
    expect(planOf(plans({ potLevel: 2 }), 3)).toMatchObject({ status: 'buy', cost: 50 })
    expect(plans({ potLevel: 0 }).every((p) => p.status === 'later')).toBe(true)
    expect(planOf(plans({ stage: 's2' }), 9)).toMatchObject({ status: 'buy', cost: 15 })
  })
  it('treats the pot recipe as done and its result as stock', () => {
    const all = plans({ pot: { recipe: 0, result: 'x', ingredients: ['a', 'b'] } })
    expect(planOf(all, 0).status).toBe('done')
    expect(planOf(all, 1)).toMatchObject({ status: 'buy', cost: 10 })
  })
  it('reports done for every completed recipe', () => {
    const all = plans({ completed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })
    expect(all).toHaveLength(10)
    expect(all.every((p) => p.status === 'done')).toBe(true)
  })
})

describe('planRecipe', () => {
  it('does not mutate the stock it is given', () => {
    const ctx = ctxFor()
    const stock = { a: 1, x: 1 }
    planRecipe(ctx, ctx.index.recipe(1), stock, new Set())
    planRecipe(ctx, ctx.index.recipe(6), stock, new Set())
    expect(stock).toEqual({ a: 1, x: 1 })
  })
})

/** miniData with `town-shop` also selling x at 100. */
function shopSellsX(): GameData {
  const data = structuredClone(miniData)
  data.items.find((i) => i.id === 'x')!.buy = 100
  data.shops.find((s) => s.id === 'town-shop')!.stock.push('x')
  return data
}

describe('shop first in plans', () => {
  it('buys x at the shop instead of brewing it', () => {
    const ctx = ctxFor({}, undefined, shopSellsX())
    const plan = planOf(planAll(ctx), 1)
    expect(plan.status).toBe('buy')
    expect(plan.cost).toBe(110)
    expect(plan.purchases).toEqual([{ item: 'a', qty: 1, unitPrice: 10 }, { item: 'x', qty: 1, unitPrice: 100 }])
    expect(plan.steps).toEqual([{ recipe: 1, mandatory: true }])
  })
})

describe('cycle guard', () => {
  const data = structuredClone(miniData)
  data.shops.find((s) => s.id === 'town-shop')!.stock = ['a', 'b']
  delete data.items.find((i) => i.id === 'q')!.buy
  const ctx = ctxFor({}, undefined, data)
  it('prices a pure p/q cycle as unobtainable', () => {
    expect(unitCost(ctx, 'p')).toBe(Infinity)
    expect(unitCost(ctx, 'q')).toBe(Infinity)
  })
  it('plans both cycle recipes as blocked without recursing forever', () => {
    for (const n of [4, 5]) {
      const plan = planRecipe(ctx, ctx.index.recipe(n), {}, new Set())
      expect(plan.status).toBe('blocked')
      expect(plan.blockedBy.length).toBeGreaterThan(0)
    }
  })
})

describe('stock-aware intermediates', () => {
  const data = structuredClone(miniData)
  data.items.push({ id: 'm', gameId: 15, name: 'M', category: 'item' })
  data.recipes.push({ recipeIndex: 10, result: 'm', ingredients: ['z', 'a'] })
  const plan = (n: number, inventory: Record<string, number>) =>
    planOf(planAll(ctxFor({ inventory }, undefined, data)), n)

  it('brews through a found-only item the player holds', () => {
    const p = plan(10, { c: 1 })
    expect(p.status).toBe('chain')
    expect(p.cost).toBe(30)
    expect(p.steps).toEqual([{ recipe: 6, mandatory: true }, { recipe: 2, mandatory: true }, { recipe: 10, mandatory: true }])
  })
  it('asks to gather the found item when it is not held', () => {
    const p = plan(10, {})
    expect(p.status).toBe('gather')
    expect(p.gather.map((g) => g.item)).toEqual(['c'])
  })
  it('makes recipe 2 itself a chain once c is held', () => {
    const p = plan(2, { c: 1 })
    expect(p.status).toBe('chain')
    expect(p.cost).toBe(20)
    expect(p.steps.map((s) => s.recipe)).toEqual([6, 2])
  })
})

describe('tie-breaks between equal-cost recipes', () => {
  const data = structuredClone(miniData)
  data.items.push({ id: 'e', gameId: 15, name: 'E', category: 'item' }, { id: 'f', gameId: 16, name: 'F', category: 'item' })
  data.recipes.push(
    { recipeIndex: 10, result: 'e', ingredients: ['a', 'b'] },
    { recipeIndex: 11, result: 'e', ingredients: ['b', 'a'] },
    { recipeIndex: 12, result: 'f', ingredients: ['e', 'a'] },
  )
  it('takes the lower recipe number when neither is done', () => {
    const p = planOf(planAll(ctxFor({}, undefined, data)), 12)
    expect(p.steps.map((s) => s.recipe)).toEqual([10, 12])
    expect(p.cost).toBe(40)
  })
  it('prefers the recipe that is not done', () => {
    const p = planOf(planAll(ctxFor({ completed: [10] }, undefined, data)), 12)
    expect(p.steps).toEqual([{ recipe: 11, mandatory: true }, { recipe: 12, mandatory: true }])
  })
})

describe('performance', () => {
  it('plans a 12-deep graph with two three-ingredient recipes per item in under 500 ms', () => {
    const depth = 12
    const data = structuredClone(miniData)
    const ids = Array.from({ length: depth + 1 }, (_, k) => `l${k}`)
    data.items.push(...ids.map((id, k) => ({ id, gameId: 100 + k, name: id, category: 'item' as const })))
    data.items.find((i) => i.id === 'l12')!.buy = 7
    data.shops.find((s) => s.id === 'town-shop')!.stock.push('l12')
    let n = 100
    for (let k = 0; k < depth; k++) {
      const next = ids[k + 1]!
      data.recipes.push(
        { recipeIndex: n++, result: ids[k]!, ingredients: [next, next, next] },
        { recipeIndex: n++, result: ids[k]!, ingredients: [next, 'a', 'b'] },
      )
    }
    const ctx = ctxFor({ potLevel: 3 }, undefined, data)
    const started = performance.now()
    const all = planAll(ctx)
    expect(performance.now() - started).toBeLessThan(500)
    const top = planOf(all, 100)
    expect(top.status).toBe('chain')
    expect(top.steps.length).toBeGreaterThanOrEqual(depth)
    expect(top.steps.at(-1)).toEqual({ recipe: 100, mandatory: true })
  })
})

describe('memoised failures keep what was missing', () => {
  // z needs the found-only c. g can only be brewed from z, so it is unobtainable too.
  // Recipe 12 asks for z first, then g, so g is computed while c is already recorded as missing.
  // Recipe 13 (planned later, sharing the cache) asks for g alone and must still report c.
  const data = structuredClone(miniData)
  data.items.push(
    { id: 'g', gameId: 15, name: 'G', category: 'item' },
    { id: 'h', gameId: 16, name: 'H', category: 'item' },
    { id: 'k', gameId: 17, name: 'K', category: 'item' },
  )
  data.recipes.push(
    { recipeIndex: 10, result: 'g', ingredients: ['z', 'a'] },
    { recipeIndex: 11, result: 'g', ingredients: ['z', 'b'] },
    { recipeIndex: 12, result: 'h', ingredients: ['z', 'g'] },
    { recipeIndex: 13, result: 'k', ingredients: ['g', 'a'] },
  )
  it('reports gather c for every recipe that needs g, never a success', () => {
    const all = planAll(ctxFor({}, undefined, data))
    for (const n of [10, 11, 12, 13]) {
      const plan = planOf(all, n)
      expect(plan.status).toBe('gather')
      expect(plan.gather.map((g) => g.item)).toEqual(['c'])
    }
  })
  it('gives the same answer when a fresh context plans recipe 13 alone', () => {
    const fresh = ctxFor({}, undefined, data)
    const plan = planRecipe(fresh, fresh.index.recipe(13), {}, new Set())
    expect(plan.status).toBe('gather')
    expect(plan.gather.map((g) => g.item)).toEqual(['c'])
  })
})

describe('performance of failing sub-plans', () => {
  it('plans a 16-deep chain of triple requests for a missing found-only item in under 200 ms', () => {
    const depth = 16
    const data = structuredClone(miniData)
    const ids = Array.from({ length: depth + 1 }, (_, k) => `m${k}`)
    data.items.push(...ids.map((id, k) => ({ id, gameId: 100 + k, name: id, category: 'item' as const })))
    data.sources.push({ item: ids[depth]!, kind: 'found', where: 'Somewhere', location: 'town' })
    ids.slice(0, depth).forEach((id, k) => {
      const next = ids[k + 1]!
      data.recipes.push({ recipeIndex: 100 + k, result: id, ingredients: [next, next, next] })
    })
    const ctx = ctxFor({ potLevel: 3 }, undefined, data)
    const top = ctx.index.recipe(100)
    const started = performance.now()
    let plan = planRecipe(ctx, top, {}, new Set())
    for (let i = 0; i < 50; i++) plan = planRecipe(ctx, top, {}, new Set())
    expect(performance.now() - started).toBeLessThan(200)
    expect(plan.status).toBe('gather')
    expect(plan.gather.map((g) => g.item)).toEqual([ids[depth]])
  })
})
