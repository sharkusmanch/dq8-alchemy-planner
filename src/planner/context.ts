import type { DataIndex, ItemId, Recipe, Shop, Source } from '../data/types'
import type { AppState } from '../state/types'

/**
 * `horizon` decides what counts as reachable: `now` honours the player's story stage and pot
 * level, `ever` treats every shop, source and pot as available.
 */
export interface PlanContext { index: DataIndex; state: AppState; horizon: 'now' | 'ever' }

export function makeContext(index: DataIndex, state: AppState, horizon: 'now' | 'ever' = 'now'): PlanContext {
  return { index, state, horizon }
}

// Per-context caches assume `ctx.state` is never mutated after makeContext (build a new context instead).
const shopCache = new WeakMap<PlanContext, Map<ItemId, Shop[]>>()
const sourceCache = new WeakMap<PlanContext, Map<ItemId, Source[]>>()

function memoised<T>(store: WeakMap<PlanContext, Map<ItemId, T>>, ctx: PlanContext, item: ItemId, compute: () => T): T {
  let cache = store.get(ctx)
  if (!cache) store.set(ctx, (cache = new Map()))
  let value = cache.get(item)
  if (value === undefined) cache.set(item, (value = compute()))
  return value
}

/** Cached per context: treat the returned array as read-only. */
export function reachableShops(ctx: PlanContext, item: ItemId): Shop[] {
  return memoised(shopCache, ctx, item, () => computeShops(ctx, item))
}

function computeShops(ctx: PlanContext, item: ItemId): Shop[] {
  const shops = ctx.index.shopsSelling(item)
  if (ctx.horizon === 'ever') return shops
  const player = ctx.index.stageRank(ctx.state.stage)
  return shops.filter((shop) => {
    const from = shop.availableFrom ?? ctx.index.location(shop.location).stage
    if (ctx.index.stageRank(from) > player) return false
    return shop.availableUntil === undefined || player < ctx.index.stageRank(shop.availableUntil)
  })
}

/** Sources without a location (drops and the like) are always reachable. Cached per context: treat as read-only. */
export function reachableSources(ctx: PlanContext, item: ItemId): Source[] {
  return memoised(sourceCache, ctx, item, () => computeSources(ctx, item))
}

function computeSources(ctx: PlanContext, item: ItemId): Source[] {
  const sources = ctx.index.sourcesOf(item)
  if (ctx.horizon === 'ever') return sources
  const player = ctx.index.stageRank(ctx.state.stage)
  return sources.filter(
    (source) => source.location === undefined || ctx.index.stageRank(ctx.index.location(source.location).stage) <= player,
  )
}

export function brewableInPot(ctx: PlanContext, recipe: Recipe): boolean {
  if (ctx.horizon === 'ever') return true
  const level = ctx.state.potLevel
  if (level <= 0) return false
  return level >= 2 || recipe.ingredients.length === 2
}

/** Inventory plus one unit for the pot's pending result. */
export function stockOf(state: AppState): Record<ItemId, number> {
  const stock: Record<ItemId, number> = { ...state.inventory }
  if (state.pot && state.pot.result) stock[state.pot.result] = (stock[state.pot.result] ?? 0) + 1
  return stock
}

/** Completed, or currently in the pot. */
export function isCompleted(state: AppState, recipe: number): boolean {
  return state.completed.includes(recipe) || state.pot?.recipe === recipe
}
