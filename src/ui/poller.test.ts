import { describe, expect, it, vi } from 'vitest'
import { SaveError } from '../save/types'
import { hashBytes } from './import'
import { createSaveUrlPoller } from './poller'

const SAVE_SIZE = 23776
const URL = 'https://example.test/save.bin'
const PREFIX = "Couldn't load the save from your URL: "
const SITE_PREFIX = "Couldn't load the save from this site: "
const PAGE = 'https://planner.example.test/app/'
const SIGN_IN = 'Your sign-in to this site has expired. Reload the page.'
const NO_SAVE = 'No save has been synced to this server yet.'

function bytesOf(fill: number, length = SAVE_SIZE): Uint8Array {
  return new Uint8Array(length).fill(fill)
}
function reply(body: Uint8Array, status = 200, type = 'basic'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    type,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response
}

function setup(over: {
  fetchFn?: typeof fetch; url?: string; lastHash?: string | null; timeoutMs?: number; onSave?: (b: Uint8Array, h: string) => Promise<void>
  builtIn?: boolean; autoImport?: boolean; pageUrl?: string
} = {}) {
  let now = 1_000_000
  const fetchFn = vi.fn(over.fetchFn ?? (async () => reply(bytesOf(1))))
  const onSave = vi.fn(over.onSave ?? (async () => {}))
  const onNotice = vi.fn()
  const poller = createSaveUrlPoller({
    getUrl: () => over.url ?? URL,
    getLastHash: () => over.lastHash ?? null,
    isBuiltIn: () => over.builtIn ?? false,
    getAutoImport: () => over.autoImport ?? true,
    getPageUrl: () => over.pageUrl ?? PAGE,
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
  it('does not fetch when the automatic switch is off, but a manual refresh still does', async () => {
    const { poller, fetchFn, onSave, advance } = setup({ autoImport: false })
    await poller.trigger(false)
    advance(60_000)
    await poller.trigger(false)
    expect(fetchFn).not.toHaveBeenCalled()
    await poller.trigger(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not count a blocked automatic trigger towards the 30 s window', async () => {
    let auto = false
    let now = 0
    const fetchFn = vi.fn(async () => reply(bytesOf(1)))
    const poller = createSaveUrlPoller({
      getUrl: () => URL, getLastHash: () => null, getAutoImport: () => auto,
      fetchFn: fetchFn as unknown as typeof fetch, clock: () => now, onSave: async () => {}, onNotice: () => {},
    })
    await poller.trigger(false)
    auto = true
    now += 1000
    await poller.trigger(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('same-origin save URLs', () => {
  it('fetches a relative URL as given and imports it', async () => {
    const bytes = bytesOf(5)
    const { poller, fetchFn, onSave, onNotice } = setup({ url: './save', fetchFn: async () => reply(bytes) })
    await poller.trigger(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0]![0]).toBe('./save')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0]).toEqual(bytes)
    expect(onNotice).toHaveBeenLastCalledWith(null)
  })

  it.each([
    ['./save'], ['/save'], ['save'], [`${PAGE}save`], ['https://planner.example.test/other/save?x=1'],
  ])('fetches %s with redirects held back', async (url) => {
    const { poller, fetchFn } = setup({ url })
    await poller.trigger(true)
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ redirect: 'manual', cache: 'no-store' })
  })

  it.each([
    ['https://elsewhere.example.test/save'],
    ['http://planner.example.test/save'], // another scheme is another origin
    ['https://planner.example.test:8443/save'],
    ['//elsewhere.example.test/save'],
  ])('lets redirects be followed for %s', async (url) => {
    const { poller, fetchFn } = setup({ url })
    await poller.trigger(true)
    expect(fetchFn.mock.calls[0]![1]).not.toHaveProperty('redirect')
  })

  it('reports an expired sign-in for an opaque redirect, and nothing else', async () => {
    const { poller, onSave, onNotice } = setup({ url: './save', fetchFn: async () => reply(bytesOf(0, 0), 0, 'opaqueredirect') })
    await poller.trigger(true)
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(SIGN_IN)
  })

  it('reports an expired sign-in for a 3xx status', async () => {
    const { poller, onNotice } = setup({ url: './save', fetchFn: async () => reply(bytesOf(0, 0), 302) })
    await poller.trigger(true)
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(SIGN_IN)
  })

  it('reports the same thing for the built-in default, without the "from this site" prefix', async () => {
    const { poller, onNotice } = setup({ url: './save', builtIn: true, fetchFn: async () => reply(bytesOf(0, 0), 0, 'opaqueredirect') })
    await poller.trigger(false)
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(SIGN_IN)
  })

  it('does not call a cross-origin 3xx a sign-in problem', async () => {
    const { poller, onNotice } = setup({ fetchFn: async () => reply(bytesOf(0, 0), 302) })
    await poller.trigger(true)
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice.mock.calls[0]![0]).toBe(`${PREFIX}the server answered 302`)
  })

  it('still enforces the exact size on a same-origin answer', async () => {
    const { poller, onSave, onNotice } = setup({ url: './save', fetchFn: async () => reply(bytesOf(1, 5000)) })
    await poller.trigger(true)
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice.mock.calls[0]![0]).toContain('23,776')
  })

  it.each([
    ['./save'], ['save'], ['/save'], ['https://planner.example.test/elsewhere/save'], ['https://planner.example.test/'],
  ])('treats %s as same-origin', async (url) => {
    const { poller, fetchFn } = setup({ url })
    await poller.trigger(true)
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
  })

  it.each([
    ['/\\evil.example/save'], ['/\t/evil.example/save'], ['/\n/evil.example/save'], ['\\\\evil.example/save'],
    ['https://evil.example/save'], ['//evil.example/save'], ['https://planner.example.test.evil.example/save'],
  ])('treats %j as another origin', async (url) => {
    const { poller, fetchFn } = setup({ url })
    await poller.trigger(true)
    expect(fetchFn.mock.calls[0]![1]).not.toHaveProperty('redirect')
  })

  it.each([['http://[bad'], ['//[bad']])('ends in the ordinary failure notice, not a throw, for the malformed URL %s', async (url) => {
    const { poller, onSave, onNotice } = setup({ url, fetchFn: async () => { throw new TypeError('Failed to parse URL') } })
    await expect(poller.trigger(true)).resolves.toBeUndefined()
    expect(onSave).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice.mock.calls[0]![0]).toMatch(new RegExp(`^${PREFIX}network error`))
  })

  it('keeps a relative URL same-origin, and an absolute one not, when the page address cannot be read', async () => {
    const relative = setup({ url: './save', pageUrl: 'not a url' })
    await relative.poller.trigger(true)
    expect(relative.fetchFn.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
    const opaque = setup({ url: 'https://elsewhere.example.test/save', pageUrl: 'about:blank' })
    await opaque.poller.trigger(true)
    expect(opaque.fetchFn.mock.calls[0]![1]).not.toHaveProperty('redirect')
  })

  it('falls back to following redirects when the page address cannot be read', async () => {
    const { poller, fetchFn } = setup({ url: 'https://planner.example.test/save', pageUrl: 'not a url' })
    await poller.trigger(true)
    expect(fetchFn.mock.calls[0]![1]).not.toHaveProperty('redirect')
  })
})

