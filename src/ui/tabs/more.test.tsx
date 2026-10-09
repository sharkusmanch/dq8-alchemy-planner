import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIndex } from '../../data/create-index'
import type { GameData } from '../../data/types'
import { index as realIndex } from '../../data'
import { buildSave } from '../../save/testing'
import type { AppState } from '../../state/types'
import { miniData, miniState } from '../../testing/mini'
import { exportState } from '../../state/persist'
import { PollerContext, type Poller } from '../poller'
import { StoreProvider, useStore, type Store } from '../store'
import { More } from './More'

const config = vi.hoisted(() => ({ defaultSaveUrl: '' }))
vi.mock('../config', () => ({ get defaultSaveUrl() { return config.defaultSaveUrl } }))

const detect = vi.hoisted(() => ({ onlyFirstSave: false }))
vi.mock('../../save/detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../save/detect')>()
  return {
    ...actual,
    // Lets one test see the two-save fixture card as a card holding a single save.
    readSaveFile: (bytes: Uint8Array) => {
      const found = actual.readSaveFile(bytes)
      return detect.onlyFirstSave && found.kind === 'card' ? { kind: 'card' as const, saves: found.saves.slice(0, 1) } : found
    },
  }
})

afterEach(() => {
  detect.onlyFirstSave = false
  config.defaultSaveUrl = ''
  cleanup()
  vi.restoreAllMocks()
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

function renderMore(
  state: AppState = miniState(),
  opts: { data?: GameData; poller?: Poller; useRealIndex?: boolean } = {},
) {
  const index = opts.useRealIndex ? realIndex : createIndex(opts.data ?? miniData)
  render(
    <StoreProvider index={index} initial={state} storage={memoryStorage()}>
      <PollerContext.Provider value={opts.poller ?? null}>
        <Probe />
        <More />
      </PollerContext.Provider>
    </StoreProvider>,
  )
}

function choose(label: string, bytes: Uint8Array, name = 'upload.bin') {
  const input = screen.getByLabelText(label) as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([bytes as Uint8Array<ArrayBuffer>], name)] } })
}
const chooseSave = (bytes: Uint8Array, name?: string) => choose('Save file or memory card', bytes, name)
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const fixtureCard = () => new Uint8Array(gunzipSync(readFileSync('src/save/__fixtures__/dq8-card.ps2.gz')))

