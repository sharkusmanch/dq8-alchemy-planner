import type { ItemId, Recipe } from '../data/types'
import type { BrewStep, Purchase, RecipePlan } from './types'
import {
  brewableInPot, isCompleted, reachableShops, reachableSources, stockOf, type PlanContext,
} from './context'

// ---------------------------------------------------------------------------------------------
// Memoisation. A sub-result may be reused only if it cannot have depended on the current path
// (an item on the path is a dead end) or on stock. Every sub-result therefore records the set of
// items it touched, and is reused only when none of them is on the new path (or, for planning,
// held in stock), and when no path cut from OUTSIDE its own subtree happened while computing it.
// The per-context caches assume `ctx.state` is not mutated after makeContext.
// ---------------------------------------------------------------------------------------------

type Path = Map<ItemId, number>
interface Tracker { touched: ItemId[]; cuts: ItemId[] }
const newTracker = (): Tracker => ({ touched: [], cuts: [] })

interface CostEntry { value: number; touched: ReadonlySet<ItemId> }
interface BrewEntry {
  ok: boolean; buys: ItemId[]; steps: number[]; gather: ItemId[]; blocked: ItemId[]; cost: number
  touched: ReadonlySet<ItemId>
  /** Stock units left (starting stock minus units already used) for each requested in-stock item when computed. */
  left: ReadonlyMap<ItemId, number>
  /** How often each in-stock item was requested anywhere in the sub-plan (all trials counted). */
  demand: ReadonlyMap<ItemId, number>
  /** Units of starting stock this sub-plan consumed. */
  used: ReadonlyMap<ItemId, number>
}
interface Caches {
  price: Map<ItemId, number | null>
  cost: Map<ItemId, CostEntry>
  brew: Map<string, Map<ItemId, BrewEntry[]>>   // keyed by the contents of `done` (tie-breaks) and of the stock
}
const caches = new WeakMap<PlanContext, Caches>()
function cachesOf(ctx: PlanContext): Caches {
  let c = caches.get(ctx)
  if (!c) caches.set(ctx, (c = { price: new Map(), cost: new Map(), brew: new Map() }))
  return c
}

/** The item's buy price when a reachable shop sells it; undefined otherwise. */
function shopPrice(ctx: PlanContext, item: ItemId): number | undefined {
  const c = cachesOf(ctx)
  let price = c.price.get(item)
  if (price === undefined) {
    price = reachableShops(ctx, item).length > 0 ? (ctx.index.item(item).buy ?? null) : null
    c.price.set(item, price)
  }
  return price === null ? undefined : price
}

const pathHits = (touched: ReadonlySet<ItemId>, path: Path): boolean => {
  for (const key of path.keys()) if (touched.has(key)) return true
  return false
}
/** True when a cut from outside the subtree that started at path depth `depth` happened. */
const externalCut = (tr: Tracker, from: number, path: Path): boolean => {
  for (let i = from; i < tr.cuts.length; i++) if (path.has(tr.cuts[i]!)) return true
  return false
}

// --- unit cost (stock-blind) -----------------------------------------------------------------

function costOf(ctx: PlanContext, item: ItemId, path: Path, tr: Tracker): number {
  const c = cachesOf(ctx)
  const t0 = tr.touched.length
  const c0 = tr.cuts.length
  tr.touched.push(item)
  if (path.has(item)) { tr.cuts.push(item); return Infinity }
  const price = shopPrice(ctx, item)
  if (price !== undefined) return price
  const cached = c.cost.get(item)
  if (cached && !pathHits(cached.touched, path)) {
    for (const i of cached.touched) tr.touched.push(i)
    return cached.value
  }
  path.set(item, path.size)
  let best = Infinity
  for (const recipe of ctx.index.recipesFor(item)) {
    if (!brewableInPot(ctx, recipe)) continue
    let sum = 0
    for (const ingredient of recipe.ingredients) {
      sum += costOf(ctx, ingredient, path, tr)
      if (sum === Infinity) break
    }
    if (sum < best) best = sum
  }
  path.delete(item)
  if (!externalCut(tr, c0, path)) c.cost.set(item, { value: best, touched: new Set(tr.touched.slice(t0)) })
  return best
}

