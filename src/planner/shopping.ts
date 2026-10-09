import type { ItemId, LocationId, Shop } from '../data/types'
import { reachableShops, type PlanContext } from './context'
import type { Purchase, Queue, ShoppingGroup, ShoppingList } from './types'

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const costOf = (purchases: Purchase[]) => purchases.reduce((sum, p) => sum + p.qty * p.unitPrice, 0)

/** Purchases of the queue entries that the gold covers, grouped by location, each item at exactly one shop. */
export function shoppingList(ctx: PlanContext, queue: Queue, opts: { everything: boolean }): ShoppingList {
  const { index, state } = ctx
  const gold = opts.everything ? null : state.gold

  const merged = new Map<ItemId, { qty: number; unitPrice: number }>()
  let total = 0
  let entriesCovered = 0
  for (const entry of queue.entries) {
    const cost = costOf(entry.purchases)
    if (gold !== null && total + cost > gold) break
    total += cost
    entriesCovered++
    for (const p of entry.purchases) {
      const line = merged.get(p.item)
      if (line) line.qty += p.qty
      else merged.set(p.item, { qty: p.qty, unitPrice: p.unitPrice })
    }
  }

  const items = [...merged.keys()].sort(byText)
  const candidates = new Map<ItemId, Shop[]>()
  for (const item of items) {
    const shops = reachableShops(ctx, item)
    candidates.set(item, shops.length > 0 ? shops : index.shopsSelling(item))
  }

  const lineCount = new Map<LocationId, number>()
  const chosen = new Map<ItemId, Shop>()
  const place = (item: ItemId, shop: Shop) => {
    chosen.set(item, shop)
    lineCount.set(shop.location, (lineCount.get(shop.location) ?? 0) + 1)
  }
  for (const item of items) {
    const shops = candidates.get(item)!
    if (shops.length === 1) place(item, shops[0]!)
  }
  for (const item of items) {
    const shops = candidates.get(item)!
    if (shops.length < 2) continue
    const rank = (shop: Shop) => index.stageRank(index.location(shop.location).stage)
    const best = [...shops].sort((a, b) =>
      (lineCount.get(b.location) ?? 0) - (lineCount.get(a.location) ?? 0) || rank(a) - rank(b) || byText(a.id, b.id))[0]!
    place(item, best)
  }

  const byLocation = new Map<LocationId, ShoppingGroup>()
  for (const item of items) {
    const shop = chosen.get(item)
    if (!shop) continue
    const { qty, unitPrice } = merged.get(item)!
    let group = byLocation.get(shop.location)
    if (!group) byLocation.set(shop.location, (group = { location: shop.location, lines: [], subtotal: 0 }))
    group.lines.push({ item, qty, unitPrice, shop })
    group.subtotal += qty * unitPrice
  }
  const rankOf = (g: ShoppingGroup) => index.stageRank(index.location(g.location).stage)
  const groups = [...byLocation.values()].sort((a, b) => rankOf(a) - rankOf(b) || byText(a.location, b.location))
  return { groups, total, affordable: entriesCovered === queue.entries.length, entriesCovered }
}
