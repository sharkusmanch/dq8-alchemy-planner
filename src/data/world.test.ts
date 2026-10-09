import { describe, expect, it } from 'vitest'
import { index } from './index'

const { stages, locations, shops } = index.data
const rank = (id: string) => index.stageRank(id)

describe('stages', () => {
  it('has 20-28 stages with unique ids and a label each', () => {
    expect(stages.length).toBeGreaterThanOrEqual(20)
    expect(stages.length).toBeLessThanOrEqual(28)
    expect(new Set(stages.map((s) => s.id)).size).toBe(stages.length)
    for (const s of stages) {
      expect(s.id, 'kebab-case id').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.label.length, `label of ${s.id}`).toBeGreaterThan(0)
    }
  })

  it('orders the pot, ship, flight and postgame checkpoints', () => {
    expect(rank('basic-pot')).toBeLessThan(rank('improved-pot'))
    expect(rank('improved-pot')).toBeLessThan(rank('ship'))
    expect(rank('ship')).toBeLessThan(rank('flight'))
    expect(rank('flight')).toBeLessThan(rank('postgame'))
  })

  it('starts at Farebury and ends at postgame', () => {
    expect(stages.at(0)?.id).toBe('farebury')
    expect(stages.at(-1)?.id).toBe('postgame')
  })

  it('opens at least one place at every stage except the last', () => {
    const used = new Set<string>(locations.map((l) => l.stage))
    for (const shop of shops) if (shop.availableFrom) used.add(shop.availableFrom)
    for (const shop of shops) if (shop.availableUntil) used.add(shop.availableUntil)
    for (const s of stages.slice(0, -1)) expect(used.has(s.id), `stage ${s.id} is unused`).toBe(true)
  })
})

describe('stages a save can prove without a Zoom destination', () => {
  const stage = (id: string) => stages.find((s) => s.id === id)
  const zoomed = new Set(locations.filter((l) => l.zoomBit !== undefined).map((l) => l.stage))

  it('are the five stages no Zoom destination stands for', () => {
    expect(stages.filter((s) => !zoomed.has(s.id)).map((s) => s.id)).toEqual([
      'argonia-bazaar', 'dragon-graveyard', 'purgatory-island', 'black-citadel', 'postgame',
    ])
  })

  it('takes the bazaar and the Black Citadel from the story chapter and the trials from their own count', () => {
    expect(stage('argonia-bazaar')).toMatchObject({ storyMin: 0x0b })
    expect(stage('black-citadel')).toMatchObject({ storyMin: 0x11 })
    expect(stage('postgame')).toMatchObject({ trialMin: 1 })
  })

  it('leaves the two stages the story chapter does not settle to the player', () => {
    for (const id of ['dragon-graveyard', 'purgatory-island']) {
      expect(stage(id)?.storyMin, id).toBeUndefined()
      expect(stage(id)?.trialMin, id).toBeUndefined()
    }
  })

  it('never asks for an earlier chapter at a later stage', () => {
    const mins = stages.flatMap((s) => (s.storyMin === undefined ? [] : [s.storyMin]))
    expect(mins).toEqual([...mins].sort((a, b) => a - b))
    for (const s of stages) {
      if (s.storyMin !== undefined) expect(s.storyMin, s.id).toBeGreaterThan(0)
      if (s.trialMin !== undefined) expect(s.trialMin, s.id).toBeGreaterThan(0)
    }
  })
})

