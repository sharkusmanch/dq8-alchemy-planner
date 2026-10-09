import type { ItemId } from '../data/types'
import { brewableInPot, reachableShops, type PlanContext } from './context'
import type { FillerSuggestion, Purchase } from './types'

/** The cheapest recipe to repeat while a pot counter is below its threshold: shop-bought, non-scarce ingredients only. */
export function filler(ctx: PlanContext): FillerSuggestion | null {
  const { index, state } = ctx
  const level = state.potLevel
  if (level !== 1 && level !== 2) return null
  const counter = level === 1 ? 'basic' : 'improved'
  const threshold = index.data.goals.brewThresholds[counter]
  const remaining = threshold - state.brews[counter]
  if (remaining <= 0) return null

  let best: { recipe: number; cost: number; counts: Map<ItemId, number> } | undefined
  for (const recipe of index.data.recipes) {
    if (!brewableInPot(ctx, recipe)) continue
    let cost = 0
    let usable = true
    for (const item of recipe.ingredients) {
      const price = index.item(item).buy
      if (price === undefined || index.isScarce(item) || reachableShops(ctx, item).length === 0) { usable = false; break }
      cost += price
    }
    if (!usable) continue
    if (best && (cost > best.cost || (cost === best.cost && recipe.recipeIndex > best.recipe))) continue
    const counts = new Map<ItemId, number>()
    for (const item of recipe.ingredients) counts.set(item, (counts.get(item) ?? 0) + 1)
    best = { recipe: recipe.recipeIndex, cost, counts }
  }
  if (!best) return null

  const purchases: Purchase[] = [...best.counts.keys()].sort().map((item) => ({
    item, qty: best.counts.get(item)!, unitPrice: index.item(item).buy!,
  }))
  return { recipe: best.recipe, unitCost: best.cost, purchases, remaining, counter, urgent: isUrgent(ctx, level) }
}

/**
 * True in the last stage before the next pot arrives (or later). An empty pot-stage id is the data's
 * "not filled in yet" placeholder and means not urgent; any other id must be a real stage, so a typo throws.
 */
function isUrgent(ctx: PlanContext, level: 1 | 2): boolean {
  const { index, state } = ctx
  const next = level === 1 ? index.data.goals.potStages.improved : index.data.goals.potStages.instant
  if (next === '') return false
  return index.stageRank(state.stage) >= index.stageRank(next) - 1
}
