import type { DataIndex, ItemId } from '../data/types'
import type { AppState } from '../state/types'
import { isCompleted, makeContext, stockOf } from './context'
import { unitCost } from './acquire'
import type { NeedReport, ScarceReport } from './types'

const MAX_PASSES = 50

interface Need { report: NeedReport; uses: Map<ItemId, number> }

const bump = (map: Map<ItemId, number>, item: ItemId, by = 1) => map.set(item, (map.get(item) ?? 0) + by)
const record = (map: Map<ItemId, number>): Record<ItemId, number> =>
  Object.fromEntries([...map].filter(([, n]) => n > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/** Whole-run need at horizon `ever`, with the final per-item uses that scarcity compares against. */
function computeNeed(index: DataIndex, state: AppState): Need {
  const ctx = makeContext(index, state, 'ever')
  const stock = stockOf(state)
  const uses = new Map<ItemId, number>()
  const produced = new Map<ItemId, number>()
  for (const recipe of index.data.recipes) {
    if (isCompleted(state, recipe.recipeIndex)) continue
    for (const ingredient of recipe.ingredients) bump(uses, ingredient)
    bump(produced, recipe.result)
  }
  index.data.goals.dave.forEach((request, k) => {
    if (state.dave.done[k] !== true) bump(uses, request.item)
  })

  // Which items' expansions led to each item (transitively), so a loop is expanded only once.
  const ancestors = new Map<ItemId, Set<ItemId>>()

  // The recipe for a repeat brew of `item`: the cheapest by gold when any route is finite, otherwise the
  // lowest-numbered one (the ingredients still count towards need). Never a recipe that consumes its own
  // result. Without a gold route, an item already reached through its own expansion is not expanded again.
  const cheapest = new Map<ItemId, number | null>()
  const repeatRecipe = (item: ItemId): number | null => {
    const known = cheapest.get(item)
    if (known !== undefined) return known
    let best: { recipe: number; cost: number } | undefined
    let lowest: number | undefined
    for (const recipe of index.recipesFor(item)) {
      if (recipe.ingredients.includes(item)) continue
      lowest ??= recipe.recipeIndex
      let cost = 0
      for (const ingredient of recipe.ingredients) cost += unitCost(ctx, ingredient)
      if (Number.isFinite(cost) && (!best || cost < best.cost)) best = { recipe: recipe.recipeIndex, cost }
    }
    const chosen = best?.recipe ?? lowest ?? null
    cheapest.set(item, chosen)
    return chosen
  }

  const shortfall = (item: ItemId) => (uses.get(item) ?? 0) - (stock[item] ?? 0) - (produced.get(item) ?? 0)
  let repeatBrews = 0
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false
    for (const item of [...uses.keys()].sort()) {
      const missing = shortfall(item)
      if (missing <= 0 || ctx.index.shopsSelling(item).length > 0) continue
      const recipeNumber = repeatRecipe(item)
      if (recipeNumber === null) continue
      const recipe = index.recipe(recipeNumber)
      const goldRoute = recipe.ingredients.every((i) => Number.isFinite(unitCost(ctx, i)))
      const chain = ancestors.get(item)
      if (!goldRoute && chain?.has(item)) continue
      for (const ingredient of recipe.ingredients) {
        bump(uses, ingredient, missing)
        const set = ancestors.get(ingredient) ?? new Set<ItemId>()
        for (const up of chain ?? []) set.add(up)
        set.add(item)
        ancestors.set(ingredient, set)
      }
      bump(produced, item, missing)
      repeatBrews += missing
      changed = true
    }
    if (!changed) break
  }

  const toBuy = new Map<ItemId, number>()
  const toGather = new Map<ItemId, number>()
  let goldEstimate = 0
  for (const item of uses.keys()) {
    const missing = shortfall(item)
    if (missing <= 0) continue
    if (index.shopsSelling(item).length > 0) {
      toBuy.set(item, missing)
      goldEstimate += missing * (index.item(item).buy ?? 0)
    } else toGather.set(item, missing)
  }
  return { report: { toBuy: record(toBuy), toGather: record(toGather), repeatBrews, goldEstimate }, uses }
}

/** Whole-run need: what is still to be bought or gathered, and how many repeat brews it takes. Horizon `ever`. */
export function totalNeed(index: DataIndex, state: AppState): NeedReport {
  return computeNeed(index, state).report
}

/**
 * One report per `goals.scarce` item, in that order. `farmable` lists the monsters that drop the item, at any
 * stage: a shortfall they can make up is a chore, not a lost run. It does not change `atRisk` or `gap`.
 */
export function scarcity(index: DataIndex, state: AppState): ScarceReport[] {
  const { uses } = computeNeed(index, state)
  const stock = stockOf(state)
  return index.data.goals.scarce.map((entry) => {
    const needed = uses.get(entry.item) ?? 0
    const inStock = stock[entry.item] ?? 0
    const uncollected = entry.sources.filter((source) => !state.collected.includes(source.id)).length
    const atRisk = inStock + uncollected < needed
    const farmable = index.sourcesOf(entry.item).filter((source) => source.kind === 'drop' || source.kind === 'rare-drop')
    return {
      item: entry.item, inStock, needed, uncollected, atRisk, gap: atRisk ? needed - inStock - uncollected : 0, farmable,
    }
  })
}

/** Scarce items eaten by brewing `recipe` when that brew is not mandatory (already completed). Empty for a mandatory brew. */
export function consumesScarce(index: DataIndex, state: AppState, recipe: number): ItemId[] {
  if (!isCompleted(state, recipe)) return []
  const scarce = index.recipe(recipe).ingredients.filter((item) => index.isScarce(item))
  return [...new Set(scarce)]
}