describe('locations', () => {
  it('has unique ids and a known stage for every location', () => {
    expect(new Set(locations.map((l) => l.id)).size).toBe(locations.length)
    for (const l of locations) expect(() => rank(l.stage), `stage of ${l.id}`).not.toThrow()
  })

  it('maps the 34 Zoom destinations to bits 0-33', () => {
    const zoom = locations.filter((l) => l.zoomBit !== undefined)
    expect(zoom).toHaveLength(34)
    const bits = zoom.map((l) => l.zoomBit as number)
    expect(new Set(bits).size).toBe(34)
    expect(Math.min(...bits)).toBe(0)
    expect(Math.max(...bits)).toBe(33)
    for (const bit of bits) expect(Number.isInteger(bit)).toBe(true)
  })

  it('pins Zoom bits from the code notes', () => {
    const byBit = new Map(locations.filter((l) => l.zoomBit !== undefined).map((l) => [l.zoomBit, l.id]))
    expect(byBit.get(0)).toBe('farebury')
    expect(byBit.get(3)).toBe('peregrin-quay')
    expect(byBit.get(6)).toBe('ruined-abbey')
    expect(byBit.get(8)).toBe('ascantha')
    expect(byBit.get(16)).toBe('savella-cathedral')
    expect(byBit.get(24)).toBe('desert-chapel')
    expect(byBit.get(32)).toBe('tryan-gully')
    expect(byBit.get(33)).toBe('dragovian-sanctuary')
  })

  it('places the landmarks of the required stages', () => {
    // The pot is handed over on the ferry, so Peregrin Quay is first entered with it in hand.
    expect(index.location('peregrin-quay').stage).toBe('basic-pot')
    // The Hilltop Hut road opens once Medea is back; Tryan Gully can only be flown to.
    expect(index.location('hilltop-hut').stage).toBe('improved-pot')
    expect(index.location('neos').stage).toBe('ship')
    expect(index.location('tryan-gully').stage).toBe('flight')
    expect(rank(index.location('dragovian-sanctuary').stage)).toBeGreaterThan(rank('flight'))
    expect(rank(index.location('dragovian-sanctuary').stage)).toBeLessThan(rank('postgame'))
  })

  it('keeps towns in the order the story reaches them', () => {
    const order = [
      'farebury', 'alexandria', 'port-prospect', 'peregrin-quay', 'simpleton', 'ascantha', 'pickham',
      'west-trodain-church', 'neos', 'chateau-felix', 'argonia-castle', 'arcadia', 'orkutsk', 'empycchu',
      'tryan-gully', 'dragovian-sanctuary',
    ]
    order.slice(1).forEach((id, i) => {
      const before = order[i] as string
      expect(rank(index.location(id).stage), `${id} after ${before}`)
        .toBeGreaterThan(rank(index.location(before).stage))
    })
  })

  // A place belongs to the stage at which it can first be entered, not the one at which a
  // walkthrough gets round to it. With the ship every coast is open at once.
  it('opens every town that needs only the ship at the ship stage', () => {
    for (const id of [
      'princess-minnies-castle', 'neos', 'savella-cathedral', 'desert-chapel', 'seaview-church',
      'baccarat', 'argonia', 'campsite-west-of-argonia',
    ]) {
      expect(index.location(id).stage, id).toBe('ship')
    }
    for (const shop of shops.filter((s) => ['savella-cathedral', 'desert-chapel', 'baccarat'].includes(s.location))) {
      expect(shop.availableFrom, shop.id).toBeUndefined()
    }
    expect(shops.filter((s) => s.location === 'argonia' && s.availableFrom === undefined)).toHaveLength(2)
  })

  it('keeps what a story event gates at its later stage', () => {
    // Argonia castle stays shut until the Dark Ruins barrier has been visited; the hunt follows.
    expect(index.location('argonia-castle').stage).toBe('argonia')
    expect(index.location('royal-hunting-ground').stage).toBe('argonia')
    // The casino in Baccarat is closed until the Dragon Graveyard quest is done.
    expect(index.location('baccarat-casino').stage).toBe('dragon-graveyard')
    expect(rank('ship')).toBeLessThan(rank('baccarat'))
    expect(rank('baccarat')).toBeLessThan(rank('argonia'))
    expect(rank('argonia')).toBeLessThan(rank('argonia-bazaar'))
    expect(rank('argonia-bazaar')).toBeLessThan(rank('dragon-graveyard'))
  })

  it('places the castle chests of Argonia in the castle, not the town', () => {
    const castle = index.data.sources.filter((s) => s.location === 'argonia-castle')
    expect(castle.length).toBeGreaterThan(0)
    for (const s of index.data.sources) {
      // The treasury behind the Ultimate Key door is its own location, at a later stage.
      if (/^Argonia \dF/.test(s.where)) expect(['argonia-castle', 'argonia-treasury'], `${s.item}: ${s.where}`).toContain(s.location)
    }
  })
})

