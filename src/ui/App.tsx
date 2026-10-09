import type { JSX } from 'preact'
import { useEffect } from 'preact/hooks'
import './styles.css'
import { Notice } from './components/Notice'
import { TabBar } from './components/TabBar'
import { isUndoableNotice } from './import'
import { PollerContext, useSaveUrlPoller } from './poller'
import { StoreProvider, useStore, type TabId } from './store'
import { Bag } from './tabs/Bag'
import { More } from './tabs/More'
import { Next } from './tabs/Next'
import { Recipes } from './tabs/Recipes'
import { Shop } from './tabs/Shop'

const SCREENS: Record<TabId, () => JSX.Element> = { next: Next, shop: Shop, bag: Bag, recipes: Recipes, more: More }

/** The shell without its provider, so tests can supply a fixture store. */
export function AppShell(): JSX.Element {
  const { tab, setTab, notice, setNotice, canUndo, undo } = useStore()
  const Screen = SCREENS[tab]
  const poller = useSaveUrlPoller()

  // Check the save URL on open and whenever the app becomes visible again; the poller ignores both when there is no
  // effective URL or when the player has switched automatic checks off.
  useEffect(() => {
    void poller.trigger(false)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poller.trigger(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      poller.dispose()
    }
  }, [poller])

  useEffect(() => {
    try { window.scrollTo(0, 0) } catch { /* not available in every environment */ }
  }, [tab])

  return (
    <PollerContext.Provider value={poller}>
      <div class="app">
        {notice !== null && (
          <Notice
            message={notice}
            onDismiss={() => setNotice(null)}
            action={canUndo && isUndoableNotice(notice) ? { label: 'Undo', run: () => { undo(); setNotice(null) } } : undefined}
          />
        )}
        <main>
          <Screen />
        </main>
        <TabBar tab={tab} onSelect={(next) => setTab(next)} />
      </div>
    </PollerContext.Provider>
  )
}

export function App(): JSX.Element {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  )
}