describe('More: importing a save', () => {
  it('shows the size error for a 10-byte file and changes nothing', async () => {
    renderMore(miniState({ inventory: { a: 2 } }))
    const before = store.state
    chooseSave(new Uint8Array(10))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/23,776 bytes/)
    expect(store.state).toBe(before)
  })

  it('shows the empty-slot error for 23,776 zero bytes and changes nothing', async () => {
    renderMore(miniState({ inventory: { a: 2 } }))
    const before = store.state
    chooseSave(new Uint8Array(23776))
    expect((await screen.findByRole('alert')).textContent).toMatch(/empty/i)
    expect(store.state).toBe(before)
  })

  it('rejects a 23,776-byte file of 0xFF and changes nothing', async () => {
    renderMore()
    const before = store.state
    chooseSave(new Uint8Array(23776).fill(0xff))
    await screen.findByRole('alert')
    expect(store.state).toBe(before)
  })

  it('clears an earlier error when a good file follows', async () => {
    renderMore()
    chooseSave(new Uint8Array(10))
    await screen.findByRole('alert')
    chooseSave(buildSave({ gold: 9 }))
    await screen.findByText(/^Imported:/)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('imports a raw save, shows the summary, and Undo restores the prior state', async () => {
    renderMore(miniState({ inventory: { c: 4 }, gold: 1000 }))
    const before = store.state
    chooseSave(buildSave({ gold: 250, playTimeFrames: (3600 + 300) * 60, bag: [{ gameId: 1, qty: 3 }] }))

    expect((await screen.findByText(/^Imported:/)).textContent).toBe(
      'Imported: 1 stacks, 250 gold, 0 recipes done, play time 1:05, stage: Stage one',
    )
    expect(store.state.gold).toBe(250)
    expect(store.state.inventory).toEqual({ a: 3 })
    expect(store.state.lastImport).toMatchObject({ source: 'upload', playTimeFrames: (3600 + 300) * 60 })
    expect(screen.getByText(/Last import/).textContent).toMatch(/1:05/)

    press('Undo')
    await waitFor(() => expect(store.state).toEqual(before))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('imports straight away from a card with exactly one save, without a picker', async () => {
    detect.onlyFirstSave = true
    renderMore()
    chooseSave(fixtureCard(), 'card.ps2')
    await screen.findByText(/^Imported:/)
    expect(store.state.gold).toBe(111)
    expect(screen.queryByRole('list', { name: 'Saves on this card' })).toBeNull()
  })

  it('lists each save of a card with play time and gold, and imports the chosen one', async () => {
    renderMore()
    chooseSave(fixtureCard(), 'card.ps2')
    const list = await screen.findByRole('list', { name: 'Saves on this card' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('BASLUS-21207dq8_0')
    expect(rows[0]!.textContent).toContain('111')
    expect(rows[1]!.textContent).toContain('BASLUS-21207dq8_3')
    expect(rows[1]!.textContent).toContain('333')
    expect(rows[1]!.textContent).toContain('0:01')
    expect(store.state.gold).toBe(1000) // nothing imported before choosing

    fireEvent.click(within(rows[1]!).getByRole('button'))
    await screen.findByText(/^Imported:/)
    expect(store.state.gold).toBe(333)
    expect(screen.queryByRole('list', { name: 'Saves on this card' })).toBeNull()
  })

  it('labels a European save on a card and says on import that the data is from the US version', async () => {
    const card = fixtureCard()
    const from = new TextEncoder().encode('BASLUS-21207dq8_3')
    for (let i = 0; i + from.length <= card.length; i++) {
      if (from.every((byte, k) => card[i + k] === byte)) card.set(new TextEncoder().encode('BESLES-53974dq8_3'), i)
    }
    renderMore()
    chooseSave(card, 'card.ps2')
    const rows = within(await screen.findByRole('list', { name: 'Saves on this card' })).getAllByRole('listitem')
    expect(rows[0]!.textContent).not.toContain('European version')
    expect(rows[1]!.textContent).toContain('BESLES-53974dq8_3')
    expect(rows[1]!.textContent).toContain('European version')

    fireEvent.click(within(rows[1]!).getByRole('button'))
    const summary = await screen.findByText(/^Imported:/)
    expect(summary.textContent).toContain('European save: the layout matches, but shops and prices in this app are from the US version.')
    expect(store.state.gold).toBe(333)
  })

  it('reads the same card against the real item table', async () => {
    renderMore(miniState(), { useRealIndex: true })
    chooseSave(fixtureCard(), 'card.ps2')
    const rows = within(await screen.findByRole('list', { name: 'Saves on this card' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
  })

  it('shows an error for a card without a Dragon Quest VIII save', async () => {
    renderMore()
    const empty = new Uint8Array(gunzipSync(readFileSync('src/save/__fixtures__/empty-card.ps2.gz')))
    chooseSave(empty, 'empty.ps2')
    expect((await screen.findByRole('alert')).textContent).toMatch(/no Dragon Quest VIII/)
  })
})

describe('More: save URL', () => {
  it('stores the typed URL and triggers a manual refresh', async () => {
    const poller: Poller = { trigger: vi.fn(async () => {}), dispose: vi.fn() }
    renderMore(miniState({ settings: { showSpoilers: true, saveUrl: '', autoImport: true } }), { poller })
    expect((screen.getByRole('button', { name: 'Refresh now' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.input(screen.getByLabelText('Save URL'), { target: { value: 'https://example.test/save' } })
    expect(store.state.settings.saveUrl).toBe('https://example.test/save')

    press('Refresh now')
    expect(poller.trigger).toHaveBeenCalledWith(true)
  })

  const BUILT_IN = 'This copy checks its own server for your newest save.'
  const SWITCH = 'Check for a new save automatically'
  const stateWith = (settings: Partial<AppState['settings']> = {}) =>
    miniState({ settings: { showSpoilers: true, saveUrl: '', autoImport: true, ...settings } })
  const refreshButton = () => screen.getByRole('button', { name: 'Refresh now' }) as HTMLButtonElement

  it('looks as before on a build without a default: no built-in text, no switch until a URL is set', () => {
    renderMore(stateWith())
    expect(screen.queryByText(BUILT_IN)).toBeNull()
    expect(screen.queryByRole('button', { name: SWITCH })).toBeNull()
    expect(screen.getByText(/^Optional\. A link that returns your newest save file/)).toBeTruthy()
    expect((screen.getByLabelText('Save URL') as HTMLInputElement).placeholder).toBe('https://example.com/dq8-save.bin')

    fireEvent.input(screen.getByLabelText('Save URL'), { target: { value: 'https://example.test/save' } })
    expect(screen.getByRole('button', { name: SWITCH })).toBeTruthy()
    expect(screen.queryByText(BUILT_IN)).toBeNull()
  })

  it('says the copy checks its own server when the built-in default is in effect', () => {
    config.defaultSaveUrl = './save'
    const poller: Poller = { trigger: vi.fn(async () => {}), dispose: vi.fn() }
    renderMore(stateWith(), { poller })
    const text = screen.getByText(BUILT_IN)
    const box = screen.getByLabelText('Save URL') as HTMLInputElement
    expect(text.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(box.value).toBe('')
    expect(box.placeholder).toMatch(/different link/i)
    expect(screen.getByRole('button', { name: SWITCH })).toBeTruthy()
    expect(refreshButton().disabled).toBe(false)
    press('Refresh now')
    expect(poller.trigger).toHaveBeenCalledWith(true)
  })

  it('drops the built-in text once the player enters a URL, and returns it when the box is emptied', () => {
    config.defaultSaveUrl = './save'
    renderMore(stateWith())
    fireEvent.input(screen.getByLabelText('Save URL'), { target: { value: 'https://example.test/save' } })
    expect(screen.queryByText(BUILT_IN)).toBeNull()
    expect(screen.getByRole('button', { name: SWITCH })).toBeTruthy()
    fireEvent.input(screen.getByLabelText('Save URL'), { target: { value: '' } })
    expect(screen.getByText(BUILT_IN)).toBeTruthy()
  })

  it('does not show the built-in text when the player already has their own URL', () => {
    config.defaultSaveUrl = './save'
    renderMore(stateWith({ saveUrl: 'https://example.test/save' }), { poller: { trigger: vi.fn(async () => {}), dispose: vi.fn() } })
    expect(screen.queryByText(BUILT_IN)).toBeNull()
    expect(refreshButton().disabled).toBe(false)
  })

  it('shows the switch on and flips autoImport when pressed', () => {
    config.defaultSaveUrl = './save'
    renderMore(stateWith())
    const toggle = screen.getByRole('button', { name: SWITCH })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(store.state.settings.autoImport).toBe(false)
    expect(screen.getByRole('button', { name: SWITCH }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: SWITCH }))
    expect(store.state.settings.autoImport).toBe(true)
  })

  it('still lets the player refresh by hand with the switch off', () => {
    config.defaultSaveUrl = './save'
    const poller: Poller = { trigger: vi.fn(async () => {}), dispose: vi.fn() }
    renderMore(stateWith({ autoImport: false }), { poller })
    expect(refreshButton().disabled).toBe(false)
    press('Refresh now')
    expect(poller.trigger).toHaveBeenCalledWith(true)
  })

  it('describes a last import from the built-in default as coming from this site', () => {
    config.defaultSaveUrl = './save'
    const lastImport = { at: '2026-10-09T10:00:00Z', source: 'url' as const, hash: 'h', playTimeFrames: 3600 * 60 }
    renderMore(miniState({ lastImport, settings: { showSpoilers: true, saveUrl: '', autoImport: true } }))
    expect(screen.getByText(/^Last import: from this site/)).toBeTruthy()
  })
})

describe('More: story and settings', () => {
  const threeStages: GameData = {
    ...miniData,
    stages: [{ id: 's1', label: 'Stage one' }, { id: 's2', label: 'Stage two' }, { id: 's3', label: 'Stage three' }, { id: 's4', label: 'Stage four' }],
  }
  const options = () => within(screen.getByLabelText('Story stage')).getAllByRole('option').map((o) => o.textContent)

  it('with spoilers off, labels stages beyond the next one as Later (n)', () => {
    renderMore(miniState({ stage: 's1', settings: { showSpoilers: false, saveUrl: '', autoImport: true } }), { data: threeStages })
    expect(options()).toEqual(['Stage one', 'Stage two', 'Later (1)', 'Later (2)'])
  })

  it('with spoilers on, names every stage', () => {
    renderMore(miniState({ stage: 's1' }), { data: threeStages })
    expect(options()).toEqual(['Stage one', 'Stage two', 'Stage three', 'Stage four'])
  })

  it('sets the stage, pot level and gold, where empty gold means unknown', () => {
    renderMore(miniState({ stage: 's1', gold: 5 }), { data: threeStages })
    fireEvent.change(screen.getByLabelText('Story stage'), { target: { value: 's2' } })
    expect(store.state.stage).toBe('s2')
    fireEvent.change(screen.getByLabelText('Pot level'), { target: { value: '3' } })
    expect(store.state.potLevel).toBe(3)
    fireEvent.input(screen.getByLabelText('Gold'), { target: { value: '' } })
    expect(store.state.gold).toBeNull()
    fireEvent.input(screen.getByLabelText('Gold'), { target: { value: '120' } })
    expect(store.state.gold).toBe(120)
  })

  it('toggles spoilers', () => {
    renderMore(miniState({ settings: { showSpoilers: false, saveUrl: '', autoImport: true } }))
    const toggle = screen.getByRole('button', { name: 'Show spoilers' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(store.state.settings.showSpoilers).toBe(true)
  })
})

describe('More: Dodgy Dave', () => {
  const daveData: GameData = {
    ...miniData,
    goals: {
      ...miniData.goals,
      dave: [{ item: 'y', reward: 'First reward' }, { item: 's', reward: 'Second reward' }, { item: 'z', reward: 'Third reward' }],
    },
  }

  const dave = (done: boolean[], next: number) => ({ dave: { done, next } })
  const spoilers = { settings: { showSpoilers: true, saveUrl: '', autoImport: true } }
  const section = () => screen.getByRole('region', { name: 'Dodgy Dave' })
  const requests = () => within(section()).getByRole('list', { name: "Dodgy Dave's requests" })
  const doneToggle = (name: string) => within(requests()).getByRole('button', { name: `Done: ${name}` })

  it('shows the request Dave wants, hands it in, then shows it as done and moves on', () => {
    renderMore(miniState({ inventory: { y: 1 }, ...dave([false, false, false], 0), ...spoilers }), { data: daveData })
    expect(section().textContent).toContain('First reward')
    expect(doneToggle('Y').getAttribute('aria-pressed')).toBe('false')
    press('Handed in')
    expect(store.state.dave).toEqual({ done: [true, false, false], next: 1 })
    expect(store.state.inventory).toEqual({})
    expect(doneToggle('Y').getAttribute('aria-pressed')).toBe('true')
    expect(section().textContent).toMatch(/Dave wants now:\s*S/)
  })

  it('lists every request with its state and marks the one Dave wants now', () => {
    renderMore(miniState({ ...dave([true, false, true], 1), ...spoilers }), { data: daveData })
    const rows = within(requests()).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('button', { name: /^Done:/ }).getAttribute('aria-pressed'))).toEqual(['true', 'false', 'true'])
    expect(rows.map((row) => /Dave wants this now/.test(row.textContent ?? ''))).toEqual([false, true, false])
    expect(rows[0]!.textContent).toContain('Handed in')
    expect(rows[1]!.textContent).toContain('Second reward')
  })

  it('hands in the request Dave wants, not the first one that is not done', () => {
    renderMore(miniState({ inventory: { y: 1, z: 1 }, ...dave([false, false, false], 2), ...spoilers }), { data: daveData })
    press('Handed in')
    expect(store.state.inventory).toEqual({ y: 1 })
    expect(store.state.dave).toEqual({ done: [false, false, true], next: 0 })
  })

  it('lets the player mark a request done or not done by hand', () => {
    renderMore(miniState({ inventory: { z: 1 }, ...dave([true, false, false], 1), ...spoilers }), { data: daveData })
    fireEvent.click(doneToggle('Z'))
    expect(store.state.dave).toEqual({ done: [true, false, true], next: 1 })
    expect(store.state.inventory).toEqual({ z: 1 })
    fireEvent.click(doneToggle('Y'))
    expect(store.state.dave).toEqual({ done: [false, false, true], next: 1 })
  })

  it('lets the player say that Dave moved on to another request', () => {
    renderMore(miniState({ inventory: { z: 1 }, ...dave([false, false, false], 0), ...spoilers }), { data: daveData })
    // The request he already wants has no such button.
    expect(within(requests()).queryByRole('button', { name: 'He wants this now: Y' })).toBeNull()
    fireEvent.click(within(requests()).getByRole('button', { name: 'He wants this now: Z' }))
    expect(store.state.dave).toEqual({ done: [false, false, false], next: 2 })
    expect(store.state.inventory).toEqual({ z: 1 })
    const rows = within(requests()).getAllByRole('listitem')
    expect(rows.map((row) => /Dave wants this now/.test(row.textContent ?? ''))).toEqual([false, false, true])
    expect(within(requests()).queryByRole('button', { name: 'He wants this now: Z' })).toBeNull()
    press('Handed in')
    expect(store.state.dave).toEqual({ done: [false, false, true], next: 0 })
  })

  it('with spoilers off offers "He wants this now" only on the requests it names', () => {
    renderMore(miniState({ ...dave([false, true, false], 1), settings: { showSpoilers: false, saveUrl: '', autoImport: true } }), { data: daveData })
    const offered = within(requests()).getAllByRole('button', { name: /^He wants this now/ })
    expect(offered.map((button) => button.getAttribute('aria-label'))).toEqual(['He wants this now: Y'])
    expect(section().textContent).not.toContain('Z')
  })

  it('offers no "He wants this now" once every request is done', () => {
    renderMore(miniState({ ...dave([true, true, true], 1), ...spoilers }), { data: daveData })
    expect(within(requests()).queryByRole('button', { name: /^He wants this now/ })).toBeNull()
  })

  it('asks first when the requested item is scarce, and cancels cleanly', () => {
    renderMore(miniState({ ...dave([true, false, false], 1), inventory: { s: 1 } }), { data: daveData })
    press('Handed in')
    expect(store.state.dave.done).toEqual([true, false, false])
    expect(screen.getByText(/one-time item/i)).toBeTruthy()
    press('Cancel')
    expect(store.state.dave.done).toEqual([true, false, false])
    press('Handed in')
    press(/^Yes, hand in/)
    expect(store.state.dave).toEqual({ done: [true, true, false], next: 2 })
    expect(store.state.inventory).toEqual({})
  })

  it('shows the reason when the item is not in stock', () => {
    renderMore(miniState(dave([false, false, false], 0)), { data: daveData })
    press('Handed in')
    expect(screen.getByRole('alert').textContent).toMatch(/need Y/)
    expect(store.state.dave).toEqual({ done: [false, false, false], next: 0 })
  })

  it('says so when every request is done, and offers no hand-in', () => {
    renderMore(miniState({ inventory: { y: 1 }, ...dave([true, true, true], 0), ...spoilers }), { data: daveData })
    expect(section().textContent).toContain("All of Dodgy Dave's requests are done.")
    expect(within(section()).queryByRole('button', { name: 'Handed in' })).toBeNull()
    expect(within(requests()).getAllByRole('listitem')).toHaveLength(3)
  })

  it('names requests Dave has not reached only with spoilers on, otherwise counts them', () => {
    renderMore(miniState({ ...dave([false, false, false], 0), settings: { showSpoilers: false, saveUrl: '', autoImport: true } }), { data: daveData })
    expect(section().textContent).not.toContain('Second reward')
    expect(section().textContent).not.toContain('Third reward')
    expect(section().textContent).toMatch(/2 more later/)
    expect(within(requests()).getAllByRole('listitem')).toHaveLength(1)
    press('Show spoilers')
    expect(section().textContent).toContain('Third reward')
  })

  it('with spoilers off still names a request Dave has already moved past', () => {
    // Dave skipped the first request and was given the second: the first is no secret, the third still is.
    renderMore(miniState({ ...dave([false, true, false], 1), settings: { showSpoilers: false, saveUrl: '', autoImport: true } }), { data: daveData })
    expect(within(requests()).getAllByRole('listitem')).toHaveLength(2)
    expect(section().textContent).toContain('First reward')
    expect(section().textContent).not.toContain('Third reward')
    expect(section().textContent).toMatch(/1 more later/)
  })
})

describe('More: scarce sources', () => {
  it('ticks one-time sources grouped by item', () => {
    renderMore()
    const group = screen.getByRole('group', { name: 'S' })
    fireEvent.click(within(group).getByLabelText('Town: chest'))
    expect(store.state.collected).toEqual(['s-1'])
    fireEvent.click(within(group).getByLabelText('Town: chest'))
    expect(store.state.collected).toEqual([])
  })

  it('with spoilers off names only sources at reachable locations and counts the rest', () => {
    const data: GameData = {
      ...miniData,
      goals: { ...miniData.goals, scarce: [{ item: 's', sources: [
        { id: 's-1', label: 'Town: chest', location: 'town' },
        { id: 's-2', label: 'Far: hidden chest', location: 'far' },
      ] }] },
    }
    renderMore(miniState({ stage: 's1', settings: { showSpoilers: false, saveUrl: '', autoImport: true } }), { data })
    expect(screen.queryByLabelText('Far: hidden chest')).toBeNull()
    expect(screen.getByLabelText('Town: chest')).toBeTruthy()
    expect(screen.getByText(/1 more at places you haven't reached/)).toBeTruthy()
    press('Show spoilers')
    expect(screen.getByLabelText('Far: hidden chest')).toBeTruthy()
  })
})

describe('More: backup and reset', () => {
  function captureDownload() {
    let blob: Blob | undefined
    let filename: string | undefined
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:test' }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download
    })
    return { blob: () => blob, filename: () => filename }
  }

  it('exports the state without the save URL and imports it back, keeping the current URL', async () => {
    const saved = miniState({
      inventory: { a: 2 }, gold: 77, completed: [1, 4], stage: 's2',
      settings: { showSpoilers: true, saveUrl: 'https://secret.example/save', autoImport: true },
    })
    renderMore(saved)
    const download = captureDownload()
    press('Export')
    expect(download.filename()).toBe('dq8-alchemy-planner.json')
    const text = await download.blob()!.text()
    expect(text).not.toContain('secret.example')

    fireEvent.click(screen.getByRole('button', { name: 'Show spoilers' })) // change something
    store.dispatch({ type: 'setGold', gold: 1 })
    store.dispatch({ type: 'adjustItem', item: 'a', delta: 5 })
    store.dispatch({ type: 'setSetting', key: 'saveUrl', value: 'https://other.example/save' })
    store.dispatch({ type: 'setSetting', key: 'autoImport', value: false })

    await waitFor(() => expect((screen.getByLabelText('Save URL') as HTMLInputElement).value).toBe('https://other.example/save'))
    choose('Planner state file', new TextEncoder().encode(text), 'dq8-alchemy-planner.json')
    await screen.findByText(/State imported/)
    expect(store.state).toEqual({
      ...saved,
      settings: { showSpoilers: true, saveUrl: 'https://other.example/save', autoImport: false },
    })
  })

  it("keeps this browser's automatic setting when the state file has none", async () => {
    renderMore(miniState({ settings: { showSpoilers: true, saveUrl: '', autoImport: false } }))
    const old = JSON.parse(exportState(store.state))
    delete old.settings.autoImport
    choose('Planner state file', new TextEncoder().encode(JSON.stringify(old)), 'old.json')
    await screen.findByText(/State imported/)
    expect(store.state.settings.autoImport).toBe(false)
  })

  it('rejects a state file that is not a planner state and changes nothing', async () => {
    renderMore(miniState({ gold: 5 }))
    const before = store.state
    choose('Planner state file', new TextEncoder().encode('not json'), 'x.json')
    expect((await screen.findByRole('alert')).textContent).toMatch(/valid JSON/)
    expect(store.state).toBe(before)
  })

  it('asks before resetting, says the save URL goes too, and can cancel', () => {
    renderMore(miniState({ gold: 5, settings: { showSpoilers: true, saveUrl: 'https://example.test/s', autoImport: true } }))
    press('Reset…')
    expect(screen.getByText(/including your save URL/i)).toBeTruthy()
    expect(store.state.gold).toBe(5)
    press('Cancel')
    expect(store.state.gold).toBe(5)
    expect(screen.queryByText(/including your save URL/i)).toBeNull()

    press('Reset…')
    press('Yes, reset everything')
    expect(store.state.gold).toBeNull()
    expect(store.state.settings.saveUrl).toBe('')
  })

  it('lists credits', () => {
    renderMore()
    const credits = screen.getByRole('region', { name: 'Credits' })
    for (const name of ['bdjeffyp', 'Red_Scarlet', 'Dunatis2000', "Dragon's Den"]) expect(credits.textContent).toContain(name)
  })
})
