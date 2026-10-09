import type { ItemId, StageId } from '../data/types'
export interface AppState {
  version: 1
  inventory: Record<ItemId, number>
  equipped: Record<ItemId, number>
  gold: number | null
  potLevel: 0 | 1 | 2 | 3
  pot: { recipe: number | null; result: ItemId; ingredients: ItemId[] } | null
  completed: number[]               // recipe numbers, ascending
  brews: { basic: number; improved: number }
  stage: StageId
  /** Dodgy Dave: one flag per request in `goals.dave`, and the request he is asking for now. */
  dave: { done: boolean[]; next: number }
  collected: string[]
  lastImport: { at: string; source: 'upload' | 'url'; hash: string; playTimeFrames: number } | null
  settings: { showSpoilers: boolean; saveUrl: string; autoImport: boolean }
}
/**
 * What a parsed save says. `collected` holds the scarce sources the save shows as taken (of those that have a save
 * sign in the data), `stage` the latest stage it proves, and `unknownItems` the number of item slots skipped
 * because the data has no item with their id.
 */
export type SnapshotPatch = Pick<AppState,
  'inventory' | 'equipped' | 'gold' | 'potLevel' | 'pot' | 'completed' | 'brews' | 'dave' | 'collected'>
  & { stage: StageId; unknownItems: number }
export type Action =
  | { type: 'adjustItem'; item: ItemId; delta: number }
  | { type: 'setGold'; gold: number | null }
  | { type: 'setStage'; stage: StageId }
  | { type: 'setPotLevel'; level: 0 | 1 | 2 | 3 }
  | { type: 'toggleCompleted'; recipe: number }
  | { type: 'toggleCollected'; sourceId: string }
  | { type: 'daveHandIn' }
  | { type: 'toggleDave'; request: number }
  | { type: 'setDaveNext'; request: number }
  | { type: 'buy'; item: ItemId; qty: number }
  | { type: 'collectPot' }
  | { type: 'brew'; recipe: number }
  | { type: 'applySnapshot'; patch: SnapshotPatch; source: 'upload' | 'url'; hash: string; playTimeFrames: number; at: string }
  | { type: 'importState'; state: AppState }
  | { type: 'setSetting'; key: 'showSpoilers' | 'saveUrl' | 'autoImport'; value: boolean | string }
  | { type: 'reset' }
export interface ReduceResult { state: AppState; error?: string }
