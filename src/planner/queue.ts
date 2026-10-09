import type { ItemId, Recipe } from '../data/types'
import { brewableInPot, isCompleted, reachableShops, stockOf, type PlanContext } from './context'
import { planRecipe } from './acquire'
import type { Queue, RecipePlan } from './types'

const QUEUEABLE = new Set(['ready', 'buy', 'chain'])

/** Applies a plan to a working stock the way Bought then Brewed would: purchases add, each step consumes and produces. */
export function applyPlan(ctx: PlanContext, stock: Record<ItemId, number>, plan: RecipePlan): void {
  const add = (item: ItemId, delta: number) => {
    const count = (stock[item] ?? 0) + delta
    // The reducer would reject a brew that consumes more than is held, so a plan must never ask for one.
    if (count < 0) throw new Error(`Plan for recipe ${plan.recipe} consumes more ${item} than the working stock holds`)
    if (count === 0) delete stock[item]
    else stock[item] = count
  }
  for (const purchase of plan.purchases) add(purchase.item, purchase.qty)
  for (const step of plan.steps) {
    const recipe = ctx.index.recipe(step.recipe)
    for (const ingredient of recipe.ingredients) add(ingredient, -1)
    add(recipe.result, 1)
  }
}

/** `ready` first, then lowest gold cost, then lowest recipe number. */
function better(a: RecipePlan, b: RecipePlan): boolean {
  const readyA = a.status === 'ready' ? 0 : 1
  const readyB = b.status === 'ready' ? 0 : 1
  if (readyA !== readyB) return readyA < readyB
  if (a.cost !== b.cost) return a.cost < b.cost
  return a.recipe < b.recipe
}

/** What a recipe's plan can depend on: the stock of these items and the done-ness of these recipes. */
interface Deps { items: Set<ItemId>; recipes: Set<number> }

/**
 * Every item a plan of this recipe could look at, and every recipe it could choose between. Sold items are
 * leaves (acquire buys instead of brewing them), but their stock still matters. Stock is not consulted here:
 * an item whose stock runs out is brewed instead, so the closure must cover that route too.
 */
function dependencies(ctx: PlanContext, recipe: Recipe): Deps {
  const deps: Deps = { items: new Set(), recipes: new Set([recipe.recipeIndex]) }
  const visit = (item: ItemId) => {
    if (deps.items.has(item)) return
    deps.items.add(item)
    if (reachableShops(ctx, item).length > 0) return
    for (const maker of ctx.index.recipesFor(item)) {
      if (!brewableInPot(ctx, maker)) continue
      deps.recipes.add(maker.recipeIndex)
      for (const ingredient of maker.ingredients) visit(ingredient)
    }
  }
  for (const ingredient of recipe.ingredients) visit(ingredient)
  return deps
}

export function buildQueue(ctx: PlanContext): Queue {
  return buildQueueWith(ctx, true)
}

/**
 * `incremental` re-plans only the recipes whose plan can have changed after a pick (their stock or done-set
 * dependencies changed); the result is identical to re-planning everything, which `incremental: false` does.
 */
export function buildQueueWith(ctx: PlanContext, incremental: boolean): Queue {
  const recipes = [...ctx.index.data.recipes].sort((a, b) => a.recipeIndex - b.recipeIndex)
  const stock = stockOf(ctx.state)
  const done = new Set<number>(recipes.filter((r) => isCompleted(ctx.state, r.recipeIndex)).map((r) => r.recipeIndex))
  const entries: RecipePlan[] = []

  const plans = new Map<number, RecipePlan>()
  const deps = new Map<number, Deps>()
  let stale = new Set<number>(recipes.map((r) => r.recipeIndex))
  let remaining: RecipePlan[] = []
  for (;;) {
    remaining = []
    for (const recipe of recipes) {
      if (done.has(recipe.recipeIndex)) continue
      let plan = plans.get(recipe.recipeIndex)
      if (!plan || !incremental || stale.has(recipe.recipeIndex)) {
        plan = planRecipe(ctx, recipe, stock, done)
        plans.set(recipe.recipeIndex, plan)
      }
      remaining.push(plan)
    }
    let pick: RecipePlan | undefined
    for (const plan of remaining) {
      if (QUEUEABLE.has(plan.status) && (!pick || better(plan, pick))) pick = plan
    }
    if (!pick) break
    entries.push(pick)

    const changedItems = new Set<ItemId>()
    for (const purchase of pick.purchases) changedItems.add(purchase.item)
    for (const step of pick.steps) {
      const recipe = ctx.index.recipe(step.recipe)
      changedItems.add(recipe.result)
      for (const ingredient of recipe.ingredients) changedItems.add(ingredient)
    }
    applyPlan(ctx, stock, pick)
    const newlyDone = new Set<number>([pick.recipe])
    for (const step of pick.steps) if (step.mandatory) newlyDone.add(step.recipe)
    for (const n of newlyDone) done.add(n)

    stale = new Set()
    if (incremental) {
      for (const recipe of recipes) {
        if (done.has(recipe.recipeIndex)) continue
        let d = deps.get(recipe.recipeIndex)
        if (!d) deps.set(recipe.recipeIndex, (d = dependencies(ctx, recipe)))
        if ([...changedItems].some((i) => d!.items.has(i)) || [...newlyDone].some((n) => d!.recipes.has(n))) {
          stale.add(recipe.recipeIndex)
        }
      }
    }
  }

  const queue: Queue = {
    entries,
    gather: remaining.filter((p) => p.status === 'gather'),
    blocked: remaining.filter((p) => p.status === 'blocked').length,
    later: remaining.filter((p) => p.status === 'later').length,
  }
  if (entries.length === 0) {
    queue.reason = ctx.state.potLevel === 0
      ? 'no-pot'
      : recipes.every((r) => done.has(r.recipeIndex)) ? 'all-done' : 'nothing-reachable'
  }
  return queue
}
