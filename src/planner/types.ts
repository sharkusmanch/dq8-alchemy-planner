import type { ItemId, Source, Shop, LocationId } from '../data/types'
export type RecipeStatus = 'done' | 'ready' | 'buy' | 'chain' | 'gather' | 'blocked' | 'later'
export interface Purchase { item: ItemId; qty: number; unitPrice: number }
export interface BrewStep { recipe: number; mandatory: boolean }
export interface RecipePlan {
  recipe: number
  status: RecipeStatus
  cost: number                       // gold for purchases; 0 when none; Infinity for gather/blocked/later
  steps: BrewStep[]                  // intermediates first, the recipe itself last; empty unless ready/buy/chain
  purchases: Purchase[]              // merged by item, ascending item id
  gather: { item: ItemId; sources: Source[] }[]
  blockedBy: ItemId[]
}
export type QueueReason = 'no-pot' | 'all-done' | 'nothing-reachable'
export interface Queue { entries: RecipePlan[]; gather: RecipePlan[]; blocked: number; later: number; reason?: QueueReason }
export interface NeedReport { toBuy: Record<ItemId, number>; toGather: Record<ItemId, number>; repeatBrews: number; goldEstimate: number }
export interface ScarceReport {
  item: ItemId; inStock: number; needed: number; uncollected: number; atRisk: boolean; gap: number
  farmable: Source[]                 // the item's monster drops (normal and rare): a gap these can fill is not an alarm
}
export interface FillerSuggestion { recipe: number; unitCost: number; purchases: Purchase[]; remaining: number; counter: 'basic' | 'improved'; urgent: boolean }
export interface ShoppingLine { item: ItemId; qty: number; unitPrice: number; shop: Shop }
export interface ShoppingGroup { location: LocationId; lines: ShoppingLine[]; subtotal: number }
export interface ShoppingList { groups: ShoppingGroup[]; total: number; affordable: boolean; entriesCovered: number }
