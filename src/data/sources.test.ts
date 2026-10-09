import { describe, expect, it } from 'vitest'
import { index } from './index'
import type { SourceKind } from './types'

const { sources, recipes, shops, locations } = index.data
const KINDS: SourceKind[] = ['found', 'drop', 'rare-drop', 'casino', 'medal', 'gift', 'other']
const ingredients = new Set(recipes.flatMap((r) => r.ingredients))
const produced = new Set(recipes.map((r) => r.result))

describe('sources', () => {
  it('has a known kind, a known item and a short label for every source', () => {
    expect(sources.length).toBeGreaterThan(0)
    for (const s of sources) {
      expect(KINDS, `kind of ${s.item}`).toContain(s.kind)
      expect(() => index.item(s.item), `item ${s.item}`).not.toThrow()
      expect(s.where.length, `where of ${s.item}`).toBeGreaterThanOrEqual(1)
      expect(s.where.length, `where of ${s.item}: ${s.where}`).toBeLessThanOrEqual(80)
    }
  })

  it('resolves every location', () => {
    for (const s of sources) {
      if (s.location !== undefined) {
        expect(() => index.location(s.location as string), `${s.item}: ${s.where}`).not.toThrow()
      }
    }
  })

  it('gives drops no location and keeps casino, medal and found sources placed', () => {
    for (const s of sources) {
      if (s.kind === 'drop' || s.kind === 'rare-drop') expect(s.location, `${s.item}: ${s.where}`).toBeUndefined()
      if (s.kind === 'casino' || s.kind === 'medal') expect(s.location, `${s.item}: ${s.where}`).toBeDefined()
    }
  })

  it('has a token price on every casino source and on nothing else', () => {
    for (const s of sources) {
      if (s.kind === 'casino') expect(s.tokens, `${s.item}`).toBeGreaterThan(0)
      else expect(s.tokens, `${s.item}: ${s.where}`).toBeUndefined()
    }
  })

  it('lists no source twice and none for an item that is no ingredient', () => {
    const keys = sources.map((s) => `${s.item}|${s.kind}|${s.where}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const s of sources) expect(ingredients.has(s.item), `${s.item} is not an ingredient`).toBe(true)
  })

  it('covers every ingredient that no recipe produces with a shop or a source', () => {
    const sold = new Set(shops.flatMap((shop) => shop.stock))
    const missing = [...ingredients].filter(
      (id) => !produced.has(id) && !sold.has(id) && index.sourcesOf(id).length === 0,
    )
    expect(missing).toEqual([])
  })

  it('records the two chests of the Icicle dirk, which no shop sells', () => {
    expect(index.shopsSelling('icicle-dirk')).toEqual([])
    const found = index.sourcesOf('icicle-dirk')
    expect(found).toHaveLength(2)
    expect(found.every((s) => s.kind === 'found')).toBe(true)
  })

  // A boss that is fought once and always drops its item is a pickup at the place of the fight,
  // not a monster to farm.
  it('lists the guaranteed drop of a boss fought once as found where the fight is', () => {
    const bosses: [monster: string, item: string, location: string][] = [
      ['Geyzer', 'seed-of-strength', 'waterfall-cave'],
      ['Tortured Soul', 'gold-rosary', 'ruined-abbey'],
      ['Empyrea', 'seed-of-magic', 'empycchu'],
      ['Megalodon', 'yggdrasil-dew', 'black-citadel'],
      ['Ruin', 'orichalcum', 'black-citadel'],
    ]
    for (const [monster, item, location] of bosses) {
      const named = sources.filter((s) => new RegExp(`\\b${monster}\\b`).test(s.where))
      expect(named, monster).toHaveLength(1)
      expect(named[0], monster).toMatchObject({ item, kind: 'found', location })
    }
  })

  it('labels every source in eight words or fewer', () => {
    for (const s of sources) expect(s.where.split(/\s+/).length, s.where).toBeLessThanOrEqual(8)
  })

  it('keeps the bosses that can be met again as drops', () => {
    for (const monster of ['Red Horn', 'Blue Fang', 'Servant of Darkness']) {
      const named = sources.filter((s) => s.where.endsWith(`: ${monster}`))
      expect(named.length, monster).toBeGreaterThan(0)
      for (const s of named) expect(['drop', 'rare-drop'], s.where).toContain(s.kind)
    }
  })

  it('records cowpat, casino prizes and Mini Medal prizes', () => {
    expect(index.sourcesOf('cowpat').length).toBeGreaterThanOrEqual(1)
    expect(sources.some((s) => s.kind === 'casino' && (s.tokens ?? 0) > 0)).toBe(true)
    expect(sources.some((s) => s.kind === 'medal')).toBe(true)
  })

  it('prices the casino prizes as the prize counters list them', () => {
    const price = (item: string) => sources.find((s) => s.kind === 'casino' && s.item === item)
    expect(price('magic-water')).toMatchObject({ tokens: 100, location: 'pickham-casino' })
    expect(price('falcon-blade')).toMatchObject({ tokens: 10000, location: 'baccarat-casino' })
  })

  it('places the Mini Medal prizes at Princess Minnie\'s Castle', () => {
    for (const s of sources.filter((x) => x.kind === 'medal')) {
      expect(s.location, `${s.item}`).toBe('princess-minnies-castle')
    }
  })

  it('keeps every location a source uses at a known stage', () => {
    for (const s of sources) {
      if (s.location === undefined) continue
      const stage = locations.find((l) => l.id === s.location)?.stage
      expect(stage, `${s.item}: ${s.where}`).toBeDefined()
      expect(() => index.stageRank(stage as string)).not.toThrow()
    }
  })
  describe('sources behind a later event take the stage of that event', () => {
    const rank = (location: string | undefined) => index.stageRank(index.location(location as string).stage)
    const at = (predicate: (where: string) => boolean, item?: string) =>
      sources.filter((s) => (item === undefined || s.item === item) && predicate(s.where))

    it('puts every Saint\'s Ashes Arena prize and Dark Ruins chest at the ship or later', () => {
      const arena = at((w) => w.startsWith('Monster Arena'), 'saints-ashes')
      const ruins = at((w) => w.startsWith('Dark Ruins B'), 'saints-ashes')
      expect(arena.length + ruins.length).toBeGreaterThanOrEqual(2)
      // Rank C needs the team built on the way round the world, so it is the ship stage.
      for (const s of arena) expect(rank(s.location), s.where).toBeGreaterThanOrEqual(index.stageRank('ship'))
      // The ruins' interior opens with the Sun Mirror, well after the ship.
      for (const s of ruins) expect(rank(s.location), s.where).toBeGreaterThan(index.stageRank('ship'))
    })

    it('opens the Arena after Trodain and the Dark Ruins interior with the Sun Mirror', () => {
      for (const s of at((w) => w.startsWith('Monster Arena'))) {
        expect(rank(s.location), `${s.item}: ${s.where}`).toBeGreaterThanOrEqual(index.stageRank('improved-pot'))
      }
      for (const s of at((w) => /^Dark Ruins B\d/.test(w))) {
        expect(rank(s.location), `${s.item}: ${s.where}`).toBeGreaterThanOrEqual(index.stageRank('argonia-bazaar'))
      }
    })

    it('puts the Light World Eyrie at flight and keeps the Dark World one earlier', () => {
      const light = at((w) => w.includes('(Light World)'))
      expect(light.length).toBeGreaterThanOrEqual(3)
      for (const s of light) expect(index.location(s.location as string).stage, s.where).toBe('flight')
      for (const s of at((w) => w.includes('(Dark World)'))) {
        expect(rank(s.location), s.where).toBeLessThan(index.stageRank('flight'))
      }
    })

    it('puts the Ultimate Key rooms at orkutsk or later', () => {
      const rooms = [
        ...at((w) => w === "Red's house: chest"),
        ...at((w) => w === 'Pickham: chest'),
        ...at((w) => w === 'Argonia 1F: chest', 'skull-ring'),
        ...at((w) => w === 'Le Club Puff Puff: dresser'),
        ...at((w) => w === "Princess Minnie's Castle: chest"),
        ...at((w) => w === 'Trodain 2F: chest', 'rusty-old-sword'),
      ]
      expect(rooms.length).toBeGreaterThanOrEqual(10)
      for (const s of rooms) expect(rank(s.location), `${s.item}: ${s.where}`).toBeGreaterThanOrEqual(index.stageRank('orkutsk'))
      // The Garter and the Seed of Agility basement chests, by name.
      for (const item of ['garter', 'seed-of-agility']) {
        const basement = at((w) => w === "Red's house: chest", item)
        expect(basement, item).toHaveLength(1)
        expect(rank(basement[0]?.location)).toBeGreaterThanOrEqual(index.stageRank('orkutsk'))
      }
    })

    it('keeps the Pirate\'s Cove dungeon after the Dragon Graveyard events begin', () => {
      for (const s of at((w) => w.startsWith("Pirate's Cove level"))) {
        expect(rank(s.location), s.where).toBeGreaterThanOrEqual(index.stageRank('orkutsk'))
      }
    })

    it('stages the event-gated gifts at or after their event', () => {
      const gate = (where: RegExp) => sources.filter((s) => where.test(s.where))
      for (const s of gate(/after the Royal Hunting Ground/)) expect(rank(s.location)).toBeGreaterThanOrEqual(index.stageRank('argonia-bazaar'))
      for (const s of gate(/after the Soulstone/)) expect(rank(s.location)).toBeGreaterThanOrEqual(index.stageRank('flight'))
      for (const s of gate(/after Marcello|moves indoors/)) expect(rank(s.location)).toBeGreaterThanOrEqual(index.stageRank('black-citadel'))
      expect(gate(/Marcello|Soulstone|moves indoors|Royal Hunting Ground/).length).toBeGreaterThanOrEqual(4)
    })
  })
})