describe('the built-in save URL', () => {
  it('stays quiet on an automatic 404', async () => {
    const { poller, onSave, onNotice } = setup({ url: './save', builtIn: true, fetchFn: async () => reply(bytesOf(0, 0), 404) })
    await poller.trigger(false)
    expect(onSave).not.toHaveBeenCalled()
    for (const call of onNotice.mock.calls) expect(call[0]).toBeNull()
  })

  it('clears an earlier failure notice on an automatic 404', async () => {
    let status = 503
    const { poller, onNotice, advance } = setup({ url: './save', builtIn: true, fetchFn: async () => reply(bytesOf(0, 0), status) })
    await poller.trigger(false)
    expect(onNotice).toHaveBeenLastCalledWith(`${SITE_PREFIX}the server answered 503`)
    status = 404
    advance(31_000)
    await poller.trigger(false)
    expect(onNotice).toHaveBeenLastCalledWith(null)
  })

  it('explains a 404 on a manual refresh', async () => {
    const { poller, onNotice } = setup({ url: './save', builtIn: true, fetchFn: async () => reply(bytesOf(0, 0), 404) })
    await poller.trigger(true)
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(NO_SAVE)
  })

  it('uses "from this site" for every other failure', async () => {
    const wrongSize = setup({ url: './save', builtIn: true, fetchFn: async () => reply(bytesOf(1, 5000)) })
    await wrongSize.poller.trigger(true)
    expect(wrongSize.onNotice.mock.calls[0]![0]).toMatch(new RegExp(`^${SITE_PREFIX}expected a save of 23,776 bytes`))

    const status = setup({ url: './save', builtIn: true, fetchFn: async () => reply(bytesOf(0, 0), 500) })
    await status.poller.trigger(true)
    expect(status.onNotice).toHaveBeenCalledWith(`${SITE_PREFIX}the server answered 500`)

    const failed = setup({ url: './save', builtIn: true, fetchFn: async () => { throw new TypeError('Failed to fetch') } })
    await failed.poller.trigger(true)
    expect(failed.onNotice.mock.calls[0]![0]).toMatch(new RegExp(`^${SITE_PREFIX}`))

    const unreadable = setup({
      url: './save', builtIn: true, onSave: async () => { throw new SaveError('empty', 'This save slot is empty') },
    })
    await unreadable.poller.trigger(true)
    expect(unreadable.onNotice).toHaveBeenCalledWith(`${SITE_PREFIX}This save slot is empty`)
  })

  it('keeps the old message for a 404 from a URL the player typed', async () => {
    const { poller, onNotice } = setup({ url: './save', builtIn: false, fetchFn: async () => reply(bytesOf(0, 0), 404) })
    await poller.trigger(false)
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(`${PREFIX}the server answered 404`)
  })
})
