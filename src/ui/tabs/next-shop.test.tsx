import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIndex } from '../../data/create-index'
import type { GameData } from '../../data/types'
import type { AppState } from '../../state/types'
import { miniData, miniState } from '../../testing/mini'
import { StoreProvider, useStore, type Store } from '../store'
import { QueueEntry } from '../components/QueueEntry'
import type { RecipePlan } from '../../planner'
import { Next } from './Next'
import { Shop } from './Shop'

// Lets a test make one planner function throw while the rest keep working.
const broken = vi.hoisted(() => ({ filler: false, totalNeed: false }))
vi.mock('../../planner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../planner')>()
  return {
    ...actual,
    filler: (...args: Parameters<typeof actual.filler>) => {
      if (broken.filler) throw new Error('filler broke')
      return actual.filler(...args)
    },
    totalNeed: (...args: Parameters<typeof actual.totalNeed>) => {
      if (broken.totalNeed) throw new Error('need broke')
      return actual.totalNeed(...args)
    },
  }
})

afterEach(() => {
  cleanup()
  broken.filler = false
  broken.totalNeed = false
})

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (key) => { map.delete(key) },
    setItem: (key, value) => { map.set(key, value) },
  }
}

let store: Store
function Probe() {
  store = useStore()
  return null
}

function renderTab(tab: 'next' | 'shop', state: AppState = miniState(), data: GameData = miniData) {
  render(
    <StoreProvider index={createIndex(data)} initial={state} storage={memoryStorage()}>
      <Probe />
      {tab === 'next' ? <Next /> : <Shop />}
    </StoreProvider>,
  )
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const queueRows = () => within(screen.getByRole('list', { name: 'Brewing queue' })).getAllByRole('listitem')
const resultsOf = (rows: HTMLElement[]) => rows.map((row) => within(row).getByRole('heading').textContent)
const pot = () => screen.getByRole('region', { name: 'Pot' })

describe('Next', () => {
  it('lists the queue in planner order', () => {
    renderTab('next')
    expect(resultsOf(queueRows())).toEqual(['X', 'Y', 'X', 'P', 'Q'])
  })

  it('shows have and need for the ingredients, and what to buy', () => {
    renderTab('next', miniState({ inventory: { a: 1 } }))
    const first = queueRows()[0]!
    expect(within(first).getByText(/A\b.*have 1 \/ need 2/)).toBeTruthy()
    expect(within(first).getByText(/Buy 1 × A/)).toBeTruthy()
    expect(within(first).getByText(/10 g/)).toBeTruthy()
  })

  it('Bought then Brewed moves the entry into the pot and counts the brew', () => {
    renderTab('next')
    const first = queueRows()[0]!
    fireEvent.click(within(first).getByRole('button', { name: 'Bought 2 A' }))
    expect(store.state.inventory).toEqual({ a: 2 })
    fireEvent.click(within(first).getByRole('button', { name: 'Brewed X' }))

    expect(resultsOf(queueRows())).toEqual(['Y', 'X', 'P', 'Q'])
    expect(within(pot()).getByText('X')).toBeTruthy()
    expect(screen.getByText('1 / 30')).toBeTruthy()
    expect(store.state.brews.basic).toBe(1)
    expect(store.state.completed).toEqual([6])
  })

  it('Brewed without Bought shows the error inline and changes nothing', () => {
    renderTab('next')
    const before = store.state
    const first = queueRows()[0]!
    fireEvent.click(within(first).getByRole('button', { name: 'Brewed X' }))
    expect(within(first).getByRole('alert').textContent).toMatch(/Missing ingredients/)
    expect(store.state).toBe(before)
    expect(resultsOf(queueRows())).toEqual(['X', 'Y', 'X', 'P', 'Q'])
  })

  it('Collect empties the pot and the bag gains the result', () => {
    renderTab('next', miniState({ inventory: { a: 2 } }))
    fireEvent.click(within(queueRows()[0]!).getByRole('button', { name: 'Brewed X' }))
    expect(store.state.pot?.result).toBe('x')
    fireEvent.click(within(pot()).getByRole('button', { name: 'Collect' }))
    expect(store.state.pot).toBeNull()
    expect(store.state.inventory.x).toBe(1)
    expect(within(pot()).queryByRole('button', { name: 'Collect' })).toBeNull()
  })

  it('says so when there is no pot yet', () => {
    renderTab('next', miniState({ potLevel: 0 }))
    expect(screen.getByText("You don't have the alchemy pot yet. King Trode gives it to you on the ferry to Peregrin Quay.")).toBeTruthy()
  })

  it('says so when every recipe is done', () => {
    renderTab('next', miniState({ completed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }))
    expect(screen.getByText('Every recipe is done.')).toBeTruthy()
  })

  it('says so when nothing is brewable and lists what to gather', () => {
    renderTab('next', miniState({ completed: [0, 1, 4, 5, 6] }))
    expect(screen.getByText('Nothing new is brewable right now. See what to gather below, or advance the story.')).toBeTruthy()
    const rows = within(screen.getByRole('list', { name: 'Gather' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText(/Town: barrel/)).toBeTruthy()
  })

  it('says a gather item is equipped first, and still where to get another', () => {
    renderTab('next', miniState({ completed: [0, 1, 4, 5, 6], equipped: { c: 1 } }))
    const rows = within(screen.getByRole('list', { name: 'Gather' })).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('C: Equipped on a character — unequip it to use it. Also: Town: barrel')).toBeTruthy()
    // The other rows need S, which nobody is wearing.
    expect(within(rows[1]!).getByText('S: Town: chest')).toBeTruthy()
  })

  it('lists a recipe that only needs monster drops when its ingredient is equipped, even with spoilers off', () => {
    const data: GameData = { ...miniData, sources: [{ item: 'c', kind: 'drop', where: 'Drop: Bat' }, ...miniData.sources.slice(1)] }
    const state = { completed: [0, 1, 4, 5, 6], settings: { showSpoilers: false, saveUrl: '', autoImport: true } }
    renderTab('next', miniState({ ...state, equipped: { c: 1 } }), data)
    expect(screen.getByText('C: Equipped on a character — unequip it to use it. Also: Drop: Bat')).toBeTruthy()
    expect(screen.queryByText(/more need monster drops/)).toBeNull()
  })

  it('shows equipped units beside the stock count of a scarce item that is short', () => {
    renderTab('next', miniState({ collected: ['s-1', 's-2'], inventory: { s: 1 }, equipped: { s: 2 } }))
    expect(screen.getByText(/Short of S by 1: 2 needed, 1 in stock \(2 equipped\), 0 left to pick up\./)).toBeTruthy()
  })

  it('shows the equipped units of an ingredient the queue says is short', () => {
    renderTab('next', miniState({ equipped: { a: 2, b: 1 }, inventory: { b: 1 } }))
    const first = queueRows()[0]!
    expect(within(first).getByText('A: have 0 / need 1 (2 equipped)')).toBeTruthy()
    // B is covered by the bag, so the worn one is not worth a mention.
    expect(within(first).getByText('B: have 1 / need 1')).toBeTruthy()
  })

  it('warns about a scarce item that will run short and that no monster drops', () => {
    renderTab('next', miniState({ collected: ['s-1'] }))
    const warning = screen.getByText(/Short of S/)
    expect(warning.textContent).toMatch(/1/)
    expect(screen.queryByRole('list', { name: 'To farm' })).toBeNull()
  })

  it('shows no warning while the scarce item is covered', () => {
    renderTab('next')
    expect(screen.queryByText(/Short of/)).toBeNull()
    expect(screen.queryByRole('list', { name: 'To farm' })).toBeNull()
  })

  describe('a scarce item that monsters drop', () => {
    const farmableData: GameData = {
      ...miniData,
      sources: [
        ...miniData.sources,
        { item: 's', kind: 'drop', where: 'Drop: Slimer' },
        { item: 's', kind: 'rare-drop', where: 'Rare drop: Golem' },
      ],
    }
    const farmLines = () => within(screen.getByRole('list', { name: 'To farm' })).getAllByRole('listitem')

    it('shows a quiet line instead of the alert, without naming the monsters while spoilers are off', () => {
      renderTab('next', miniState({ collected: ['s-1'], settings: { showSpoilers: false, saveUrl: '', autoImport: true } }), farmableData)
      expect(screen.queryByText(/Short of/)).toBeNull()
      expect(farmLines().map((line) => line.textContent)).toEqual(['S: 1 more to farm from monster drops'])
      expect(farmLines()[0]!.querySelector('.warn')).toBeNull()
      expect(farmLines()[0]!.closest('.warn')).toBeNull()
    })

    it('names the monsters when spoilers are on', () => {
      renderTab('next', miniState({ collected: ['s-1', 's-2'] }), farmableData)
      expect(farmLines().map((line) => line.textContent)).toEqual([
        'S: 2 more to farm from monster drops (Slimer, Golem)',
      ])
    })

    it('adds the equipped units to the line', () => {
      renderTab('next', miniState({ collected: ['s-1', 's-2'], equipped: { s: 1 } }), farmableData)
      expect(farmLines().map((line) => line.textContent)).toEqual([
        'S: 2 more to farm from monster drops, 1 equipped (Slimer, Golem)',
      ])
    })

    it('says nothing while the one-time sources still cover the need', () => {
      renderTab('next', miniState(), farmableData)
      expect(screen.queryByRole('list', { name: 'To farm' })).toBeNull()
      expect(screen.queryByText(/Short of/)).toBeNull()
    })
  })

  it('prints each gather source once, without repeating its kind', () => {
    const data: GameData = {
      ...miniData,
      sources: [
        { item: 'c', kind: 'rare-drop', where: 'Rare drop: Treevil' },
        { item: 'c', kind: 'casino', where: 'Casino prize: 1,000 tokens', location: 'town', tokens: 1000 },
        { item: 's', kind: 'found', where: 'Town: chest', location: 'town' },
      ],
    }
    renderTab('next', miniState({ completed: [0, 1, 4, 5, 6] }), data)
    const rows = within(screen.getByRole('list', { name: 'Gather' })).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('C: Rare drop: Treevil; Casino prize: 1,000 tokens')).toBeTruthy()
    expect(within(rows[1]!).getByText('S: Town: chest')).toBeTruthy()
  })

  it('orders the tab: pot, warnings, queue, filler, counters, gather, then what to farm', () => {
    const data: GameData = {
      ...miniData,
      items: [...miniData.items, { id: 'k', gameId: 15, name: 'K', category: 'item' }, { id: 'm', gameId: 16, name: 'M', category: 'item' }],
      recipes: [...miniData.recipes, { recipeIndex: 10, result: 'm', ingredients: ['k', 'a'] }],
      sources: [...miniData.sources, { item: 'k', kind: 'drop', where: 'Drop: Slimer' }, { item: 'c', kind: 'drop', where: 'Drop: Bat' }],
      goals: {
        ...miniData.goals,
        scarce: [
          ...miniData.goals.scarce,
          { item: 'c', sources: [] },                                             // short, but a monster drops it
        ],
      },
    }
    renderTab('next', miniState({ collected: ['s-1'] }), data)
    const order = [
      screen.getByRole('region', { name: 'Pot' }),
      screen.getByText(/Short of S/),
      screen.getByRole('list', { name: 'Brewing queue' }),
      screen.getByRole('region', { name: 'Filler brew' }),
      screen.getByRole('list', { name: 'Progress' }),
      screen.getByRole('list', { name: 'Gather' }),
      screen.getByRole('list', { name: 'To farm' }),
    ]
    for (let i = 1; i < order.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING: the later element comes after the earlier one.
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & 4, `section ${i}`).toBe(4)
    }
  })

  describe('a long gather list', () => {
    // Eight more recipes that each need a found item (S), and three that need an item only monsters drop (K).
    const longData = (): GameData => ({
      ...miniData,
      items: [
        ...miniData.items,
        { id: 'k', gameId: 15, name: 'K', category: 'item' },
        ...Array.from({ length: 11 }, (_, i) => ({ id: `g${i}`, gameId: 16 + i, name: `G${i}`, category: 'item' as const })),
      ],
      recipes: [
        ...miniData.recipes,
        ...Array.from({ length: 8 }, (_, i) => ({ recipeIndex: 10 + i, result: `g${i}`, ingredients: ['s', 'b'] })),
        ...Array.from({ length: 3 }, (_, i) => ({ recipeIndex: 18 + i, result: `g${8 + i}`, ingredients: ['k', 'a'] })),
      ],
      sources: [...miniData.sources, { item: 'k', kind: 'drop', where: 'Drop: Slimer' }, { item: 'k', kind: 'rare-drop', where: 'Rare drop: Golem' }],
    })
    const gatherRows = () => within(screen.getByRole('list', { name: 'Gather' })).getAllByRole('listitem')
    const spoilersOff = { showSpoilers: false, saveUrl: '', autoImport: true }

    it('shows five rows and the rest on request', () => {
      renderTab('next', miniState(), longData())
      expect(gatherRows()).toHaveLength(5)
      fireEvent.click(screen.getByRole('button', { name: 'Show all 14 to gather' }))
      expect(gatherRows()).toHaveLength(14)
      expect(screen.queryByRole('button', { name: /^Show all \d+ to gather$/ })).toBeNull()
    })

    it('with spoilers off, counts the recipes that only need monster drops instead of listing them', () => {
      renderTab('next', miniState({ settings: spoilersOff }), longData())
      expect(screen.getByText('3 more need monster drops')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Show all 11 to gather' }))
      expect(gatherRows()).toHaveLength(11)
      expect(gatherRows().some((row) => /Slimer|Golem|G8|G9|G10/.test(row.textContent ?? ''))).toBe(false)
    })

    it('with spoilers on, lists them with their monsters and shows no count line', () => {
      renderTab('next', miniState(), longData())
      expect(screen.queryByText(/more need monster drops/)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Show all 14 to gather' }))
      expect(gatherRows().filter((row) => /Drop: Slimer/.test(row.textContent ?? ''))).toHaveLength(3)
    })

    it('shows only the count line when every gather recipe needs monster drops', () => {
      const data = longData()
      data.recipes = data.recipes.filter((r) => !r.ingredients.includes('s') && !r.ingredients.includes('c'))
      renderTab('next', miniState({ settings: spoilersOff }), data)
      expect(screen.queryByRole('list', { name: 'Gather' })).toBeNull()
      expect(screen.getByText('3 more need monster drops')).toBeTruthy()
    })
  })

  it('shows the counters, a milestone, and marks a finished counter as done', () => {
    renderTab('next', miniState({ completed: [0, 1], brews: { basic: 30, improved: 0 } }))
    const progress = screen.getByRole('list', { name: 'Progress' })
    expect(within(progress).getByText('2 / 10')).toBeTruthy()
    expect(within(progress).getByText(/Next milestone: 5/)).toBeTruthy()
    expect(within(progress).getByText('30 / 30')).toBeTruthy()
    expect(within(progress).getAllByText('Done').length).toBe(1)
  })

  it('shows the improved counter at pot level 2', () => {
    renderTab('next', miniState({ potLevel: 2, brews: { basic: 12, improved: 7 } }))
    const progress = screen.getByRole('list', { name: 'Progress' })
    expect(within(progress).getByText('7 / 100')).toBeTruthy()
    expect(within(progress).getByText('Basic pot brews: 12 / 30 — missed (the pot was upgraded)')).toBeTruthy()
    expect(within(progress).queryByText('Done')).toBeNull()
  })

  it('shows an earlier pot counter that was finished as done, not missed', () => {
    renderTab('next', miniState({ potLevel: 2, brews: { basic: 30, improved: 7 } }))
    const progress = screen.getByRole('list', { name: 'Progress' })
    expect(within(progress).getByText('30 / 30')).toBeTruthy()
    expect(within(progress).queryByText(/missed/)).toBeNull()
  })

  it('offers a filler brew with Bought and Brewed, marked urgent', () => {
    renderTab('next')
    const filler = screen.getByRole('region', { name: 'Filler brew' })
    expect(within(filler).getByText('Urgent', { exact: false })).toBeTruthy()
    fireEvent.click(within(filler).getByRole('button', { name: 'Bought 2 A' }))
    expect(store.state.inventory).toEqual({ a: 2 })
    fireEvent.click(within(filler).getByRole('button', { name: 'Brewed X' }))
    expect(store.state.brews.basic).toBe(1)
  })

  it('has no filler once the counter is full', () => {
    renderTab('next', miniState({ brews: { basic: 30, improved: 0 } }))
    expect(screen.queryByRole('region', { name: 'Filler brew' })).toBeNull()
  })

  it('opens the Recipes tab filtered by blocked or later', () => {
    renderTab('next')
    press('1 blocked')
    expect(store.tab).toBe('recipes')
    expect(store.recipeFilter).toBe('blocked')
    press('1 need a better pot')
    expect(store.recipeFilter).toBe('later')
  })

  it('does not crash when the goals data is still empty', () => {
    const data: GameData = {
      ...miniData,
      goals: { ...miniData.goals, dave: [], scarce: [], milestones: [], potStages: { basic: '', improved: '', instant: '' } },
    }
    renderTab('next', miniState(), data)
    expect(resultsOf(queueRows())).toEqual(['X', 'Y', 'X', 'P', 'Q'])
  })

  describe('multi-step entries and scarce items', () => {
    // Recipe 10 makes R from T and A; T comes from recipe 7, which eats the scarce item S.
    const data: GameData = {
      ...miniData,
      items: [...miniData.items, { id: 'r', gameId: 15, name: 'R', category: 'item' }],
      recipes: [...miniData.recipes, { recipeIndex: 10, result: 'r', ingredients: ['t', 'a'] }],
    }
    const chainState = (overrides: Partial<AppState> = {}) => miniState({
      completed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], inventory: { s: 1, a: 2 }, ...overrides,
    })

    it('lists the steps in order, the later ones as "then"', () => {
      renderTab('next', chainState(), data)
      const entry = queueRows()[0]!
      expect(within(entry).getByRole('heading').textContent).toBe('R')
      const steps = within(entry).getAllByRole('listitem')
      expect(steps.map((s) => s.textContent)).toEqual([
        expect.stringMatching(/^Brew T.*S \+ A/),
        expect.stringMatching(/^then: Brew R.*T \+ A/),
      ])
      expect(within(entry).getByRole('button', { name: 'Brewed T' })).toBeTruthy()
    })

    it('asks inline before using up a scarce item and dispatches nothing until Brew anyway', () => {
      renderTab('next', chainState(), data)
      const before = store.state
      fireEvent.click(screen.getByRole('button', { name: 'Brewed T' }))
      expect(screen.getByText('This uses your S — it is scarce. It is part of the plan for R.')).toBeTruthy()
      expect(store.state).toBe(before)
      expect(screen.queryByRole('button', { name: 'Brewed T' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(store.state).toBe(before)
      expect(screen.getByRole('button', { name: 'Brewed T' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Brew anyway' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Brewed T' }))
      fireEvent.click(screen.getByRole('button', { name: 'Brew anyway' }))
      expect(store.state.pot?.result).toBe('t')
      expect(store.state.inventory.s).toBeUndefined()
      expect(store.state.brews.basic).toBe(1)
    })

    it('does not depend on the browser confirm dialog', () => {
      const confirm = vi.fn(() => true)
      vi.stubGlobal('confirm', confirm)
      renderTab('next', chainState(), data)
      fireEvent.click(screen.getByRole('button', { name: 'Brewed T' }))
      expect(confirm).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('in the instant pot brews every step in order after the inline confirmation', () => {
      renderTab('next', chainState({ potLevel: 3 }), data)
      const entry = queueRows()[0]!
      expect(within(entry).getAllByRole('listitem').map((s) => s.textContent?.startsWith('then:'))).toEqual([false, false])
      fireEvent.click(within(entry).getByRole('button', { name: 'Brewed all 2 steps for R' }))
      fireEvent.click(within(entry).getByRole('button', { name: 'Brew anyway' }))
      expect(store.state.completed).toContain(10)
      expect(store.state.inventory.r).toBe(1)
      expect(store.state.brews).toEqual({ basic: 0, improved: 0 })
    })

    it('in the instant pot names the step that failed and the ones already brewed', () => {
      renderTab('next', chainState({ potLevel: 3, inventory: { s: 1, a: 1 } }), data)
      fireEvent.click(screen.getByRole('button', { name: 'Brewed all 2 steps for R' }))
      fireEvent.click(screen.getByRole('button', { name: 'Brew anyway' }))
      const message = screen.getByRole('alert').textContent!
      expect(message).toMatch(/Step 2 of 2 \(R\) failed: Missing ingredients/)
      expect(message).toMatch(/Steps 1 to 1 were brewed/)
      expect(store.state.inventory.t).toBe(1)
    })
  })

  it('keeps the stronger scarce wording for a repeat brew that is not part of a queued plan', () => {
    // A stand-alone repeat of recipe 7 (T from S and A): no step of it is a mandatory brew.
    const plan: RecipePlan = {
      recipe: 7, status: 'ready', cost: 0, steps: [{ recipe: 7, mandatory: false }], purchases: [], gather: [], blockedBy: [],
    }
    render(
      <StoreProvider index={createIndex(miniData)} initial={miniState({ completed: [7], inventory: { s: 1, a: 1 } })} storage={memoryStorage()}>
        <Probe />
        <ul><QueueEntry plan={plan} /></ul>
      </StoreProvider>,
    )
    const before = store.state
    fireEvent.click(screen.getByRole('button', { name: 'Brewed T' }))
    expect(screen.getByText('This uses your S, which you still need for other recipes.')).toBeTruthy()
    expect(store.state).toBe(before)
  })

  it('names the brew and buy buttons after their items, and keeps the short visible labels', () => {
    renderTab('next', miniState({ inventory: { a: 1 } }))
    const first = queueRows()[0]!
    const brew = within(first).getByRole('button', { name: 'Brewed X' })
    expect(brew.textContent).toBe('Brewed')
    const buy = within(first).getByRole('button', { name: 'Bought 1 A' })
    expect(buy.textContent).toBe('Bought')
    // No two brew buttons on the page share a name unless they brew the same item.
    const p = queueRows().find((row) => within(row).getByRole('heading').textContent === 'P')!
    expect(within(p).getByRole('button', { name: 'Brewed P' })).toBeTruthy()
    expect(within(p).getByRole('button', { name: 'Bought 1 A, 1 Q' })).toBeTruthy()
  })

  it('brews a chain one step per press at pot level 1 and re-plans around the pot', () => {
    renderTab('next', miniState({ completed: [0, 2, 3, 4, 5, 6, 7, 8, 9] }))
    // Only Y is left to do; X is made again on the way (recipe 6, then recipe 1).
    const entry = queueRows()[0]!
    expect(within(entry).getByRole('heading').textContent).toBe('Y')
    expect(within(entry).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(within(entry).getByRole('button', { name: 'Bought 3 A' }))
    fireEvent.click(within(entry).getByRole('button', { name: 'Brewed X' }))

    expect(store.state.pot?.result).toBe('x')
    expect(screen.getByText('1 / 30')).toBeTruthy()
    const next = queueRows()[0]!
    expect(within(next).getByRole('heading').textContent).toBe('Y')
    expect(within(next).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(next).getByRole('button', { name: 'Brewed Y' })).toBeTruthy()
  })

  it('counts the pot\'s pending result when netting the filler purchases', () => {
    renderTab('next', miniState({
      inventory: { a: 1 }, pot: { recipe: null, result: 'a', ingredients: [] },
    }))
    const filler = screen.getByRole('region', { name: 'Filler brew' })
    expect(within(filler).queryByRole('button', { name: /^Bought/ })).toBeNull()
    expect(within(filler).getByRole('button', { name: 'Brewed X' })).toBeTruthy()
  })

  it('keeps the rest of the tab when the filler planner fails', () => {
    broken.filler = true
    renderTab('next')
    expect(resultsOf(queueRows())).toEqual(['X', 'Y', 'X', 'P', 'Q'])
    expect(screen.getByRole('list', { name: 'Progress' })).toBeTruthy()
    const filler = screen.getByRole('region', { name: 'Filler brew' })
    expect(within(filler).getByRole('alert').textContent).toMatch(/filler broke/)
  })

  it('shows the first few entries and the rest on request', () => {
    const extra = Array.from({ length: 6 }, (_, i) => ({ recipeIndex: 10 + i, result: 'v', ingredients: ['a', 'b'] }))
    const data: GameData = { ...miniData, recipes: [...miniData.recipes, ...extra] }
    renderTab('next', miniState(), data)
    const shown = queueRows().length
    expect(shown).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: /^Show all \d+ brews$/ }))
    expect(queueRows().length).toBeGreaterThan(shown)
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull()
  })
})

describe('Shop', () => {
  it('groups the list by location with the total when everything reachable is on', () => {
    renderTab('shop')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Everything reachable' }))
    const groups = screen.getAllByRole('region')
    expect(groups).toHaveLength(1)
    expect(within(groups[0]!).getByRole('heading', { level: 2, name: 'Town' })).toBeTruthy()
    expect(within(groups[0]!).getByRole('heading', { level: 3, name: 'Town shop' })).toBeTruthy()
    expect(within(groups[0]!).getByText('5 × 10 g = 50 g')).toBeTruthy()
    expect(screen.getByText(/Total: 140 g/)).toBeTruthy()
    expect(screen.getByText(/You have 1000 g/)).toBeTruthy()
  })

  it('Bought on a line adds that many to the bag', () => {
    renderTab('shop')
    const line = screen.getAllByRole('listitem').find((row) => within(row).queryByText('A'))!
    fireEvent.click(within(line).getByRole('button', { name: 'Bought 5 A' }))
    expect(store.state.inventory.a).toBe(5)
    expect(store.state.gold).toBe(950)
  })

  it('Bought for a location buys every line there', () => {
    renderTab('shop')
    press('Bought all here: Town')
    expect(store.state.inventory).toEqual({ a: 5, b: 2, q: 1 })
  })

  it('names every Bought button after what it buys, and keeps the short visible label', () => {
    renderTab('shop')
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(names).toEqual(['Bought all here: Town', 'Bought 5 A', 'Bought 2 B', 'Bought 1 Q'])
    expect(new Set(names).size).toBe(names.length)
    const line = screen.getByRole('button', { name: 'Bought 5 A' })
    expect(line.textContent).toBe('Bought')
    expect(screen.getByRole('button', { name: 'Bought all here: Town' }).textContent).toBe('Bought all here')
  })

  it('explains an empty list when gold is zero', () => {
    renderTab('shop', miniState({ gold: 0 }))
    expect(screen.getByText(/You have 0 gold/)).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('shows the list for zero gold once everything reachable is on', () => {
    renderTab('shop', miniState({ gold: 0 }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Everything reachable' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
  })

  it('explains an empty list when nothing is queued', () => {
    renderTab('shop', miniState({ potLevel: 0 }))
    expect(screen.getByText('Nothing is queued, so there is nothing to buy.')).toBeTruthy()
  })

  it('labels day-only and night-only shops', () => {
    const data: GameData = {
      ...miniData,
      shops: miniData.shops.map((s) => (s.id === 'town-shop' ? { ...s, timeOfDay: 'night' as const } : s)),
    }
    renderTab('shop', miniState(), data)
    expect(screen.getByText('night only')).toBeTruthy()
  })

  it('keeps the shopping list when the whole-run estimate fails', () => {
    broken.totalNeed = true
    renderTab('shop')
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByText(/Total: 140 g/)).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Whole run' })).getByRole('alert').textContent).toMatch(/need broke/)
  })

  it('summarises the whole run', () => {
    renderTab('shop')
    const summary = screen.getByRole('group', { name: 'Whole run' })
    expect(within(summary).getByText(/185 g/)).toBeTruthy()
    expect(within(summary).getByText(/3 items to gather/)).toBeTruthy()
    expect(within(summary).getByText(/0 repeat brews/)).toBeTruthy()
  })

  it('words the whole-run gold as an upper bound, with thousands separators, and still calls it an estimate', () => {
    const data: GameData = {
      ...miniData,
      items: miniData.items.map((item) => (item.id === 'a' ? { ...item, buy: 93001 } : item)),
    }
    renderTab('shop', miniState(), data)
    const summary = screen.getByRole('group', { name: 'Whole run' })
    // 8 A at 93,001 g plus 105 g of the rest is 744,113 g.
    expect(within(summary).getByText(/Up to about 744,000 g if you buy everything shops sell/)).toBeTruthy()
    expect(summary.textContent).not.toMatch(/to buy/)
    expect(within(summary).getByText(/estimate/i)).toBeTruthy()
  })
})
