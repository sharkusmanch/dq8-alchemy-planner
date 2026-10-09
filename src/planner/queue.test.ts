import { describe, expect, it } from 'vitest'
import { data } from '../data'
import { createIndex } from '../data/create-index'
import { initialState, reduce } from '../state/reducer'
import type { AppState } from '../state/types'
import { miniData, miniState } from '../testing/mini'
import { makeContext } from './context'
import { applyPlan, buildQueue, buildQueueWith } from './queue'
import type { Queue } from './types'

const index = createIndex(miniData)
const queueFor = (overrides: Partial<AppState> = {}) => buildQueue(makeContext(index, miniState(overrides)))

/** What the player does: tap Bought for each purchase, then Brewed for each step. */
function replay(queue: Queue, start: AppState): { state: AppState; errors: string[] } {
  let state = start
  const errors: string[] = []
  const apply = (action: Parameters<typeof reduce>[1]) => {
    const result = reduce(state, action, index)
    if (result.error) errors.push(result.error)
    state = result.state
  }
  for (const entry of queue.entries) {
    for (const p of entry.purchases) apply({ type: 'buy', item: p.item, qty: p.qty })
    for (const step of entry.steps) apply({ type: 'brew', recipe: step.recipe })
  }
  return { state, errors }
}

describe('buildQueue', () => {
  it('orders recipes greedily, re-planning against the working stock', () => {
    const queue = queueFor()
    expect(queue.entries.map((e) => e.recipe)).toEqual([6, 1, 0, 4, 5])
    expect(queue.entries.map((e) => e.cost)).toEqual([20, 10, 30, 60, 20])
    expect(queue.entries.map((e) => e.status)).toEqual(['buy', 'buy', 'buy', 'buy', 'buy'])
    expect(queue.gather.map((p) => p.recipe)).toEqual([2, 7, 8])
    expect(queue.blocked).toBe(1)
    expect(queue.later).toBe(1)
    expect(queue.reason).toBeUndefined()
  })

  it('can be replayed through the reducer: buy, then brew', () => {
    const { state, errors } = replay(queueFor(), miniState())
    expect(errors).toEqual([])
    expect(state.gold).toBe(860)
    expect(state.completed).toEqual([0, 1, 4, 5, 6])
  })

  it('replays when the pot is occupied and stock is held', () => {
    const start = miniState({ inventory: { a: 1, b: 1 }, pot: { recipe: 0, result: 'x', ingredients: ['a', 'b'] }, completed: [] })
    const queue = buildQueue(makeContext(index, start))
    expect(queue.entries.map((e) => e.recipe)).not.toContain(0)
    const { errors } = replay(queue, start)
    expect(errors).toEqual([])
  })

  it('puts ready recipes before cheaper purchases', () => {
    const queue = queueFor({ inventory: { a: 2 } })
    expect(queue.entries[0]).toMatchObject({ recipe: 6, status: 'ready', cost: 0 })
  })

  it('does not promise one unit twice', () => {
    const queue = queueFor({ inventory: { a: 1 } })
    const { errors, state } = replay(queue, miniState({ inventory: { a: 1 } }))
    expect(errors).toEqual([])
    expect(state.inventory.a ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('reports why it is empty', () => {
    expect(queueFor({ potLevel: 0 })).toMatchObject({ entries: [], reason: 'no-pot' })
    expect(queueFor({ completed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })).toMatchObject({ entries: [], reason: 'all-done', blocked: 0, later: 0 })
    const stuck = queueFor({ completed: [0, 1, 4, 5, 6] })
    expect(stuck.entries).toEqual([])
    expect(stuck.reason).toBe('nothing-reachable')
    expect(stuck.gather).toHaveLength(3)
  })

  it('does not change the state it is given', () => {
    const state = miniState({ inventory: { a: 3 } })
    const copy = structuredClone(state)
    buildQueue(makeContext(index, state))
    expect(state).toEqual(copy)
  })
})

describe('incremental re-planning', () => {
  it('gives the same queue as re-planning every recipe after every pick', () => {
    const states: Partial<AppState>[] = [
      {}, { potLevel: 2 }, { potLevel: 3 }, { stage: 's2' }, { stage: 's2', potLevel: 2, inventory: { s: 2, c: 1 } },
      { inventory: { a: 1, x: 1, p: 1 } }, { completed: [6], pot: { recipe: 0, result: 'x', ingredients: ['a', 'b'] } },
      { inventory: { a: 5, b: 5, c: 2, s: 2, q: 1, d: 1 }, potLevel: 2, stage: 's2' },
    ]
    for (const overrides of states) {
      const ctx = () => makeContext(index, miniState(overrides))
      expect(buildQueueWith(ctx(), true)).toEqual(buildQueueWith(ctx(), false))
    }
  })

  it('does so on the real recipe graph with every gatherable item sourced', () => {
    const d = structuredClone(data)
    const sold = new Set(d.shops.flatMap((s) => s.stock))
    const made = new Set(d.recipes.map((r) => r.result))
    for (const item of d.items) {
      if (!sold.has(item.id) && !made.has(item.id) && d.sources.every((s) => s.item !== item.id)) {
        d.sources.push({ item: item.id, kind: 'found', where: 'anywhere' })
      }
    }
    const real = createIndex(d)
    const last = d.stages[d.stages.length - 1]!.id
    const foundOnly = d.items.filter((i) => !sold.has(i.id) && !made.has(i.id)).slice(0, 3).map((i) => i.id)
    const bought = [...sold].slice(0, 4)
    const crafted = [...made].filter((i) => !sold.has(i)).slice(0, 3)
    const bag = Object.fromEntries([...foundOnly, ...bought, ...crafted].map((i) => [i, 5]))
    expect(foundOnly.length).toBeGreaterThan(0)
    for (const [potLevel, stage] of [[1, d.stages[0]!.id], [2, last]] as const) {
      for (const inventory of [{}, bag]) {
        const base = { ...initialState(real), potLevel, stage, inventory }
        const ctx = () => makeContext(real, base)
        const incremental = buildQueueWith(ctx(), true)
        expect(incremental.entries.length).toBeGreaterThan(0)
        expect(incremental).toEqual(buildQueueWith(ctx(), false))
      }
    }
  })
})

describe('applyPlan', () => {
  const ctx = makeContext(index, miniState())
  const plan = buildQueue(ctx).entries[0]!   // recipe 6: buy a x2, brew a + a
  it('adds purchases, consumes ingredients and adds the result', () => {
    const stock = { b: 1 }
    applyPlan(ctx, stock, plan)
    expect(stock).toEqual({ b: 1, x: 1 })
  })
  it('detects a plan that consumes more than the stock holds', () => {
    expect(() => applyPlan(ctx, {}, { ...plan, purchases: [] })).toThrow(/more a than/)
  })
})
