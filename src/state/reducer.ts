import type { DataIndex, ItemId, Recipe } from '../data/types'
import { hasSaveSign } from './snapshot'
import type { Action, AppState, ReduceResult } from './types'

export function initialState(index: DataIndex): AppState {
  return {
    version: 1,
    inventory: {},
    equipped: {},
    gold: null,
    potLevel: 0,
    pot: null,
    completed: [],
    brews: { basic: 0, improved: 0 },
    stage: index.data.stages[0]?.id ?? '',
    dave: { done: index.data.goals.dave.map(() => false), next: 0 },
    collected: [],
    lastImport: null,
    settings: { showSpoilers: false, saveUrl: '' },
  }
}

const reject = (state: AppState, error: string): ReduceResult => ({ state, error })
const ok = (state: AppState): ReduceResult => ({ state })

/** Copy of a stock record with `delta` applied; never below zero, zero entries removed. */
function withDelta(stock: Record<ItemId, number>, item: ItemId, delta: number): Record<ItemId, number> {
  const next = { ...stock }
  const count = Math.max(0, (next[item] ?? 0) + delta)
  if (count === 0) delete next[item]
  else next[item] = count
  return next
}

function countOf(items: readonly ItemId[]): Map<ItemId, number> {
  const counts = new Map<ItemId, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

/** `completed` with `recipe` added: ascending, each recipe once. The same array when nothing changes. */
function withCompleted(completed: number[], recipe: number | null): number[] {
  if (recipe === null || completed.includes(recipe)) return completed
  return [...completed, recipe].sort((a, b) => a - b)
}

/** The pot's result goes to stock, and the recipe it held (when it matches one) is completed. */
function collectPot(state: AppState): AppState {
  if (!state.pot) return state
  return {
    ...state,
    inventory: withDelta(state.inventory, state.pot.result, 1),
    completed: withCompleted(state.completed, state.pot.recipe),
    pot: null,
  }
}

function findRecipe(index: DataIndex, recipe: number): Recipe | undefined {
  try {
    return index.recipe(recipe)
  } catch {
    return undefined
  }
}

function isRequest(index: DataIndex, request: number): boolean {
  return Number.isInteger(request) && request >= 0 && request < index.data.goals.dave.length
}

function stageRankOrNone(index: DataIndex, stage: string): number {
  try {
    return index.stageRank(stage)
  } catch {
    return -1
  }
}

function brew(state: AppState, recipeNumber: number, index: DataIndex): ReduceResult {
  const recipe = findRecipe(index, recipeNumber)
  if (!recipe) return reject(state, `Unknown recipe ${recipeNumber}`)
  if (state.potLevel === 0) return reject(state, "You don't have the alchemy pot yet")
  if (recipe.ingredients.length > 2 && state.potLevel < 2) {
    return reject(state, 'This recipe needs the improved pot')
  }

  // The pot's pending result counts as stock; it is only actually collected once the brew is accepted.
  const collected = collectPot(state)
  const available = collected.inventory
  const missing: string[] = []
  for (const [item, need] of countOf(recipe.ingredients)) {
    const have = available[item] ?? 0
    if (have < need) missing.push(`${need - have} × ${index.item(item).name}`)
  }
  if (missing.length > 0) return reject(state, `Missing ingredients: ${missing.join(', ')}`)

  let inventory = available
  for (const ingredient of recipe.ingredients) inventory = withDelta(inventory, ingredient, -1)

  const instant = state.potLevel === 3
  if (instant) inventory = withDelta(inventory, recipe.result, 1)
  const brews = instant
    ? state.brews
    : state.potLevel === 1
      ? { ...state.brews, basic: state.brews.basic + 1 }
      : { ...state.brews, improved: state.brews.improved + 1 }
  const completed = withCompleted(collected.completed, recipeNumber)

  return ok({
    ...state,
    inventory,
    completed,
    brews,
    pot: instant ? null : { recipe: recipeNumber, result: recipe.result, ingredients: [...recipe.ingredients] },
  })
}

export function reduce(state: AppState, action: Action, index: DataIndex): ReduceResult {
  switch (action.type) {
    case 'adjustItem': {
      if (!index.hasItem(action.item)) return reject(state, `Unknown item: ${action.item}`)
      const inventory = withDelta(state.inventory, action.item, action.delta)
      if ((inventory[action.item] ?? 0) === (state.inventory[action.item] ?? 0)) return ok(state)
      return ok({ ...state, inventory })
    }

    case 'setGold': {
      const gold = action.gold === null ? null : Math.max(0, Math.floor(action.gold))
      if (gold !== null && !Number.isFinite(gold)) return reject(state, 'Gold must be a number')
      return gold === state.gold ? ok(state) : ok({ ...state, gold })
    }

    case 'setStage': {
      if (stageRankOrNone(index, action.stage) < 0) return reject(state, `Unknown stage: ${action.stage}`)
      return action.stage === state.stage ? ok(state) : ok({ ...state, stage: action.stage })
    }

    case 'setPotLevel':
      return action.level === state.potLevel ? ok(state) : ok({ ...state, potLevel: action.level })

    case 'toggleCompleted': {
      const completed = state.completed.includes(action.recipe)
        ? state.completed.filter((n) => n !== action.recipe)
        : [...state.completed, action.recipe].sort((a, b) => a - b)
      return ok({ ...state, completed })
    }

    case 'toggleCollected': {
      const collected = state.collected.includes(action.sourceId)
        ? state.collected.filter((id) => id !== action.sourceId)
        : [...state.collected, action.sourceId]
      return ok({ ...state, collected })
    }

    case 'daveHandIn': {
      const requests = index.data.goals.dave
      const { done, next } = state.dave
      const request = requests[next]
      if (!request || requests.every((_, k) => done[k] === true)) {
        return reject(state, 'All of Dodgy Dave\'s requests are done')
      }
      if ((state.inventory[request.item] ?? 0) < 1) {
        return reject(state, `You need ${index.item(request.item).name} in stock to hand in`)
      }
      return ok({
        ...state,
        inventory: withDelta(state.inventory, request.item, -1),
        dave: { done: requests.map((_, k) => k === next || done[k] === true), next: (next + 1) % requests.length },
      })
    }

    case 'toggleDave': {
      const requests = index.data.goals.dave
      if (!isRequest(index, action.request)) return reject(state, `Unknown Dodgy Dave request: ${action.request}`)
      const done = requests.map((_, k) => (state.dave.done[k] === true) !== (k === action.request))
      return ok({ ...state, dave: { ...state.dave, done } })
    }

    case 'setDaveNext': {
      if (!isRequest(index, action.request)) return reject(state, `Unknown Dodgy Dave request: ${action.request}`)
      return action.request === state.dave.next ? ok(state) : ok({ ...state, dave: { ...state.dave, next: action.request } })
    }

    case 'buy': {
      if (!index.hasItem(action.item)) return reject(state, `Unknown item: ${action.item}`)
      if (!Number.isInteger(action.qty) || action.qty < 1) return reject(state, 'Quantity must be at least 1')
      const price = index.item(action.item).buy
      const gold = state.gold !== null && price !== undefined
        ? Math.max(0, state.gold - action.qty * price)
        : state.gold
      return ok({ ...state, inventory: withDelta(state.inventory, action.item, action.qty), gold })
    }

    case 'collectPot':
      return state.pot ? ok(collectPot(state)) : ok(state)

    case 'brew':
      return brew(state, action.recipe, index)

    case 'applySnapshot': {
      const { patch } = action
      const advance = stageRankOrNone(index, patch.stage) > stageRankOrNone(index, state.stage)
      // A source with a save sign takes its tick from the save, like the bag; only a tick on a source the save
      // cannot speak for is the player's to keep.
      const signed = new Set(
        index.data.goals.scarce.flatMap((entry) => entry.sources.filter(hasSaveSign).map((source) => source.id)),
      )
      const byHand = state.collected.filter((id) => !signed.has(id) && !patch.collected.includes(id))
      return ok({
        ...state,
        inventory: patch.inventory,
        equipped: patch.equipped,
        gold: patch.gold,
        potLevel: patch.potLevel,
        pot: patch.pot,
        completed: patch.completed,
        brews: patch.brews,
        dave: patch.dave,
        collected: [...byHand, ...patch.collected],
        stage: advance ? patch.stage : state.stage,
        lastImport: { at: action.at, source: action.source, hash: action.hash, playTimeFrames: action.playTimeFrames },
      })
    }

    case 'importState':
      return ok(action.state)

    case 'setSetting': {
      if (action.key === 'showSpoilers') {
        if (typeof action.value !== 'boolean') return reject(state, 'showSpoilers must be true or false')
        if (action.value === state.settings.showSpoilers) return ok(state)
        return ok({ ...state, settings: { ...state.settings, showSpoilers: action.value } })
      }
      if (typeof action.value !== 'string') return reject(state, 'saveUrl must be text')
      if (action.value === state.settings.saveUrl) return ok(state)
      return ok({ ...state, settings: { ...state.settings, saveUrl: action.value } })
    }

    case 'reset':
      return ok(initialState(index))
  }
}
