import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIndex } from '../data/create-index'
import { buildSave } from '../save/testing'
import type { AppState } from '../state/types'
import { miniData, miniState } from '../testing/mini'
import { AppShell } from './App'
import { StoreProvider, useStore, type Store } from './store'

const config = vi.hoisted(() => ({ defaultSaveUrl: '' }))
vi.mock('./config', () => ({ get defaultSaveUrl() { return config.defaultSaveUrl } }))

const URL = 'https://example.test/save.bin'
const GOLD_BEFORE = 1000

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

let now = 0
let visibility: DocumentVisibilityState = 'visible'
const fetchMock = vi.fn()

function reply(body: Uint8Array, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    type: 'basic',
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response
}
const saveWithGold = (gold: number) => buildSave({ gold, bag: [{ gameId: 1, qty: 2 }] })

function renderShell(state: AppState = miniState({ gold: GOLD_BEFORE, settings: { showSpoilers: true, saveUrl: URL, autoImport: true } })) {
  render(
    <StoreProvider index={createIndex(miniData)} initial={state} storage={memoryStorage()}>
      <Probe />
      <AppShell />
    </StoreProvider>,
  )
}
const becomeVisible = () => {
  visibility = 'visible'
  fireEvent(document, new Event('visibilitychange'))
}

beforeEach(() => {
  now = 1_000_000
  config.defaultSaveUrl = ''
  visibility = 'visible'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('save URL polling in the app', () => {
  it('checks the URL on mount and when the page becomes visible, and not when it is hidden', async () => {
    fetchMock.mockResolvedValue(reply(new Uint8Array(100), 404))
    renderShell()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]![0]).toBe(URL)
    await screen.findByText(/the server answered 404/) // the first request has finished

    now += 31_000
    visibility = 'hidden'
    fireEvent(document, new Event('visibilitychange'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    becomeVisible()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('makes no request at all without a save URL', async () => {
    renderShell(miniState({ settings: { showSpoilers: true, saveUrl: '', autoImport: true } }))
    becomeVisible()
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('imports a URL save once, and after Undo only "Refresh now" imports it again', async () => {
    fetchMock.mockImplementation(async () => reply(saveWithGold(250)))
    renderShell()
    await waitFor(() => expect(store.state.gold).toBe(250))
    await screen.findByText(/^Imported:/)

    // Undo from the notice, as the user would.
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(store.state.gold).toBe(GOLD_BEFORE))

    // The URL still serves the undone save; an automatic poll after the window must leave it undone.
    now += 31_000
    becomeVisible()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(store.state.gold).toBe(GOLD_BEFORE)
    now += 31_000
    becomeVisible()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(store.state.gold).toBe(GOLD_BEFORE)

    // A manual refresh is the user asking for it.
    act(() => store.setTab('more'))
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }))
    await waitFor(() => expect(store.state.gold).toBe(250))
  })

  it('imports newer bytes automatically even after an undo', async () => {
    let gold = 250
    fetchMock.mockImplementation(async () => reply(saveWithGold(gold)))
    renderShell()
    await waitFor(() => expect(store.state.gold).toBe(250))
    act(() => store.undo())
    await waitFor(() => expect(store.state.gold).toBe(GOLD_BEFORE))

    gold = 300
    now += 31_000
    becomeVisible()
    await waitFor(() => expect(store.state.gold).toBe(300))
  })
})

describe('notices from the poller', () => {
  it('clears its own failure notice once the URL works again, but leaves other notices alone', async () => {
    let healthy = false
    fetchMock.mockImplementation(async () => (healthy ? reply(saveWithGold(250)) : reply(new Uint8Array(0), 500)))
    renderShell(miniState({ gold: 250, settings: { showSpoilers: true, saveUrl: URL, autoImport: true } }))
    await screen.findByText(/Couldn't load the save from your URL/)

    healthy = true
    now += 31_000
    becomeVisible()
    await waitFor(() => expect(screen.queryByText(/Couldn't load the save/)).toBeNull())

    act(() => store.setNotice('Something else'))
    now += 31_000
    becomeVisible()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.getByText('Something else')).toBeTruthy()
  })
})

describe('Undo on notices', () => {
  it('is offered on an import summary but never on an error notice', async () => {
    fetchMock.mockImplementation(async () => new Promise(() => {})) // no polling result interferes
    renderShell(miniState({ settings: { showSpoilers: true, saveUrl: '', autoImport: true } }))
    act(() => { store.dispatch({ type: 'reset' }) }) // something undoable
    await waitFor(() => expect(store.canUndo).toBe(true))

    act(() => store.setNotice("Couldn't load the save from your URL: the server answered 404"))
    const error = await screen.findByRole('status')
    expect(within(error).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(store.canUndo).toBe(true)

    act(() => store.setNotice('Imported: 1 stacks, 5 gold, 0 recipes done, play time 0:01'))
    await waitFor(() => expect(within(screen.getByRole('status')).queryByRole('button', { name: 'Undo' })).not.toBeNull())
  })
})

const ownSettings = (over: Partial<AppState['settings']> = {}): AppState['settings'] => ({
  showSpoilers: true, saveUrl: '', autoImport: true, ...over,
})
const redirected = () => ({ ok: false, status: 0, type: 'opaqueredirect', arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response
const notFound = () => reply(new Uint8Array(0), 404)

describe('the effective save URL', () => {
  it("is the player's own URL when one is set, even with a built-in default", async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(reply(saveWithGold(250)))
    renderShell(miniState({ gold: GOLD_BEFORE, settings: ownSettings({ saveUrl: URL }) }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]![0]).toBe(URL)
  })

  it('is the built-in default when the box is empty: a relative URL is fetched and imported', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(reply(saveWithGold(250)))
    renderShell(miniState({ gold: GOLD_BEFORE, settings: ownSettings() }))
    await waitFor(() => expect(store.state.gold).toBe(250))
    expect(fetchMock.mock.calls[0]![0]).toBe('./save')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual', cache: 'no-store' })
    expect(store.state.lastImport?.source).toBe('url')
    await screen.findByText(/^Imported:/)
  })

  it('treats a box holding only spaces as empty', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(reply(saveWithGold(250)))
    renderShell(miniState({ settings: ownSettings({ saveUrl: '   ' }) }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]![0]).toBe('./save')
  })

  it('makes no request when neither the player nor the build has a URL', async () => {
    renderShell(miniState({ settings: ownSettings() }))
    becomeVisible()
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the automatic switch', () => {
  it('stops the check on open and on becoming visible', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(reply(saveWithGold(250)))
    renderShell(miniState({ gold: GOLD_BEFORE, settings: ownSettings({ autoImport: false }) }))
    now += 31_000
    becomeVisible()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.state.gold).toBe(GOLD_BEFORE)
  })

  it('does not stop Refresh now', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(reply(saveWithGold(250)))
    renderShell(miniState({ gold: GOLD_BEFORE, settings: ownSettings({ autoImport: false }) }))
    act(() => store.setTab('more'))
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }))
    await waitFor(() => expect(store.state.gold).toBe(250))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('takes effect as soon as it is switched off, without a reload', async () => {
    fetchMock.mockResolvedValue(reply(saveWithGold(250)))
    renderShell(miniState({ gold: GOLD_BEFORE, settings: ownSettings({ saveUrl: URL }) }))
    await waitFor(() => expect(store.state.gold).toBe(250))
    act(() => { store.dispatch({ type: 'setSetting', key: 'autoImport', value: false }) })
    now += 31_000
    becomeVisible()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('notices for a same-origin or built-in URL', () => {
  it('tells the player their sign-in expired when the server redirects', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(redirected())
    renderShell(miniState({ gold: GOLD_BEFORE, settings: ownSettings() }))
    await screen.findByText('Your sign-in to this site has expired. Reload the page.')
    expect(store.state.gold).toBe(GOLD_BEFORE)
  })

  it('says nothing about a missing built-in save on open, then explains it on Refresh now', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(notFound())
    renderShell(miniState({ settings: ownSettings() }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.queryByRole('status')).toBeNull()

    act(() => store.setTab('more'))
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }))
    await screen.findByText('No save has been synced to this server yet.')
  })

  it('clears the "no save" explanation again when an automatic check finds the server still empty', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(notFound())
    renderShell(miniState({ settings: ownSettings() }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    act(() => store.setTab('more'))
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }))
    await screen.findByText('No save has been synced to this server yet.')
    now += 31_000
    becomeVisible()
    await waitFor(() => expect(screen.queryByText(/No save has been synced/)).toBeNull())
  })

  it('keeps the old wording and the 404 message for a URL the player typed', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(notFound())
    renderShell(miniState({ settings: ownSettings({ saveUrl: URL }) }))
    await screen.findByText("Couldn't load the save from your URL: the server answered 404")
  })

  it('words other failures of the built-in URL as coming from this site', async () => {
    config.defaultSaveUrl = './save'
    fetchMock.mockResolvedValue(reply(new Uint8Array(0), 500))
    renderShell(miniState({ settings: ownSettings() }))
    await screen.findByText("Couldn't load the save from this site: the server answered 500")
  })
})
