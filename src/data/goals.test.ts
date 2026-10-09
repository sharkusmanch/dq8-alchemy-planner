import { describe, expect, it } from 'vitest'
import { PROGRESS_BLOCKS } from '../save/layout'
import { index } from './index'

const { goals, recipes, shops, items } = index.data
const ingredients = new Set(recipes.flatMap((r) => r.ingredients))
const produced = new Set(recipes.map((r) => r.result))
const sold = new Set(shops.flatMap((shop) => shop.stock))
const scarceIds = goals.scarce.map((entry) => entry.item)
const scarce = (item: string) => goals.scarce.find((entry) => entry.item === item)

describe('goals: pots and milestones', () => {
  it('sets the brew thresholds of the two pot achievements', () => {
    expect(goals.brewThresholds).toEqual({ basic: 30, improved: 100 })
  })

  it('names the stage at which each pot arrives, in story order', () => {
    expect(goals.potStages).toEqual({ basic: 'basic-pot', improved: 'improved-pot', instant: 'postgame' })
    expect(index.stageRank(goals.potStages.basic)).toBeLessThan(index.stageRank(goals.potStages.improved))
    expect(index.stageRank(goals.potStages.improved)).toBeLessThan(index.stageRank(goals.potStages.instant))
  })

  it('lists ascending recipe milestones that end at all 184 recipes', () => {
    expect(goals.milestones).toEqual([10, 25, 50, 100, 150, 184])
    expect([...goals.milestones].sort((a, b) => a - b)).toEqual(goals.milestones)
    expect(goals.milestones.at(-1)).toBe(recipes.length)
  })
})

describe('goals: Dodgy Dave', () => {
  it('has six requests in the order he asks, each for a known item with a reward label', () => {
    expect(goals.dave.map((request) => request.item)).toEqual([
      'special-medicine', 'reinforced-boomerang', 'ring-of-immunity',
      'robe-of-serenity', 'sandstorm-spear', 'crimson-robe',
    ])
    for (const request of goals.dave) {
      expect(() => index.item(request.item), request.item).not.toThrow()
      expect(request.reward.length, `reward for ${request.item}`).toBeGreaterThan(0)
      expect(request.reward.length, `reward for ${request.item}`).toBeLessThanOrEqual(40)
    }
  })

  it('asks only for things the pot can make', () => {
    for (const request of goals.dave) expect(produced.has(request.item), request.item).toBe(true)
  })

  it('rewards the three item trades with the items the walkthroughs name', () => {
    expect(goals.dave.map((request) => request.reward)).toEqual([
      '500 gold', '1,200 gold', 'Bandit Axe', '6,000 gold', 'Happy Hat', 'Big Boss Shield',
    ])
  })
})

