import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { DataIndex, ItemId, Shop as ShopData } from '../../data/types'
import { buildQueue, makeContext, shoppingList, totalNeed } from '../../planner'
import type { ShoppingGroup, ShoppingLine } from '../../planner'
import { useStore } from '../store'

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

/** Runs one planner call on its own, so a failure costs only the section that needs it. */
function attempt<T>(run: () => T): Attempt<T> {
  try {
    return { ok: true, value: run() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const nameOf = (index: DataIndex, id: ItemId) => (index.hasItem(id) ? index.item(id).name : id)
function nameOfLocation(index: DataIndex, id: string): string {
  try {
    return index.location(id).name
  } catch {
    return id
  }
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** A rough gold figure: three significant digits, with thousands separators ("744,000"). */
const roughGold = (gold: number) => Number(gold.toPrecision(3)).toLocaleString('en-US')

const TIME_LABELS: Record<NonNullable<ShopData['timeOfDay']>, string> = { day: 'day only', night: 'night only' }

/** A location's lines split by shop, keeping the planner's order. */
function byShop(group: ShoppingGroup): { shop: ShopData; lines: ShoppingLine[] }[] {
  const shops = new Map<string, { shop: ShopData; lines: ShoppingLine[] }>()
  for (const line of group.lines) {
    const entry = shops.get(line.shop.id) ?? { shop: line.shop, lines: [] }
    entry.lines.push(line)
    shops.set(line.shop.id, entry)
  }
  return [...shops.values()]
}

export function Shop(): JSX.Element {
  const { state, index, dispatch } = useStore()
  const [everything, setEverything] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ctx = useMemo(() => makeContext(index, state), [index, state])
  const queue = useMemo(() => attempt(() => buildQueue(ctx)), [ctx])
  const need = useMemo(() => attempt(() => totalNeed(index, state)), [index, state])
  const list = useMemo(
    () => (queue.ok ? attempt(() => shoppingList(ctx, queue.value, { everything })) : null),
    [ctx, queue, everything],
  )

  const buy = (lines: ShoppingLine[]) => {
    setError(null)
    for (const line of lines) {
      const problem = dispatch({ type: 'buy', item: line.item, qty: line.qty })
      if (problem !== undefined) { setError(problem); return }
    }
  }

  const queued = queue.ok ? queue.value.entries : []
  const needsPurchases = queued.some((entry) => entry.purchases.length > 0)

  return (
    <div class="tab">
      <h1>Shop</h1>

      <label class="check">
        <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.currentTarget.checked)} />
        <span>Everything reachable</span>
      </label>
      <p class="meta">Off: only what your gold covers, in queue order.</p>

      {!queue.ok && <p class="error" role="alert">Couldn't work out the queue, so there is no shopping list: {queue.error}</p>}
      {list && !list.ok && <p class="error" role="alert">Couldn't work out the shopping list: {list.error}</p>}
      {error !== null && <p class="error" role="alert">{error}</p>}

      {list?.ok && list.value.groups.length > 0 && (
        <>
          <p class="total">
            {`Total: ${list.value.total} g · `}
            {state.gold === null ? 'Gold unknown' : `You have ${state.gold} g`}
          </p>
          {!list.value.affordable && (
            <p class="meta">
              Your gold covers {list.value.entriesCovered} of {queued.length} queued brews. Turn on Everything reachable to see the rest.
            </p>
          )}
          {list.value.groups.map((group) => {
            const locationName = nameOfLocation(index, group.location)
            return (
              <section key={group.location} aria-labelledby={`shop-${group.location}`}>
                <div class="group-head">
                  <h2 id={`shop-${group.location}`}>{locationName}</h2>
                  <button type="button" aria-label={`Bought all here: ${locationName}`} onClick={() => buy(group.lines)}>
                    Bought all here
                  </button>
                </div>
                {byShop(group).map(({ shop, lines }) => (
                  <div key={shop.id}>
                    <h3 class="shop-name">{shop.name}</h3>
                    {shop.timeOfDay && <span class="chip chip-gather">{TIME_LABELS[shop.timeOfDay]}</span>}
                    <ul class="rows">
                      {lines.map((line) => (
                        <li class="row" key={line.item}>
                          <span class="row-main">
                            <span class="name">{nameOf(index, line.item)}</span>
                            <span class="meta">{`${line.qty} × ${line.unitPrice} g = ${line.qty * line.unitPrice} g`}</span>
                          </span>
                          <button
                            type="button"
                            aria-label={`Bought ${line.qty} ${nameOf(index, line.item)}`}
                            onClick={() => buy([line])}
                          >
                            Bought
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p class="meta">{`${locationName} subtotal: ${group.subtotal} g`}</p>
              </section>
            )
          })}
        </>
      )}

      {list?.ok && list.value.groups.length === 0 && (
        <p class="empty">{emptyReason(queued.length, needsPurchases, state.gold, everything)}</p>
      )}

      <section class="card" role="group" aria-label="Whole run">
        <h2>Whole run</h2>
        {need.ok ? (
          <>
            <p>
              {`Up to about ${roughGold(need.value.goldEstimate)} g if you buy everything shops sell. Also ${sum(Object.values(need.value.toGather))} items to gather and ${need.value.repeatBrews} repeat brews.`}
            </p>
            <p class="meta">An estimate with every shop and pot counted as available.</p>
          </>
        ) : (
          <p class="error" role="alert">Couldn't work out the whole-run estimate: {need.error}</p>
        )}
      </section>
    </div>
  )
}

function emptyReason(queued: number, needsPurchases: boolean, gold: number | null, everything: boolean): string {
  if (queued === 0) return 'Nothing is queued, so there is nothing to buy.'
  if (!needsPurchases) return 'Everything the queue needs is already in your bag.'
  if (!everything && gold === 0) return 'You have 0 gold, so nothing is affordable yet. Turn on Everything reachable to see what the queue needs.'
  return 'Your gold does not cover the next purchase. Turn on Everything reachable to see what the queue needs.'
}
