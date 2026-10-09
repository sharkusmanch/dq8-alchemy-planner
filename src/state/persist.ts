import type { DataIndex, ItemId } from '../data/types'
import { initialState } from './reducer'
import type { AppState } from './types'

export const STORAGE_KEY = 'dq8-alchemy-planner/state'
export const BACKUP_KEY = 'dq8-alchemy-planner/state.unreadable'

class StateFormatError extends Error {}

const fail = (message: string): never => {
  throw new StateFormatError(message)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

function field(obj: Record<string, unknown>, key: string): unknown {
  return obj[key]
}

function stockOf(value: unknown, what: string, index: DataIndex): Record<ItemId, number> {
  if (!isRecord(value)) return fail(`${what} is not a list of items`)
  const stock: Record<ItemId, number> = {}
  for (const [item, qty] of Object.entries(value)) {
    if (!isCount(qty)) return fail(`${what} has an invalid quantity`)
    if (qty > 0 && index.hasItem(item)) stock[item] = qty
  }
  return stock
}

function knownRecipe(index: DataIndex, recipe: number): boolean {
  try {
    index.recipe(recipe)
    return true
  } catch {
    return false
  }
}

function potOf(value: unknown, index: DataIndex): AppState['pot'] {
  if (value === null) return null
  if (!isRecord(value)) return fail('pot is invalid')
  const { recipe, result, ingredients } = value
  if (recipe !== null && !isCount(recipe)) return fail('pot recipe is invalid')
  if (typeof result !== 'string') return fail('pot result is invalid')
  if (!Array.isArray(ingredients) || ingredients.some((i) => typeof i !== 'string')) {
    return fail('pot ingredients are invalid')
  }
  // A pot whose items no longer exist cannot be shown faithfully; drop it whole rather than half of it.
  if (!index.hasItem(result) || (ingredients as string[]).some((i) => !index.hasItem(i))) return null
  return {
    recipe: recipe !== null && knownRecipe(index, recipe) ? recipe : null,
    result,
    ingredients: [...(ingredients as string[])],
  }
}

/**
 * Dodgy Dave's progress, fitted to the `count` requests the data has. A state stored before the flags existed
 * holds `daveDone`, the number of requests done in order: its first flags are set and Dave wants the next one.
 */
function daveOf(raw: Record<string, unknown>, count: number): AppState['dave'] {
  const invalid = 'Dodgy Dave progress is invalid'
  const stored = field(raw, 'dave')
  if (stored === undefined) {
    const daveDone = field(raw, 'daveDone')
    if (!isCount(daveDone)) return fail(invalid)
    return { done: Array.from({ length: count }, (_, k) => k < daveDone), next: daveDone < count ? daveDone : 0 }
  }
  if (!isRecord(stored) || !Array.isArray(stored.done) || !isCount(stored.next)) return fail(invalid)
  const flags: unknown[] = stored.done
  if (flags.some((flag) => typeof flag !== 'boolean')) return fail(invalid)
  return { done: Array.from({ length: count }, (_, k) => flags[k] === true), next: stored.next < count ? stored.next : 0 }
}

/** Validates parsed JSON as an AppState, dropping data that no longer exists. Throws StateFormatError. */
function validate(raw: unknown, index: DataIndex): AppState {
  if (!isRecord(raw)) return fail("That isn't a planner state")
  if (!('version' in raw)) return fail("That isn't a planner state")
  if (raw.version !== 1) return fail(`Unsupported state version: ${String(raw.version)}`)

  const gold = field(raw, 'gold')
  if (gold !== null && !isCount(gold)) return fail('gold is invalid')
  const potLevel = field(raw, 'potLevel')
  if (potLevel !== 0 && potLevel !== 1 && potLevel !== 2 && potLevel !== 3) return fail('pot level is invalid')

  const completedRaw = field(raw, 'completed')
  if (!Array.isArray(completedRaw) || !completedRaw.every(isCount)) return fail('completed recipes are invalid')
  const completed = [...new Set(completedRaw as number[])].sort((a, b) => a - b)

  const brews = field(raw, 'brews')
  if (!isRecord(brews) || !isCount(brews.basic) || !isCount(brews.improved)) return fail('brew counts are invalid')

  const stage = field(raw, 'stage')
  if (typeof stage !== 'string') return fail('stage is invalid')
  let knownStage = false
  try {
    index.stageRank(stage)
    knownStage = true
  } catch { /* unknown stage falls back below */ }

  const dave = daveOf(raw, index.data.goals.dave.length)

  const collected = field(raw, 'collected')
  if (!Array.isArray(collected) || collected.some((id) => typeof id !== 'string')) return fail('collected sources are invalid')

  const lastImport = field(raw, 'lastImport')
  let lastImportOut: AppState['lastImport'] = null
  if (lastImport !== null) {
    if (
      !isRecord(lastImport) || typeof lastImport.at !== 'string' || typeof lastImport.hash !== 'string' ||
      (lastImport.source !== 'upload' && lastImport.source !== 'url') || !isCount(lastImport.playTimeFrames)
    ) return fail('last import is invalid')
    lastImportOut = {
      at: lastImport.at, source: lastImport.source, hash: lastImport.hash, playTimeFrames: lastImport.playTimeFrames,
    }
  }

  const settings = field(raw, 'settings')
  if (!isRecord(settings) || typeof settings.showSpoilers !== 'boolean' || typeof settings.saveUrl !== 'string') {
    return fail('settings are invalid')
  }

  return {
    version: 1,
    inventory: stockOf(field(raw, 'inventory'), 'inventory', index),
    equipped: stockOf(field(raw, 'equipped'), 'equipped', index),
    gold,
    potLevel,
    pot: potOf(field(raw, 'pot'), index),
    completed,
    brews: { basic: brews.basic, improved: brews.improved },
    stage: knownStage ? stage : (index.data.stages[0]?.id ?? ''),
    dave,
    collected: [...(collected as string[])],
    lastImport: lastImportOut,
    settings: { showSpoilers: settings.showSpoilers, saveUrl: settings.saveUrl },
  }
}

function parse(json: string, index: DataIndex): AppState {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return fail("That isn't valid JSON")
  }
  return validate(raw, index)
}

