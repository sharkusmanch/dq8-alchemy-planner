import { createContext } from 'preact'
import { useContext, useEffect, useMemo, useRef } from 'preact/hooks'
import { SAVE_SIZE } from '../save/layout'
import { hashBytes, importErrorMessage, importRawSave } from './import'
import { effectiveSaveUrl } from './save-url'
import { useStore } from './store'

export interface Poller {
  trigger(manual: boolean): Promise<void>
  dispose(): void
}

const AUTO_INTERVAL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 10_000
const PLAYER_PREFIX = "Couldn't load the save from your URL: "
const BUILT_IN_PREFIX = "Couldn't load the save from this site: "
const SIGNED_OUT = 'Your sign-in to this site has expired. Reload the page.'
const NO_SAVE_YET = 'No save has been synced to this server yet.'

class FetchProblem extends Error {}
/** The server redirected a same-origin request (typically to a sign-in page); shown as is, without the prefix. */
class SignInExpired extends FetchProblem {}
/** The built-in save URL answered 404: there is nothing to import yet, which is not an error to nag about. */
class NoSaveYet extends FetchProblem {}

/** Stands in for the page when its own address cannot give an origin (unreadable, or opaque like about:blank or file:). */
const UNKNOWN_PAGE = 'http://page.invalid/'

/**
 * Whether the URL, resolved the way fetch resolves it, lands on the page's origin. Always decided by the URL parser,
 * never by looking at the text: it reads a backslash like `/` and drops tabs and newlines, so `/\\host/x` and `/\t/host/x`
 * point at another site. A URL that does not parse is not same-origin (fetch will reject it).
 */
function isSameOrigin(url: string, pageUrl: string): boolean {
  try {
    let base = new URL(UNKNOWN_PAGE)
    try {
      const page = new URL(pageUrl)
      if (page.origin !== 'null') base = page
    } catch { /* keep the placeholder: relative URLs stay same-origin, absolute ones are judged against it */ }
    return new URL(url, base).origin === base.origin
  } catch {
    return false
  }
}

/**
 * At most one request in flight; automatic triggers are ignored within 30 s of the previous attempt; manual triggers always run.
 * Any successful fetch (2xx, exactly 23,776 bytes) ends with onNotice(null), changed bytes or not, so a notice from an
 * earlier failure goes away; the caller decides which notices that may clear.
 * Automatic triggers do nothing while getAutoImport() is false. A 404 from the built-in URL is quiet on an automatic
 * trigger (it too ends with onNotice(null)) and explained on a manual one.
 */
