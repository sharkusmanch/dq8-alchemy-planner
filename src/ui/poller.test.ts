import { describe, expect, it, vi } from 'vitest'
import { SaveError } from '../save/types'
import { hashBytes } from './import'
import { createSaveUrlPoller } from './poller'

const SAVE_SIZE = 23776
const URL = 'https://example.test/save.bin'
const PREFIX = "Couldn't load the save from your URL: "

function bytesOf(fill: number, length = SAVE_SIZE): Uint8Array {
  return new Uint8Array(length).fill(fill)
}
function reply(body: Uint8Array, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response
}

function setup(over: { fetchFn?: typeof fetch; url?: string; lastHash?: string | null; timeoutMs?: number; onSave?: (b: Uint8Array, h: string) => Promise<void> } = {}) {
  let now = 1_000_000
  const fetchFn = vi.fn(over.fetchFn ?? (async () => reply(bytesOf(1))))
  const onSave = vi.fn(over.onSave ?? (async () => {}))
  const onNotice = vi.fn()
  const poller = createSaveUrlPoller({
    getUrl: () => over.url ?? URL,
    getLastHash: () => over.lastHash ?? null,
    fetchFn: fetchFn as unknown as typeof fetch,
    clock: () => now,
    timeoutMs: over.timeoutMs,
    onSave,
    onNotice,
  })
  return { poller, fetchFn, onSave, onNotice, advance: (ms: number) => { now += ms } }
}

describe('save URL poller', () => {
  it('does nothing and makes no request when no URL is set', async () => {
    const { poller, fetchFn, onSave, onNotice } = setup({ url: '' })
    await poller.trigger(true)
    await poller.trigger(false)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).not.toHaveBeenCalled()
  })

  it('shows one notice and imports nothing for an HTML page of the wrong size', async () => {
    const { poller, onSave, onNotice } = setup({ fetchFn: async () => reply(bytesOf(60, 5000)) })
    await poller.trigger(true)
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice.mock.calls[0]![0]).toMatch(new RegExp(`^${PREFIX}`))
    expect(onNotice.mock.calls[0]![0]).toContain('23,776')
  })

  it('shows a notice naming the status for a 404', async () => {
    const { poller, onSave, onNotice } = setup({ fetchFn: async () => reply(bytesOf(0), 404) })
    await poller.trigger(true)
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice.mock.calls[0]![0]).toMatch(/404/)
  })

  it('shows a notice when the fetch is rejected (network or CORS)', async () => {
    const { poller, onSave, onNotice } = setup({ fetchFn: async () => { throw new TypeError('Failed to fetch') } })
    await poller.trigger(true)
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice.mock.calls[0]![0]).toMatch(new RegExp(`^${PREFIX}`))
  })

  it('times out a request that never answers, aborting it', async () => {
    let signal: AbortSignal | undefined
    const { poller, onSave, onNotice } = setup({
      timeoutMs: 10,
      fetchFn: ((_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise(() => {}) }) as unknown as typeof fetch,
    })
    await poller.trigger(true)
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice.mock.calls[0]![0]).toMatch(/timed out/i)
    expect(signal?.aborted).toBe(true)
  })

  it('hands valid bytes and their hash to onSave, then clears the notice', async () => {
    const bytes = bytesOf(7)
    const { poller, onSave, onNotice } = setup({ fetchFn: async () => reply(bytes) })
    await poller.trigger(true)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0]).toEqual(bytes)
    expect(onSave.mock.calls[0]![1]).toBe(await hashBytes(bytes))
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(null)
    expect(onSave.mock.invocationCallOrder[0]!).toBeLessThan(onNotice.mock.invocationCallOrder[0]!)
  })

  it('does not import bytes that are already imported, but still reports the fetch as healthy', async () => {
    const bytes = bytesOf(7)
    const { poller, fetchFn, onSave, onNotice } = setup({ fetchFn: async () => reply(bytes), lastHash: await hashBytes(bytes) })
    await poller.trigger(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(null)
  })

  it('clears the failure notice when a later fetch succeeds with unchanged bytes', async () => {
    const bytes = bytesOf(7)
    let fail = true
    const { poller, onSave, onNotice, advance } = setup({
      fetchFn: async () => (fail ? reply(bytesOf(0), 503) : reply(bytes)),
      lastHash: await hashBytes(bytes),
    })
    await poller.trigger(false)
    expect(onNotice).toHaveBeenLastCalledWith(expect.stringMatching(/^Couldn't load the save/))
    fail = false
    advance(31_000)
    await poller.trigger(false)
    expect(onNotice).toHaveBeenLastCalledWith(null)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not report success when the response is not a save', async () => {
    const { poller, onNotice } = setup({ fetchFn: async () => reply(bytesOf(0, 100)) })
    await poller.trigger(true)
    expect(onNotice).not.toHaveBeenCalledWith(null)
  })

  it('treats an ignored hash as unchanged for automatic triggers only', async () => {
    const bytes = bytesOf(9)
    const hash = await hashBytes(bytes)
    let now = 0
    const onSave = vi.fn(async () => {})
    const fetchFn = vi.fn(async () => reply(bytes))
    const poller = createSaveUrlPoller({
      getUrl: () => URL, getLastHash: () => null, getIgnoredHash: () => hash,
      fetchFn: fetchFn as unknown as typeof fetch, clock: () => now, onSave, onNotice: () => {},
    })
    await poller.trigger(false)
    expect(onSave).not.toHaveBeenCalled()
    now += 31_000
    await poller.trigger(true)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('shows a notice, not a crash, when the import itself fails', async () => {
    const { poller, onNotice } = setup({ onSave: async () => { throw new SaveError('empty', 'This save slot is empty') } })
    await poller.trigger(true)
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(`${PREFIX}This save slot is empty`)
  })

  it('ignores an automatic trigger within 30 s of the previous attempt', async () => {
    const { poller, fetchFn, advance } = setup()
    await poller.trigger(false)
    advance(5000)
    await poller.trigger(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    advance(25_000)
    await poller.trigger(false)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('counts a failed attempt towards the 30 s window', async () => {
    const { poller, fetchFn, advance } = setup({ fetchFn: async () => reply(bytesOf(0), 500) })
    await poller.trigger(false)
    advance(1000)
    await poller.trigger(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('always runs a manual trigger, even inside the window', async () => {
    const { poller, fetchFn, advance } = setup()
    await poller.trigger(false)
    advance(1000)
    await poller.trigger(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('keeps at most one request in flight, manual or not', async () => {
    let release: (r: Response) => void = () => {}
    const { poller, fetchFn, onSave } = setup({
      fetchFn: (() => new Promise<Response>((resolve) => { release = resolve })) as unknown as typeof fetch,
    })
    const first = poller.trigger(true)
    const second = poller.trigger(true)
    const third = poller.trigger(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    release(reply(bytesOf(3)))
    await Promise.all([first, second, third])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('drops the result of a request that finishes after dispose', async () => {
    let release: (r: Response) => void = () => {}
    const { poller, fetchFn, onSave, onNotice } = setup({
      fetchFn: (() => new Promise<Response>((resolve) => { release = resolve })) as unknown as typeof fetch,
    })
    const pending = poller.trigger(true)
    poller.dispose()
    release(reply(bytesOf(3)))
    await pending
    await poller.trigger(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).not.toHaveBeenCalled()
  })
})