describe('goals: scarce items', () => {
  it('lists each scarce item once, and each is an ingredient of a recipe', () => {
    expect(new Set(scarceIds).size).toBe(scarceIds.length)
    for (const id of scarceIds) {
      expect(() => index.item(id), id).not.toThrow()
      expect(ingredients.has(id), `${id} is not an ingredient`).toBe(true)
      expect(index.isScarce(id), id).toBe(true)
    }
  })

  it('gives every one-time source a unique id of the form <item>-<n>, a short label and a known place', () => {
    const ids = goals.scarce.flatMap((entry) => entry.sources.map((source) => source.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of goals.scarce) {
      expect(entry.sources.map((source) => source.id), entry.item)
        .toEqual(entry.sources.map((_, n) => `${entry.item}-${n + 1}`))
      for (const source of entry.sources) {
        expect(source.label.length, source.id).toBeGreaterThan(0)
        expect(source.label.length, `${source.id}: ${source.label}`).toBeLessThanOrEqual(80)
        expect(() => index.location(source.location), source.id).not.toThrow()
      }
    }
  })

  it('has the three items the achievement guide warns about', () => {
    expect(scarce('icicle-dirk')?.sources).toHaveLength(2)
    expect(scarce('icicle-dirk')?.sources.map((source) => source.location)).toEqual(['herb-grotto', 'black-citadel'])
    // Six one-time Orichalcum (the walkthroughs agree) and two Slime Crowns.
    expect(scarce('orichalcum')?.sources).toHaveLength(6)
    expect(scarce('slime-crown')?.sources).toHaveLength(2)
  })

  // The rule: an ingredient is scarce when nothing can supply it again and again: no shop, no
  // casino prize counter, no recipe and no monster that drops it as its normal drop.
  // Slime Crown does have such a drop, at 1 in 64; it is listed anyway.
  it('lists exactly the ingredients that nothing supplies without limit, plus Slime Crown', () => {
    const repeatable = (id: string) => index.sourcesOf(id).some((s) => s.kind === 'drop' || s.kind === 'casino')
    const byRule = [...ingredients].filter((id) => !sold.has(id) && !produced.has(id) && !repeatable(id))
    expect(byRule).toContain('orichalcum')
    expect(byRule).not.toContain('slime-crown')
    expect([...scarceIds].sort()).toEqual([...byRule, 'slime-crown'].sort())
  })

  it('counts a boss fought once as a one-time source, not as a monster to farm', () => {
    // The Ruin's Orichalcum and Geyzer's Seed of Strength are each on the scarce list as a pickup.
    expect(index.sourcesOf('orichalcum').filter((s) => s.kind === 'drop')).toEqual([])
    expect(scarce('orichalcum')?.sources.some((s) => /Ruin/.test(s.label))).toBe(true)
    expect(index.sourcesOf('seed-of-strength').filter((s) => s.kind === 'drop')).toEqual([])
    expect(scarce('seed-of-strength')?.sources.some((s) => /Geyzer/.test(s.label))).toBe(true)
  })

  it('leaves out what a casino prize counter sells for tokens', () => {
    for (const id of ['falcon-blade', 'liquid-metal-armour', 'rune-staff', 'silver-platter']) {
      expect(index.sourcesOf(id).some((s) => s.kind === 'casino'), id).toBe(true)
      expect(index.isScarce(id), id).toBe(false)
    }
  })

  it('lists every chest, gift and medal prize that sources.json knows for a scarce item', () => {
    // The item card names one Seed of Wisdom chest by Arcadia; it stands on the Argonia side of the
    // checkpoint (walkthrough and treasure-flag note), which is where the scarce list puts it.
    const placedElsewhere: Record<string, string[]> = { 'seed-of-wisdom': ['arcadia'] }
    for (const entry of goals.scarce) {
      const oneTime = index.sourcesOf(entry.item).filter((s) => ['found', 'gift', 'medal'].includes(s.kind))
      expect(entry.sources.length, entry.item).toBe(oneTime.length)
      const listed = entry.sources.map((s) => s.location)
      for (const { location } of oneTime) {
        if (placedElsewhere[entry.item]?.includes(location as string)) continue
        expect(listed, `${entry.item} at ${location}`).toContain(location)
      }
    }
  })

  it('counts the direct uses the scarce arithmetic starts from', () => {
    const uses = (id: string) => recipes.flatMap((r) => r.ingredients).filter((i) => i === id).length
    expect(uses('icicle-dirk')).toBe(2)
    expect(uses('orichalcum')).toBe(7)
    expect(uses('slime-crown')).toBe(3)
    expect(uses('gold-nugget')).toBe(3)
    // Two recipes consume a Liquid metal sword and two a Golden axe, one recipe makes each and
    // nothing else supplies them: each is brewed twice, for one more Orichalcum, Slime Crown and Gold Nugget.
    for (const id of ['liquid-metal-sword', 'golden-axe']) {
      expect(index.recipesUsing(id), id).toHaveLength(2)
      expect(index.recipesFor(id), id).toHaveLength(1)
      expect(index.shopsSelling(id), id).toEqual([])
      expect(index.sourcesOf(id), id).toEqual([])
    }
    expect(index.recipesFor('liquid-metal-sword')[0]?.ingredients).toEqual(
      expect.arrayContaining(['orichalcum', 'slime-crown']),
    )
    expect(index.recipesFor('golden-axe')[0]?.ingredients).toContain('gold-nugget')
  })
})

describe('prices', () => {
  it('gives every stocked item a buy price', () => {
    for (const shop of shops) {
      for (const item of shop.stock) expect(index.item(item).buy, `${item} in ${shop.id}`).toBeGreaterThan(0)
    }
  })

  it("keeps the North American price of Saint's Ashes, not the 300 gold of the shops list", () => {
    expect(index.item('saints-ashes').buy).toBe(12000)
    expect(index.item('saints-ashes').sell).toBe(6000)
    expect(index.shopsSelling('saints-ashes').map((shop) => shop.id)).toEqual(['dragovian-sanctuary-item-shop'])
  })

  it('has no item that sells for more than it costs', () => {
    for (const item of items) {
      if (item.buy !== undefined && item.sell !== undefined) {
        expect(item.sell, item.id).toBeLessThanOrEqual(item.buy)
      }
    }
  })
})

// How a save shows that a one-time source has been taken (tools/DATA_NOTES.md lists the evidence for each).
describe('goals: scarce sources a save can tick', () => {
  const sources = goals.scarce.flatMap((entry) => entry.sources)
  const source = (id: string) => sources.find((s) => s.id === id)
  const inBlock = (offset: number) => PROGRESS_BLOCKS.some(([first, end]) => offset >= first && offset < end)

  it('gives every source exactly one sign: a flag, a Mini Medal prize or a kill count', () => {
    for (const s of sources) {
      const signs = [s.flag, s.medalPrize, s.killCount].filter((sign) => sign !== undefined)
      expect(signs, s.id).toHaveLength(1)
    }
    expect(sources.filter((s) => s.flag).length).toBe(48)
    expect(sources.filter((s) => s.medalPrize !== undefined).length).toBe(4)
    expect(sources.filter((s) => s.killCount).length).toBe(2)
  })

  it('points every flag and kill count into a block the save parser keeps', () => {
    for (const s of sources) {
      if (s.flag) {
        expect(inBlock(s.flag.offset), s.id).toBe(true)
        expect([0, 1, 2, 3, 4, 5, 6, 7], s.id).toContain(s.flag.bit)
      }
      if (s.killCount) {
        expect(inBlock(s.killCount.offset), s.id).toBe(true)
        expect(inBlock(s.killCount.offset + 1), s.id).toBe(true)
      }
    }
  })

  it('uses each flag for one source, but for the Trolls\' Maze reward, which hands over both seeds', () => {
    const byFlag = new Map<string, string[]>()
    for (const s of sources) {
      if (!s.flag) continue
      const key = `${s.flag.offset}.${s.flag.bit}`
      byFlag.set(key, [...(byFlag.get(key) ?? []), s.id])
    }
    const shared = [...byFlag.values()].filter((ids) => ids.length > 1)
    expect(shared).toEqual([['seed-of-life-13', 'seed-of-strength-12']])
  })

  it('has the flags the audit of published saves found', () => {
    const flags: Record<string, [offset: number, bit: number]> = {
      'icicle-dirk-1': [0x99e, 7], 'icicle-dirk-2': [0x9c5, 3],
      'orichalcum-2': [0x9b8, 4], 'orichalcum-3': [0x9cb, 5], 'orichalcum-4': [0x9c5, 1], 'orichalcum-6': [0x9d8, 1],
      'slime-crown-1': [0x70e, 1], 'slime-crown-2': [0x9ba, 4],
      'gold-nugget-2': [0x9b4, 1], 'gold-nugget-3': [0x9b7, 2],
      'templars-sword-1': [0x945, 4], 'battle-fork-1': [0x973, 7], 'metal-king-spear-1': [0x9d0, 0],
    }
    for (const [id, [offset, bit]] of Object.entries(flags)) expect(source(id)?.flag, id).toEqual({ offset, bit })
  })

  it('orders the Mini Medal prizes as Princess Minnie gives them', () => {
    const prizes = sources.filter((s) => s.medalPrize !== undefined).map((s) => [s.id, s.medalPrize])
    expect(prizes).toEqual([
      ['orichalcum-1', 8], ['gold-nugget-1', 4], ['miracle-sword-1', 6], ['dangerous-bustier-1', 10],
    ])
    // A later prize costs more medals.
    const medals = (label: string) => Number(/(\d+) Mini Medals/.exec(label)?.[1])
    const ranked = sources.filter((s) => s.medalPrize !== undefined).sort((a, b) => a.medalPrize! - b.medalPrize!)
    expect(ranked.map((s) => medals(s.label))).toEqual([52, 68, 83, 99])
  })

  it('takes the two boss drops from the kill counts of Geyzer and the Ruin', () => {
    expect(source('seed-of-strength-1')?.killCount).toEqual({ offset: 0x3820 })
    expect(source('orichalcum-5')?.killCount).toEqual({ offset: 0x3b20 })
  })
})