describe('shops', () => {
  it('has 40-60 shops with unique ids and stock', () => {
    expect(shops.length).toBeGreaterThanOrEqual(40)
    expect(shops.length).toBeLessThanOrEqual(60)
    expect(new Set(shops.map((s) => s.id)).size).toBe(shops.length)
    for (const shop of shops) expect(shop.stock.length, `stock of ${shop.id}`).toBeGreaterThan(0)
  })

  it('resolves every shop location and availability stage', () => {
    for (const shop of shops) {
      expect(() => index.location(shop.location), `location of ${shop.id}`).not.toThrow()
      if (shop.availableFrom !== undefined) {
        expect(() => rank(shop.availableFrom as string), `availableFrom of ${shop.id}`).not.toThrow()
      }
      if (shop.availableUntil !== undefined) {
        expect(() => rank(shop.availableUntil as string), `availableUntil of ${shop.id}`).not.toThrow()
      }
      if (shop.timeOfDay !== undefined) expect(['day', 'night']).toContain(shop.timeOfDay)
    }
  })

  it('opens every shop before it closes', () => {
    for (const shop of shops) {
      if (shop.availableUntil === undefined) continue
      const from = shop.availableFrom ?? index.location(shop.location).stage
      expect(rank(from), `window of ${shop.id}`).toBeLessThan(rank(shop.availableUntil))
    }
  })

  it('resolves every stocked item, with no item twice in one shop', () => {
    for (const shop of shops) {
      expect(new Set(shop.stock).size, `repeats in ${shop.id}`).toBe(shop.stock.length)
      for (const item of shop.stock) expect(() => index.item(item), `${item} in ${shop.id}`).not.toThrow()
    }
  })

  it('stocks only items that have a gold price', () => {
    for (const shop of shops) {
      for (const item of shop.stock) expect(index.item(item).buy, `${item} in ${shop.id}`).toBeGreaterThan(0)
    }
  })

  it('sells medicinal herbs in Farebury', () => {
    expect(index.shopsSelling('medicinal-herb').some((s) => s.location === 'farebury')).toBe(true)
  })

  it('closes every Neos shop when Neos is destroyed', () => {
    const neos = shops.filter((s) => s.location === 'neos')
    expect(neos).toHaveLength(4)
    for (const shop of neos) expect(shop.availableUntil, shop.id).toBe('black-citadel')
    expect(neos.filter((s) => s.availableFrom !== undefined)).toHaveLength(1)
  })

  it('opens the Argonia bazaar stalls later than the town shops', () => {
    const argonia = shops.filter((s) => s.location === 'argonia')
    const late = argonia.filter((s) => s.availableFrom !== undefined)
    expect(argonia).toHaveLength(8)
    expect(late).toHaveLength(6)
    for (const shop of late) {
      expect(rank(shop.availableFrom as string)).toBeGreaterThan(rank(index.location('argonia').stage))
    }
    expect(index.shopsSelling('gold-ring').every((s) => s.availableFrom !== undefined)).toBe(true)
  })

  it('marks the day-only and night-only shops', () => {
    const timed = shops.filter((s) => s.timeOfDay !== undefined).map((s) => `${s.location}:${s.timeOfDay}`).sort()
    expect(timed).toEqual(['campsite-west-of-argonia:day', 'orkutsk:day', 'orkutsk:night'])
  })

  it('keeps casino prize counters out of the shops', () => {
    const counters = locations.filter((l) => l.id.endsWith('-casino'))
    expect(counters.map((l) => l.id).sort()).toEqual(['baccarat-casino', 'pickham-casino'])
    for (const counter of counters) expect(shops.some((s) => s.location === counter.id)).toBe(false)
    // Token-only prizes have no gold price, so they can never be in a shop's stock.
    expect(index.shopsSelling('gringham-whip')).toEqual([])
    expect(index.shopsSelling('silver-platter')).toEqual([])
  })
})