/** Cheapest way to get one more unit with gold: its shop price, else its cheapest brewable recipe. Infinity if none. */
export function unitCost(ctx: PlanContext, item: ItemId): number {
  return costOf(ctx, item, new Map(), newTracker())
}

// --- planning ---------------------------------------------------------------------------------

interface State {
  used: Map<ItemId, number>      // units taken from the starting stock
  buys: ItemId[]                 // one entry per purchased unit
  steps: number[]                // recipe numbers in brew order, without the final recipe
  gather: Set<ItemId>
  blocked: Set<ItemId>
  /**
   * Gather/blocked items found by the sub-plan currently being computed, including ones already in `gather`/`blocked`.
   * `brew` starts each sub-plan with empty sets, so they hold exactly that sub-plan's own findings (bounded by
   * the number of distinct items); they are folded back into the caller's sets when it finishes.
   */
  foundGather: Set<ItemId>
  foundBlocked: Set<ItemId>
  cost: number
}
const emptyState = (): State => ({ used: new Map(), buys: [], steps: [], gather: new Set(), blocked: new Set(), foundGather: new Set(), foundBlocked: new Set(), cost: 0 })
const addGather = (s: State, item: ItemId): void => { s.gather.add(item); s.foundGather.add(item) }
const addBlocked = (s: State, item: ItemId): void => { s.blocked.add(item); s.foundBlocked.add(item) }
const cloneState = (s: State): State => ({
  used: new Map(s.used), buys: s.buys.slice(), steps: s.steps.slice(),
  gather: new Set(s.gather), blocked: new Set(s.blocked),
  foundGather: new Set(s.foundGather), foundBlocked: new Set(s.foundBlocked), cost: s.cost,
})

/** What a sub-plan looked at, for deciding whether its result can be reused. `item` itself is not included. */
interface Frame { touched: Set<ItemId>; demand: Map<ItemId, number>; cuts: ItemId[] }
const newFrame = (): Frame => ({ touched: new Set(), demand: new Map(), cuts: [] })
function mergeInto(parent: Frame, touched: Iterable<ItemId>, demand: ReadonlyMap<ItemId, number>): void {
  for (const i of touched) parent.touched.add(i)
  for (const [i, n] of demand) parent.demand.set(i, (parent.demand.get(i) ?? 0) + n)
}

interface Run {
  ctx: PlanContext
  stock: Readonly<Record<ItemId, number>>
  done: ReadonlySet<number>
  memo: Map<ItemId, BrewEntry[]>
}

const leftOf = (run: Run, s: State, item: ItemId): number => (run.stock[item] ?? 0) - (s.used.get(item) ?? 0)

/**
 * A cached sub-plan is valid when every in-stock item it requested has the same number of units left,
 * or enough left, both then and now, to cover every request (so stock never ran out in any trial).
 */
function stockMatches(run: Run, s: State, entry: BrewEntry): boolean {
  for (const [item, wanted] of entry.demand) {
    const now = leftOf(run, s, item)
    const then = entry.left.get(item) ?? 0
    if (now !== then && !(now >= wanted && then >= wanted)) return false
  }
  return true
}

function acquire(run: Run, s: State, item: ItemId, path: Path, frame: Frame): boolean {
  frame.touched.add(item)
  if ((run.stock[item] ?? 0) > 0) frame.demand.set(item, (frame.demand.get(item) ?? 0) + 1)
  if (leftOf(run, s, item) > 0) { s.used.set(item, (s.used.get(item) ?? 0) + 1); return true }
  const price = shopPrice(run.ctx, item)
  if (price !== undefined) { s.buys.push(item); s.cost += price; return true }
  return brew(run, s, item, path, frame)
}

/** Sub-plans cached per item; several are kept because stock-dependent ones differ by what was already used. */
const MAX_ENTRIES_PER_ITEM = 12

interface Trial { recipe: Recipe; state: State }