export function loadState(storage: Storage, index: DataIndex): AppState {
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return initialState(index) // blocked storage
  }
  if (raw === null) return initialState(index)
  try {
    return parse(raw, index)
  } catch (error) {
    if (!(error instanceof StateFormatError)) throw error
    try {
      storage.setItem(BACKUP_KEY, raw)
    } catch { /* saveState refuses to overwrite an unreadable blob it cannot back up */ }
    return initialState(index)
  }
}

/** True when the string parses as an object with `version === 1` (the shape is checked on load). */
function looksReadable(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) && value.version === 1
  } catch {
    return false
  }
}

/**
 * Best effort: a full or blocked storage must not take the app down.
 * An unreadable value under STORAGE_KEY is never overwritten unless it is safe under BACKUP_KEY first.
 */
export function saveState(storage: Storage, state: AppState): void {
  try {
    const existing = storage.getItem(STORAGE_KEY)
    if (existing !== null && !looksReadable(existing) && storage.getItem(BACKUP_KEY) !== existing) {
      storage.setItem(BACKUP_KEY, existing) // throws -> skip the write below, keeping the only copy
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore quota / privacy-mode errors */ }
}

export function exportState(state: AppState): string {
  return JSON.stringify({ ...state, settings: { ...state.settings, saveUrl: '' } }, null, 2)
}

export function parseImportedState(json: string, index: DataIndex): AppState {
  try {
    return parse(json, index)
  } catch (error) {
    if (error instanceof StateFormatError) throw new Error(error.message)
    throw error
  }
}