export function createSaveUrlPoller(opts: {
  /** The effective save URL: the player's own, or the build default; empty when there is none. */
  getUrl(): string
  /** True when getUrl() is the build default (the player's own box is empty). */
  isBuiltIn?(): boolean
  /** False stops automatic triggers; manual ones still run. Defaults to on. */
  getAutoImport?(): boolean
  /** The page's address, to tell a same-origin URL from another site's. Defaults to `location.href`. */
  getPageUrl?(): string
  getLastHash(): string | null
  /** Bytes with this hash count as unchanged for automatic triggers (a manual trigger still imports them). */
  getIgnoredHash?(): string | null
  fetchFn: typeof fetch
  clock(): number
  timeoutMs?: number
  onSave(bytes: Uint8Array, hash: string): Promise<void>
  onNotice(message: string | null): void
}): Poller {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let inFlight = false
  let disposed = false
  let lastAttempt: number | null = null
  let abort: AbortController | null = null

  async function download(url: string, builtIn: boolean, controller: AbortController): Promise<Uint8Array> {
    // A redirect on our own origin is usually a sign-in page; following it would end in a confusing CORS or size error.
    const sameOrigin = isSameOrigin(url, (opts.getPageUrl ?? (() => globalThis.location?.href ?? ''))())
    let timer: ReturnType<typeof setTimeout> | undefined
    // The abort signal alone is not enough: a fetch that ignores it must still stop waiting.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new FetchProblem(`no answer after ${timeoutMs / 1000} s (timed out)`))
      }, timeoutMs)
    })
    const request = (async () => {
      let response: Response
      try {
        response = await opts.fetchFn(url, { signal: controller.signal, cache: 'no-store', ...(sameOrigin ? { redirect: 'manual' as const } : {}) })
      } catch {
        throw new FetchProblem("network error, or the server doesn't allow this site to read it (CORS)")
      }
      if (sameOrigin && (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))) {
        throw new SignInExpired(SIGNED_OUT)
      }
      if (builtIn && response.status === 404) throw new NoSaveYet(NO_SAVE_YET)
      if (!response.ok) throw new FetchProblem(`the server answered ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    })()
    request.catch(() => {}) // a late failure after the timeout must not go unhandled
    try {
      return await Promise.race([request, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  async function run(manual: boolean): Promise<void> {
    const url = opts.getUrl().trim()
    const builtIn = opts.isBuiltIn?.() ?? false
    const prefix = builtIn ? BUILT_IN_PREFIX : PLAYER_PREFIX
    const controller = new AbortController()
    abort = controller
    try {
      const bytes = await download(url, builtIn, controller)
      if (disposed) return
      if (bytes.length !== SAVE_SIZE) {
        throw new FetchProblem(`expected a save of 23,776 bytes, got ${bytes.length.toLocaleString('en-US')} (is the URL a web page?)`)
      }
      const hash = await hashBytes(bytes)
      if (disposed) return
      const unchanged = hash === opts.getLastHash() || (!manual && hash === opts.getIgnoredHash?.())
      if (!unchanged) await opts.onSave(bytes, hash)
      if (!disposed) opts.onNotice(null)
    } catch (error) {
      if (disposed) return
      if (error instanceof NoSaveYet) opts.onNotice(manual ? error.message : null)
      else if (error instanceof SignInExpired) opts.onNotice(error.message)
      else if (error instanceof FetchProblem) opts.onNotice(`${prefix}${error.message}`)
      else opts.onNotice(`${prefix}${importErrorMessage(error)}`)
    } finally {
      abort = null
    }
  }

  return {
    async trigger(manual: boolean): Promise<void> {
      if (disposed || inFlight || opts.getUrl().trim() === '') return
      if (!manual && opts.getAutoImport?.() === false) return
      const now = opts.clock()
      if (!manual && lastAttempt !== null && now - lastAttempt < AUTO_INTERVAL_MS) return
      lastAttempt = now
      inFlight = true
      try {
        await run(manual)
      } finally {
        inFlight = false
      }
    },
    dispose(): void {
      disposed = true
      abort?.abort()
    },
  }
}

/** The app's single poller, shared with the More tab's "Refresh now". */
export const PollerContext = createContext<Poller | null>(null)
export const usePoller = (): Poller | null => useContext(PollerContext)

/**
 * Builds the poller wired to the store. A successful import shows its summary as the notice (with Undo);
 * a poller error notice is cleared again by the next successful poll, and only that notice.
 *
 * Undoing a URL import (or replacing or resetting it by hand) puts the previous `lastImport` back, which would make the
 * next automatic poll import the same bytes again. So the hash of a URL import the user has moved away from is
 * remembered and ignored by automatic polls until different bytes arrive or the user presses "Refresh now".
 */
export function useSaveUrlPoller(): Poller {
  const store = useStore()
  const latest = useRef(store)
  latest.current = store
  const shownError = useRef<string | null>(null)
  const urlImported = useRef<string | null>(null) // hash of the URL import the state currently holds
  const dismissed = useRef<string | null>(null) // hash of a URL import the user moved away from

  const lastHash = store.state.lastImport?.hash ?? null
  useEffect(() => {
    if (urlImported.current !== null && lastHash !== urlImported.current) {
      dismissed.current = urlImported.current
      urlImported.current = null
    }
  }, [lastHash])

  return useMemo(() => createSaveUrlPoller({
    getUrl: () => effectiveSaveUrl(latest.current.state.settings.saveUrl).url,
    isBuiltIn: () => effectiveSaveUrl(latest.current.state.settings.saveUrl).builtIn,
    getAutoImport: () => latest.current.state.settings.autoImport,
    getLastHash: () => latest.current.state.lastImport?.hash ?? null,
    getIgnoredHash: () => dismissed.current,
    fetchFn: (input, init) => fetch(input, init),
    clock: () => Date.now(),
    onSave: async (bytes, hash) => {
      const before = { urlImported: urlImported.current, dismissed: dismissed.current }
      urlImported.current = hash // set before the dispatch, so the effect above sees a URL import, not a replacement
      dismissed.current = null
      try {
        const summary = await importRawSave(bytes, 'url', latest.current, () => new Date().toISOString())
        shownError.current = null
        latest.current.setNotice(summary)
      } catch (error) {
        urlImported.current = before.urlImported
        dismissed.current = before.dismissed
        throw error
      }
    },
    onNotice: (message) => {
      if (message !== null) {
        shownError.current = message
        latest.current.setNotice(message)
      } else if (shownError.current !== null) {
        if (latest.current.notice === shownError.current) latest.current.setNotice(null)
        shownError.current = null
      }
    },
  }), [])
}