/** Plans a brew of `item` against what is left of the stock; true when it succeeds. */
function brew(run: Run, s: State, item: ItemId, path: Path, parent: Frame): boolean {
  const { ctx, done } = run
  const onPath = path.has(item)
  const entry = onPath ? undefined : run.memo.get(item)?.find((e) => !pathHits(e.touched, path) && stockMatches(run, s, e))
  if (entry) {
    mergeInto(parent, entry.touched, entry.demand)
    s.buys.push(...entry.buys)
    s.steps.push(...entry.steps)
    for (const i of entry.gather) addGather(s, i)
    for (const i of entry.blocked) addBlocked(s, i)
    s.cost += entry.cost
    for (const [i, n] of entry.used) s.used.set(i, (s.used.get(i) ?? 0) + n)
    return entry.ok
  }

  const frame = newFrame()
  const before = { used: new Map(s.used), buys: s.buys.length, steps: s.steps.length, cost: s.cost }
  const outer = { gather: s.foundGather, blocked: s.foundBlocked }
  s.foundGather = new Set()
  s.foundBlocked = new Set()
  const successes: Trial[] = []
  const failures: Trial[] = []
  if (onPath) frame.cuts.push(item)
  else {
    path.set(item, path.size)
    for (const recipe of ctx.index.recipesFor(item)) {
      if (!brewableInPot(ctx, recipe)) continue
      const trial = cloneState(s)
      let ok = true
      for (const ingredient of recipe.ingredients) ok = acquire(run, trial, ingredient, path, frame) && ok
      if (ok) { trial.steps.push(recipe.recipeIndex); successes.push({ recipe, state: trial }) }
      else failures.push({ recipe, state: trial })
    }
    path.delete(item)
  }

  const ties = (a: Recipe, b: Recipe): number =>
    done.has(a.recipeIndex) !== done.has(b.recipeIndex) ? (done.has(a.recipeIndex) ? 1 : -1) : a.recipeIndex - b.recipeIndex
  let ok = false
  if (successes.length > 0) {
    const best = successes.reduce((x, y) => ((y.state.cost - x.state.cost) || ties(y.recipe, x.recipe)) < 0 ? y : x)
    Object.assign(s, best.state)
    ok = true
  } else if (reachableSources(ctx, item).length > 0) {
    addGather(s, item)
  } else if (failures.length === 0) {
    addBlocked(s, item)
  } else {
    // Report the best failed attempt: one that is merely missing gatherable items beats one that is blocked.
    const rank = (t: Trial) => (t.state.foundBlocked.size > 0 ? 1 : 0)
    const best = failures.reduce((x, y) => (rank(y) - rank(x) || ties(y.recipe, x.recipe)) < 0 ? y : x)
    s.gather = best.state.gather
    s.blocked = best.state.blocked
    s.foundGather = best.state.foundGather
    s.foundBlocked = best.state.foundBlocked
  }

  // A cut from outside this sub-plan (an ancestor on the path) makes the result path-dependent.
  if (!frame.cuts.some((z) => path.has(z))) {
    const left = new Map<ItemId, number>()
    for (const i of frame.demand.keys()) left.set(i, (run.stock[i] ?? 0) - (before.used.get(i) ?? 0))
    const used = new Map<ItemId, number>()
    for (const [i, n] of s.used) if (n > (before.used.get(i) ?? 0)) used.set(i, n - (before.used.get(i) ?? 0))
    let entries = run.memo.get(item)
    if (!entries) run.memo.set(item, (entries = []))
    if (entries.length >= MAX_ENTRIES_PER_ITEM) entries.shift()
    entries.push({
      ok, buys: s.buys.slice(before.buys), steps: s.steps.slice(before.steps), cost: s.cost - before.cost,
      // The sub-plan's own findings, not a diff against the state: a replay must carry what was missing.
      gather: [...s.foundGather],
      blocked: [...s.foundBlocked],
      touched: frame.touched, demand: frame.demand, left, used,
    })
  }
  for (const i of s.foundGather) outer.gather.add(i)
  for (const i of s.foundBlocked) outer.blocked.add(i)
  s.foundGather = outer.gather
  s.foundBlocked = outer.blocked
  mergeInto(parent, frame.touched, frame.demand)
  parent.cuts.push(...frame.cuts)
  return ok
}

