import type { GameData, Item } from '../data/types'
import type { AppState } from '../state/types'

const PRICES: Record<string, number> = { a: 10, b: 20, q: 50, d: 5 }
const items: Item[] = ['a', 'b', 'c', 'd', 'q', 's', 'x', 'y', 'z', 'w', 'p', 't', 'u', 'v'].map((id, i) => ({
  id, gameId: i + 1, name: id.toUpperCase(), category: 'item',
  ...(PRICES[id] === undefined ? {} : { buy: PRICES[id], sell: Math.floor(PRICES[id] / 2) }),
}))
const r = (recipeIndex: number, result: string, ...ingredients: string[]) => ({ recipeIndex, result, ingredients })

/** Small world for tests. Recipes: 0 x=a+b, 1 y=x+a, 2 z=x+c, 3 w=a+b+b, 4 p=q+a, 5 q=p+b, 6 x=a+a, 7 t=s+a, 8 u=s+b, 9 v=d+a */
export const miniData: GameData = {
  items,
  recipes: [
    r(0, 'x', 'a', 'b'), r(1, 'y', 'x', 'a'), r(2, 'z', 'x', 'c'), r(3, 'w', 'a', 'b', 'b'),
    r(4, 'p', 'q', 'a'), r(5, 'q', 'p', 'b'), r(6, 'x', 'a', 'a'), r(7, 't', 's', 'a'),
    r(8, 'u', 's', 'b'), r(9, 'v', 'd', 'a'),
  ],
  stages: [{ id: 's1', label: 'Stage one' }, { id: 's2', label: 'Stage two' }],
  locations: [
    { id: 'town', name: 'Town', stage: 's1', zoomBit: 0 },
    { id: 'far', name: 'Far', stage: 's2', zoomBit: 1 },
  ],
  shops: [
    { id: 'far-shop', location: 'far', name: 'Far shop', stock: ['d'] },
    { id: 'town-shop', location: 'town', name: 'Town shop', stock: ['a', 'b', 'q'] },
  ],
  sources: [
    { item: 'c', kind: 'found', where: 'Town: barrel', location: 'town' },
    { item: 's', kind: 'found', where: 'Town: chest', location: 'town' },
  ],
  goals: {
    brewThresholds: { basic: 30, improved: 100 },
    potStages: { basic: 's1', improved: 's2', instant: 's2' },
    milestones: [2, 5, 10],
    dave: [{ item: 'y', reward: 'A reward' }],
    scarce: [{ item: 's', sources: [
      { id: 's-1', label: 'Town: chest', location: 'town' },
      { id: 's-2', label: 'Town: second chest', location: 'town' },
    ] }],
  },
}

export function miniState(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 1, inventory: {}, equipped: {}, gold: 1000, potLevel: 1, pot: null, completed: [],
    brews: { basic: 0, improved: 0 }, stage: 's1', dave: { done: [false], next: 0 }, collected: [], lastImport: null,
    settings: { showSpoilers: true, saveUrl: '' },
    ...overrides,
  }
}
