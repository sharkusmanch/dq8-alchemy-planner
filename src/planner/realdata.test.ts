import { describe, expect, it } from 'vitest'
import { data, index } from '../data'
import { initialState, reduce } from '../state/reducer'
import type { Action, AppState } from '../state/types'
import { buildQueue, makeContext, scarcity, totalNeed } from './index'

// Activates once the data lane has landed sources and scarce items.
describe.skipIf(data.sources.length === 0 || data.goals.scarce.length === 0)('planner on the real data', () => {
  const start: AppState = { ...initialState(index), potLevel: 1, stage: 'basic-pot', gold: null }

  it('builds a queue of two-ingredient recipes that the reducer accepts', () => {
    const queue = buildQueue(makeContext(index, start))
    expect(queue.entries.length).toBeGreaterThan(0)
    let state = start
    for (const entry of queue.entries) {
      for (const step of entry.steps) expect(index.recipe(step.recipe).ingredients).toHaveLength(2)
      const actions: Action[] = [
        ...entry.purchases.map((p): Action => ({ type: 'buy', item: p.item, qty: p.qty })),
        ...entry.steps.map((s): Action => ({ type: 'brew', recipe: s.recipe })),
      ]
      for (const action of actions) {
        const result = reduce(state, action, index)
        expect(result.error, JSON.stringify(action)).toBeUndefined()
        state = result.state
      }
    }
  })

  it('builds the late-game queue in under five seconds', () => {
    const late: AppState = { ...start, potLevel: 2, stage: 'postgame' }
    const began = performance.now()
    buildQueue(makeContext(index, late))
    expect(performance.now() - began).toBeLessThan(5000)
  })

  it('totals the whole run to a finite gold estimate', () => {
    expect(Number.isFinite(totalNeed(index, start).goldEstimate)).toBe(true)
  })

  it('counts every unit of the scarce ingredients, repeat brews included', () => {
    const reports = scarcity(index, start)
    expect(reports.find((r) => r.item === 'orichalcum')?.needed).toBe(8)
    expect(reports.find((r) => r.item === 'slime-crown')?.needed).toBe(4)
  })

  it('calls the three short scarce items farmable and the Icicle dirk not', () => {
    const reports = scarcity(index, start)
    const short = reports.filter((r) => r.atRisk)
    expect(short.map((r) => [r.item, r.gap])).toEqual([['orichalcum', 2], ['slime-crown', 2], ['gold-nugget', 1]])
    for (const report of short) expect(report.farmable.length, report.item).toBeGreaterThan(0)
    expect(reports.find((r) => r.item === 'icicle-dirk')?.farmable).toEqual([])
  })

  it('reports the Icicle dirk as needing two scarce items', () => {
    const report = scarcity(index, start).find((r) => r.item === 'icicle-dirk')
    expect(report?.needed).toBe(2)
  })
})
