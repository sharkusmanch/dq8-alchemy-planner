import { describe, expect, it } from 'vitest'
import { index } from './index'

const recipes = index.data.recipes
const items = index.data.items

describe('recipes', () => {
  it('has 184 recipes numbered 0-183 with no repeats', () => {
    expect(recipes).toHaveLength(184)
    expect(new Set(recipes.map((r) => r.recipeIndex)).size).toBe(184)
    expect(Math.min(...recipes.map((r) => r.recipeIndex))).toBe(0)
    expect(Math.max(...recipes.map((r) => r.recipeIndex))).toBe(183)
  })

  it('has 120 two-ingredient and 64 three-ingredient recipes', () => {
    expect(recipes.filter((r) => r.ingredients.length === 2)).toHaveLength(120)
    expect(recipes.filter((r) => r.ingredients.length === 3)).toHaveLength(64)
  })

  it('resolves every result and ingredient to an item', () => {
    for (const r of recipes) {
      expect(() => index.item(r.result), `result of recipe ${r.recipeIndex}`).not.toThrow()
      for (const ingredient of r.ingredients) {
        expect(() => index.item(ingredient), `ingredient of recipe ${r.recipeIndex}`).not.toThrow()
      }
    }
  })

  it('finds the thief key recipe', () => {
    const [recipe] = index.recipesFor('thiefs-key')
    expect(recipe).toBeDefined()
    expect([...recipe!.ingredients].sort()).toEqual(['bronze-knife', 'iron-nail'])
  })

  // Recipes the real save marks as completed (status byte at file offset 0x5A7D + n, bit 0).
  it('numbers the recipes the way the game does', () => {
    const pins: Record<number, string> = {
      0: 'strong-medicine', 1: 'special-medicine', 6: 'rose-root', 9: 'strong-antidote',
      11: 'special-antidote', 15: 'thiefs-key', 62: 'iron-lance', 71: 'iron-axe',
      93: 'wayfarers-clothes', 141: 'feathered-cap', 170: 'mild-cheese',
    }
    for (const [n, result] of Object.entries(pins)) {
      expect(index.recipe(Number(n)).result, `recipe ${n}`).toBe(result)
    }
    expect(index.recipe(0).ingredients).toEqual(['medicinal-herb', 'medicinal-herb'])
    expect([...index.recipe(6).ingredients].sort()).toEqual(['medicinal-herb', 'strong-medicine'])
    expect(index.recipe(11).ingredients).toEqual(['strong-antidote', 'strong-antidote'])
  })

  it('separates results that have two recipes', () => {
    expect([...index.recipe(5).ingredients].sort()).toEqual(['medicinal-herb', 'medicinal-herb', 'medicinal-herb'])
    expect(index.recipesFor('rose-root').map((r) => r.recipeIndex)).toEqual([5, 6])
  })

  // Confirmed in the game on 2026-10-10: brewing Magic water set the status byte of recipe 22 (tools/DATA_NOTES.md).
  it('assigns the pair the code notes leave unlabelled: Elfin elixir at 16, Magic water at 22', () => {
    expect(index.recipe(16).result).toBe('elfin-elixir')
    expect(index.recipe(22).result).toBe('magic-water')
  })

  it('marks no recipe as having an unconfirmed number', () => {
    const marked = index.data.recipes.filter((r) => r.recipeIndexUnconfirmed).map((r) => r.recipeIndex)
    expect(marked).toEqual([])
  })

  it('makes recipes 18 to 22 an unbroken run of item ids', () => {
    const made = [18, 19, 20, 21, 22].map((n) => index.item(index.recipe(n).result).gameId)
    expect(made).toEqual([275, 276, 277, 278, 279])
  })
})

describe('items', () => {
  it('has unique ids and game ids', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    expect(new Set(items.map((i) => i.gameId)).size).toBe(items.length)
  })

  it('excludes Nothing and the DUMMY entries', () => {
    for (const item of items) {
      expect(item.name).not.toBe('Nothing')
      expect(item.name).not.toContain('DUMMY')
    }
  })

  it('uses kebab-case ids', () => {
    for (const item of items) expect(item.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('ends at game id 386', () => {
    expect(index.maxGameId).toBe(386)
  })

  it('looks items up by game id and gives common items a buy price', () => {
    expect(index.itemByGameId(189)?.id).toBe('leather-hat')
    expect(index.item('medicinal-herb').buy).toBeGreaterThan(0)
  })

  it('categorises items from the cards', () => {
    expect(index.item('copper-sword').category).toBe('weapon')
    expect(index.item('chain-mail').category).toBe('armour')
    expect(index.item('bronze-shield').category).toBe('shield')
    expect(index.item('leather-hat').category).toBe('helmet')
    expect(index.item('prayer-ring').category).toBe('accessory')
    expect(index.item('plain-cheese').category).toBe('cheese')
    expect(index.item('crystal-ball').category).toBe('other')
  })
})
