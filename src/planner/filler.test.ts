import { describe, expect, it } from 'vitest'
import { createIndex } from '../data/create-index'
import type { AppState } from '../state/types'
import { miniData, miniState } from '../testing/mini'
import { makeContext } from './context'
import { filler } from './filler'

const index = createIndex(miniData)
const fillerAt = (overrides: Partial<AppState> = {}) => filler(makeContext(index, miniState(overrides)))

describe('filler', () => {
  it('suggests the cheapest recipe made of shop items', () => {
    expect(fillerAt()).toEqual({
      recipe: 6, unitCost: 20, purchases: [{ item: 'a', qty: 2, unitPrice: 10 }],
      remaining: 30, counter: 'basic', urgent: true,
    })
  })
  it('counts down the remaining brews', () => {
    expect(fillerAt({ brews: { basic: 12, improved: 0 } })?.remaining).toBe(18)
  })
  it('is null once the counter has reached its threshold', () => {
    expect(fillerAt({ brews: { basic: 30, improved: 0 } })).toBeNull()
  })
  it('is null at pot level 0 and 3', () => {
    expect(fillerAt({ potLevel: 0 })).toBeNull()
    expect(fillerAt({ potLevel: 3 })).toBeNull()
  })
  it('uses the improved counter and three-ingredient recipes at pot level 2', () => {
    const f = fillerAt({ potLevel: 2, brews: { basic: 30, improved: 40 } })
    expect(f).toMatchObject({ recipe: 6, counter: 'improved', remaining: 60, urgent: true })
  })
  it('skips recipes that use a scarce or unsold ingredient', () => {
    const data = structuredClone(miniData)
    data.goals.scarce = [{ item: 'a', sources: [] }]
    const f = filler(makeContext(createIndex(data), miniState()))
    expect(f).toBeNull()
  })
  it('breaks cost ties by recipe number', () => {
    const data = structuredClone(miniData)
    data.items.find((i) => i.id === 'b')!.buy = 10
    const f = filler(makeContext(createIndex(data), miniState()))
    expect(f?.recipe).toBe(0)
  })
  it('is not urgent while earlier stages remain, and tolerates unknown pot stages', () => {
    const data = structuredClone(miniData)
    data.stages.push({ id: 's3', label: 'three' })
    data.goals.potStages = { basic: 's1', improved: 's3', instant: 's3' }
    expect(filler(makeContext(createIndex(data), miniState()))?.urgent).toBe(false)
    data.goals.potStages = { basic: '', improved: '', instant: '' }
    expect(filler(makeContext(createIndex(data), miniState()))?.urgent).toBe(false)
  })
  it('throws on a pot stage id that is not a stage, instead of hiding it', () => {
    const data = structuredClone(miniData)
    data.goals.potStages = { basic: 's1', improved: 'nope', instant: 's2' }
    expect(() => filler(makeContext(createIndex(data), miniState()))).toThrow()
  })
})
