import { describe, expect, it } from 'vitest'
import { createIndex } from '../data/create-index'
import { miniData, miniState } from '../testing/mini'
import {
  BACKUP_KEY, STORAGE_KEY, exportState, loadState, parseImportedState, saveState,
} from './persist'
import { initialState } from './reducer'

const index = createIndex(miniData)

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k) },
    setItem: (k, v) => { map.set(k, String(v)) },
  }
}

const full = () => miniState({
  inventory: { a: 3, b: 1 }, equipped: { c: 1 }, gold: 500, potLevel: 2,
  pot: { recipe: 0, result: 'x', ingredients: ['a', 'b'] }, completed: [0, 4], brews: { basic: 3, improved: 1 },
  stage: 's2', dave: { done: [true], next: 0 }, collected: ['s-1'],
  lastImport: { at: '2026-10-09T00:00:00Z', source: 'url', hash: 'abc', playTimeFrames: 10 },
  settings: { showSpoilers: false, saveUrl: 'https://example.test/save' },
})

describe('saveState / loadState', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage()
    const s = full()
    saveState(storage, s)
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull()
    expect(loadState(storage, index)).toEqual(s)
  })

  it('returns the initial state when nothing is stored', () => {
    const storage = memoryStorage()
    expect(loadState(storage, index)).toEqual(initialState(index))
    expect(storage.getItem(BACKUP_KEY)).toBeNull()
  })

  it.each([
    ['not json'],
    ['{"version":99}'],
    ['{"version":1}'],
    ['null'],
    [JSON.stringify({ ...full(), gold: 'rich' })],
  ])('backs up unreadable data %s and starts fresh', (raw) => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, raw)
    expect(loadState(storage, index)).toEqual(initialState(index))
    expect(storage.getItem(BACKUP_KEY)).toBe(raw)
  })

  it('drops unknown item ids and falls back to the first stage', () => {
    const storage = memoryStorage()
    const raw = { ...full(), inventory: { a: 2, ghost: 5 }, equipped: { ghost: 1, c: 1 }, stage: 'nowhere' }
    storage.setItem(STORAGE_KEY, JSON.stringify(raw))
    const loaded = loadState(storage, index)
    expect(loaded.inventory).toEqual({ a: 2 })
    expect(loaded.equipped).toEqual({ c: 1 })
    expect(loaded.stage).toBe('s1')
    expect(storage.getItem(BACKUP_KEY)).toBeNull()
  })

  it('converts the old count of Dodgy Dave requests into the first flags', () => {
    const six = createIndex({
      ...miniData,
      goals: { ...miniData.goals, dave: ['y', 'x', 'z', 'w', 't', 'u'].map((item) => ({ item, reward: 'r' })) },
    })
    const old = (daveDone: number) => {
      const { dave: _dave, ...rest } = full()
      const storage = memoryStorage()
      storage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, daveDone }))
      return { state: loadState(storage, six), storage }
    }
    expect(old(2).state.dave).toEqual({ done: [true, true, false, false, false, false], next: 2 })
    expect(old(0).state.dave).toEqual({ done: [false, false, false, false, false, false], next: 0 })
    expect(old(6).state.dave).toEqual({ done: [true, true, true, true, true, true], next: 0 })
    expect(old(2).state).not.toHaveProperty('daveDone')
    expect(old(2).storage.getItem(BACKUP_KEY)).toBeNull()
  })

  it('fits the Dodgy Dave flags to the requests the data has', () => {
    const load = (dave: unknown) => {
      const storage = memoryStorage()
      storage.setItem(STORAGE_KEY, JSON.stringify({ ...full(), dave }))
      return loadState(storage, index).dave
    }
    expect(load({ done: [true, false, true], next: 2 })).toEqual({ done: [true], next: 0 })
    expect(load({ done: [], next: 0 })).toEqual({ done: [false], next: 0 })
  })

  it.each([
    [{ done: [1], next: 0 }],
    [{ done: 'yes', next: 0 }],
    [{ done: [true], next: -1 }],
    [{ done: [true] }],
    [3],
  ])('treats Dodgy Dave progress %j as unreadable', (dave) => {
    const storage = memoryStorage()
    const raw = JSON.stringify({ ...full(), dave })
    storage.setItem(STORAGE_KEY, raw)
    expect(loadState(storage, index)).toEqual(initialState(index))
    expect(storage.getItem(BACKUP_KEY)).toBe(raw)
  })

  it('normalises completed to sorted and unique', () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...full(), completed: [4, 0, 4, 1] }))
    expect(loadState(storage, index).completed).toEqual([0, 1, 4])
  })

  it('keeps completed recipe numbers the data does not know', () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...full(), completed: [999, 3, 0, 3] }))
    expect(loadState(storage, index).completed).toEqual([0, 3, 999])
  })

  it('drops a pot with an unknown ingredient or result', () => {
    for (const pot of [
      { recipe: 0, result: 'x', ingredients: ['a', 'ghost'] },
      { recipe: 0, result: 'ghost', ingredients: ['a', 'b'] },
    ]) {
      const storage = memoryStorage()
      storage.setItem(STORAGE_KEY, JSON.stringify({ ...full(), pot }))
      const loaded = loadState(storage, index)
      expect(loaded.pot).toBeNull()
      expect(loaded.gold).toBe(500)
    }
  })

  it('does not overwrite an unreadable blob when it cannot be backed up', () => {
    const storage = memoryStorage()
    const set = storage.setItem.bind(storage)
    storage.setItem = (k, v) => {
      if (k === BACKUP_KEY) throw new Error('quota')
      set(k, v)
    }
    storage.setItem(STORAGE_KEY, 'not json')
    expect(loadState(storage, index)).toEqual(initialState(index))
    saveState(storage, full())
    expect(storage.getItem(STORAGE_KEY)).toBe('not json')
  })

  it('backs up an unreadable blob before overwriting it', () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, 'not json')
    loadState(storage, index)
    storage.removeItem(BACKUP_KEY) // as if loadState had not managed to back it up
    const s = full()
    saveState(storage, s)
    expect(storage.getItem(BACKUP_KEY)).toBe('not json')
    expect(loadState(storage, index)).toEqual(s)
  })

  it('does not rewrite the backup when it already holds the blob', () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, 'not json')
    loadState(storage, index)
    saveState(storage, full())
    expect(storage.getItem(BACKUP_KEY)).toBe('not json')
    saveState(storage, miniState({ gold: 1 }))
    expect(storage.getItem(BACKUP_KEY)).toBe('not json')
    expect(loadState(storage, index).gold).toBe(1)
  })

  it('starts fresh when storage throws on read', () => {
    const storage = memoryStorage()
    storage.getItem = () => { throw new Error('blocked') }
    expect(loadState(storage, index)).toEqual(initialState(index))
  })

  it('survives a storage that refuses writes', () => {
    const storage = memoryStorage()
    storage.setItem = () => { throw new Error('quota') }
    expect(() => saveState(storage, full())).not.toThrow()
  })
})

describe('exportState / parseImportedState', () => {
  it('empties saveUrl on export', () => {
    expect(JSON.parse(exportState(full())).settings.saveUrl).toBe('')
  })

  it('round-trips with saveUrl empty', () => {
    const s = full()
    expect(parseImportedState(exportState(s), index)).toEqual({ ...s, settings: { ...s.settings, saveUrl: '' } })
  })

  it('throws a plain message for things that are not a planner state', () => {
    expect(() => parseImportedState('{}', index)).toThrow(/planner/i)
    expect(() => parseImportedState('nope', index)).toThrow(/JSON/i)
    expect(() => parseImportedState('{"version":2}', index)).toThrow(/version/i)
  })
})
