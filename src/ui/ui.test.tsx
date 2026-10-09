import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { createIndex } from '../data/create-index'
import type { GameData } from '../data/types'
import { STORAGE_KEY } from '../state/persist'
import type { AppState } from '../state/types'
import { miniData, miniState } from '../testing/mini'
import { AppShell } from './App'
import { StoreProvider, useStore, type Store } from './store'

afterEach(cleanup)

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

function renderApp(state: AppState = miniState(), storage: Storage = memoryStorage(), data: GameData = miniData) {
  render(
    <StoreProvider index={createIndex(data)} initial={state} storage={storage}>
      <Probe />
      <AppShell />
    </StoreProvider>,
  )
  return storage
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const recipeRows = () => within(screen.getByRole('list', { name: 'Recipes' })).queryAllByRole('listitem')

describe('shell', () => {
  it('renders the five tabs and switches between them', () => {
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const names = within(nav).getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['Next', 'Shop', 'Bag', 'Recipes', 'More'])
    for (const name of names) {
      press(name!)
      expect(screen.getByRole('heading', { level: 1, name: name! })).toBeTruthy()
      expect(within(nav).getByRole('button', { name: name! }).getAttribute('aria-current')).toBe('page')
    }
  })
})

describe('Bag', () => {
  it('increments an owned item and writes to the injected storage', () => {
    const storage = renderApp(miniState({ inventory: { a: 2 } }))
    press('Bag')
    const group = screen.getByRole('group', { name: 'A quantity' })
    expect(within(group).getByText('2')).toBeTruthy()
    press('Increase A')
    expect(within(screen.getByRole('group', { name: 'A quantity' })).getByText('3')).toBeTruthy()
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).inventory.a).toBe(3)
    press('Decrease A')
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).inventory.a).toBe(2)
  })

  it('filters owned items by search and category, and adds any item', () => {
    renderApp(miniState({ inventory: { a: 1, b: 1 }, equipped: { d: 1 } }))
    press('Bag')
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search bag' }), { target: { value: 'b' } })
    expect(screen.queryByRole('group', { name: 'A quantity' })).toBeNull()
    expect(screen.getByRole('group', { name: 'B quantity' })).toBeTruthy()

    fireEvent.input(screen.getByRole('searchbox', { name: 'Search bag' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'weapon' } })
    expect(screen.getByText('Nothing matches.')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'all' } })

    fireEvent.input(screen.getByRole('searchbox', { name: 'Add item' }), { target: { value: 'q' } })
    press('Add Q')
    expect(screen.getByRole('group', { name: 'Q quantity' })).toBeTruthy()
    expect(store.state.inventory.q).toBe(1)
  })

  it('shows equipped items read-only', () => {
    renderApp(miniState({ equipped: { d: 2 } }))
    press('Bag')
    const section = screen.getByRole('region', { name: 'Equipped' })
    expect(within(section).getByText('D')).toBeTruthy()
    expect(within(section).queryAllByRole('button')).toHaveLength(0)
  })
})

describe('Recipes', () => {
  it('lists every recipe with spoilers on', () => {
    renderApp(miniState())
    press('Recipes')
    expect(recipeRows()).toHaveLength(10)
    expect(screen.queryByText(/more later in the story/)).toBeNull()
  })

  it('collapses blocked recipes with spoilers off', () => {
    renderApp(miniState({ settings: { showSpoilers: false, saveUrl: '', autoImport: true } }))
    press('Recipes')
    expect(recipeRows()).toHaveLength(9)
    expect(screen.getByText('1 more later in the story')).toBeTruthy()
  })

  it('renders without throwing when there is no pot yet', () => {
    renderApp(miniState({ potLevel: 0 }))
    press('Recipes')
    expect(recipeRows()).toHaveLength(10)
  })

  it('toggles done and updates the chip', () => {
    const storage = renderApp(miniState())
    press('Recipes')
    const row = () => recipeRows()[0]!
    expect(within(row()).getByText('Buy')).toBeTruthy()
    const toggle = within(row()).getByRole('button', { name: 'Done: X (recipe 0)' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(within(row()).getByText('Done', { selector: '.chip' })).toBeTruthy()
    expect(within(row()).getByRole('button', { name: 'Done: X (recipe 0)' }).getAttribute('aria-pressed')).toBe('true')
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).completed).toEqual([0])
  })

  it('searches by result or ingredient name and filters by status', () => {
    renderApp(miniState())
    press('Recipes')
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search recipes' }), { target: { value: 'c' } })
    expect(recipeRows()).toHaveLength(1)
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search recipes' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'gather' } })
    expect(recipeRows().length).toBeGreaterThan(0)
    for (const row of recipeRows()) expect(within(row).getByText('Gather')).toBeTruthy()
  })

  it('marks a recipe whose save number is unconfirmed, and no other', () => {
    const data: GameData = {
      ...miniData,
      recipes: miniData.recipes.map((r) => (r.recipeIndex === 3 ? { ...r, recipeIndexUnconfirmed: true } : r)),
    }
    renderApp(miniState(), memoryStorage(), data)
    press('Recipes')
    const marked = recipeRows().filter((row) => /save number unconfirmed/.test(row.textContent ?? ''))
    expect(marked).toHaveLength(1)
    expect(within(marked[0]!).getByRole('button', { name: 'Done: W (recipe 3)' })).toBeTruthy()
  })

  it('says an ingredient is equipped instead of leaving the recipe as something to find', () => {
    // Z = X + C, and the only C is worn; V = D + A, and D (not sold yet) is worn too.
    renderApp(miniState({ equipped: { c: 1, d: 1 } }))
    press('Recipes')
    const row = (name: string) => recipeRows().find((r) => within(r).queryByRole('button', { name }) !== null)!
    expect(row('Done: Z (recipe 2)').textContent).toContain('C: Equipped on a character — unequip it to use it')
    expect(row('Done: V (recipe 9)').textContent).toContain('D: Equipped on a character — unequip it to use it')
    expect(row('Done: X (recipe 0)').textContent).not.toContain('Equipped on a character')
  })

  it('says nothing about equipment for an ingredient nobody is wearing', () => {
    renderApp(miniState())
    press('Recipes')
    expect(screen.queryByText(/Equipped on a character/)).toBeNull()
  })

  it('presets the status filter from the store', () => {
    renderApp(miniState())
    act(() => store.setTab('recipes', 'gather'))
    expect((screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value).toBe('gather')
  })
})

describe('store', () => {
  it('returns the reducer error when a dispatch is rejected', () => {
    renderApp()
    expect(store.dispatch({ type: 'adjustItem', item: 'nope', delta: 1 })).toMatch(/Unknown item/)
  })

  it('undoes an import-style action once', () => {
    const storage = renderApp(miniState({ inventory: { a: 2 } }))
    expect(store.canUndo).toBe(false)
    act(() => { store.dispatch({ type: 'reset' }) })
    expect(store.state.inventory).toEqual({})
    expect(store.canUndo).toBe(true)
    act(() => store.undo())
    expect(store.state.inventory).toEqual({ a: 2 })
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).inventory).toEqual({ a: 2 })
    expect(store.canUndo).toBe(false)
  })
})
