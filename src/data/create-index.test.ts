import { describe, expect, it } from 'vitest'
import { miniData } from '../testing/mini'
import { createIndex } from './create-index'
import type { GameData } from './types'

const index = createIndex(miniData)

describe('createIndex', () => {
  it('looks items up by id', () => {
    expect(index.item('a').buy).toBe(10)
    expect(() => index.item('nope')).toThrow()
    expect(index.hasItem('a')).toBe(true)
    expect(index.hasItem('nope')).toBe(false)
  })

  it('looks items up by game id', () => {
    expect(index.itemByGameId(1)?.id).toBe('a')
    expect(index.itemByGameId(999)).toBeUndefined()
    expect(index.maxGameId).toBe(14)
  })

  it('finds recipes by index, result and ingredient', () => {
    expect(index.recipe(3).result).toBe('w')
    expect(() => index.recipe(99)).toThrow()
    expect(index.recipesFor('x').map((r) => r.recipeIndex)).toEqual([0, 6])
    expect(index.recipesUsing('b').map((r) => r.recipeIndex)).toEqual([0, 3, 5, 8])
  })

  it('ranks stages and resolves locations', () => {
    expect(index.stageRank('s1')).toBe(0)
    expect(index.stageRank('s2')).toBe(1)
    expect(() => index.stageRank('nope')).toThrow()
    expect(index.location('far').name).toBe('Far')
    expect(() => index.location('nope')).toThrow()
  })

  it('finds shops and sources', () => {
    expect(index.shopsSelling('a')).toHaveLength(1)
    expect(index.shopsSelling('nope')).toEqual([])
    expect(index.sourcesOf('c')).toHaveLength(1)
    expect(index.sourcesOf('a')).toEqual([])
  })

  it('returns shops in ascending id order', () => {
    const data: GameData = {
      ...miniData,
      shops: [
        { id: 'z-shop', location: 'town', name: 'Z', stock: ['a'] },
        { id: 'a-shop', location: 'town', name: 'A', stock: ['a'] },
      ],
    }
    expect(createIndex(data).shopsSelling('a').map((s) => s.id)).toEqual(['a-shop', 'z-shop'])
  })

  it('flags scarce items from goals', () => {
    expect(index.isScarce('s')).toBe(true)
    expect(index.isScarce('a')).toBe(false)
  })

  it('exposes the data it was built from', () => {
    expect(index.data).toBe(miniData)
  })

  it('works on empty data', () => {
    const empty: GameData = {
      items: [], recipes: [], stages: [], locations: [], shops: [], sources: [],
      goals: {
        brewThresholds: { basic: 30, improved: 100 },
        potStages: { basic: '', improved: '', instant: '' },
        milestones: [], dave: [], scarce: [],
      },
    }
    const idx = createIndex(empty)
    expect(idx.maxGameId).toBe(0)
    expect(idx.hasItem('a')).toBe(false)
  })
})