const byItem = (a: ItemId, b: ItemId) => (a < b ? -1 : a > b ? 1 : 0)

/** Cached sub-plans depend on the starting stock and on `done`, so the cache is keyed by their contents. */
function brewMemo(ctx: PlanContext, stock: Readonly<Record<ItemId, number>>, done: ReadonlySet<number>): Map<ItemId, BrewEntry[]> {
  const c = cachesOf(ctx)
  const held = Object.keys(stock).filter((i) => (stock[i] ?? 0) > 0).sort(byItem).map((i) => `${i}=${stock[i]}`)
  const key = `${[...done].sort((a, b) => a - b).join(',')}|${held.join(',')}`
  let memo = c.brew.get(key)
  if (!memo) {
    if (c.brew.size >= 16) c.brew.clear()
    c.brew.set(key, (memo = new Map()))
  }
  return memo
}

/** Plans one recipe against `stock` without mutating it. `done` = recipes already completed in this pass. */
export function planRecipe(
  ctx: PlanContext, recipe: Recipe, stock: Readonly<Record<ItemId, number>>, done: ReadonlySet<number>,
): RecipePlan {
  const base: RecipePlan = {
    recipe: recipe.recipeIndex, status: 'later', cost: Infinity, steps: [], purchases: [], gather: [], blockedBy: [],
  }
  if (!brewableInPot(ctx, recipe)) return base

  const run: Run = { ctx, stock, done, memo: brewMemo(ctx, stock, done) }
  const s = emptyState()
  const frame = newFrame()
  const unmet: ItemId[] = []
  for (const ingredient of recipe.ingredients) {
    if (!acquire(run, s, ingredient, new Map(), frame)) unmet.push(ingredient)
  }
  // Invariant: a failed ingredient can never yield a ready/buy/chain plan, even if nothing was recorded as missing.
  if (unmet.length > 0 && s.blocked.size === 0 && s.gather.size === 0) {
    return { ...base, status: 'blocked', blockedBy: [...new Set(unmet)].sort(byItem) }
  }

  if (s.blocked.size > 0) return { ...base, status: 'blocked', blockedBy: [...s.blocked].sort(byItem) }
  if (s.gather.size > 0) {
    return {
      ...base,
      status: 'gather',
      gather: [...s.gather].sort(byItem).map((item) => ({ item, sources: reachableSources(ctx, item) })),
    }
  }

  const seen = new Set<number>([recipe.recipeIndex])
  const steps: BrewStep[] = s.steps.map((n) => {
    const step = { recipe: n, mandatory: !done.has(n) && !seen.has(n) }
    seen.add(n)
    return step
  })
  steps.push({ recipe: recipe.recipeIndex, mandatory: true })

  const counts = new Map<ItemId, number>()
  for (const item of s.buys) counts.set(item, (counts.get(item) ?? 0) + 1)
  const purchases: Purchase[] = [...counts.keys()].sort(byItem).map((item) => ({
    item, qty: counts.get(item)!, unitPrice: shopPrice(ctx, item)!,
  }))
  const status = steps.length > 1 ? 'chain' : purchases.length > 0 ? 'buy' : 'ready'
  return { ...base, status, cost: s.cost, steps, purchases }
}

/** One plan per recipe, ascending; completed recipes (and the one in the pot) are `done`. */
export function planAll(ctx: PlanContext): RecipePlan[] {
  const stock = stockOf(ctx.state)
  const recipes = [...ctx.index.data.recipes].sort((a, b) => a.recipeIndex - b.recipeIndex)
  const done = new Set<number>(recipes.filter((r) => isCompleted(ctx.state, r.recipeIndex)).map((r) => r.recipeIndex))
  return recipes.map((recipe) =>
    done.has(recipe.recipeIndex)
      ? { recipe: recipe.recipeIndex, status: 'done', cost: Infinity, steps: [], purchases: [], gather: [], blockedBy: [] }
      : planRecipe(ctx, recipe, stock, done))
}
