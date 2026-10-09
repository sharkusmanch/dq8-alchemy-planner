import { createContext, type ComponentChildren, type JSX } from 'preact'
import { useCallback, useContext, useMemo, useRef, useState } from 'preact/hooks'
import { index as realIndex } from '../data'
import type { DataIndex } from '../data/types'
import type { RecipeStatus } from '../planner/types'
import { loadState, saveState } from '../state/persist'
import { initialState, reduce } from '../state/reducer'
import type { Action, AppState } from '../state/types'

export type TabId = 'next' | 'shop' | 'bag' | 'recipes' | 'more'

export interface Store {
  state: AppState
  index: DataIndex
  /** Returns the error message when the action was rejected, otherwise undefined. */
  dispatch(action: Action): string | undefined
  undo(): void
  canUndo: boolean
  notice: string | null
  setNotice(n: string | null): void
  tab: TabId
  setTab(tab: TabId, recipeFilter?: RecipeStatus): void
  recipeFilter: RecipeStatus | null
}

/** Actions that replace the whole picture of the game; the state before them can be restored once. */
const UNDOABLE: ReadonlySet<Action['type']> = new Set(['applySnapshot', 'importState', 'reset'])

const StoreContext = createContext<Store | null>(null)

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined // blocked storage: run in memory
  }
}

export function StoreProvider(props: {
  children: ComponentChildren
  storage?: Storage
  index?: DataIndex
  initial?: AppState
}): JSX.Element {
  const index = props.index ?? realIndex
  const storage = props.storage ?? defaultStorage()

  const [state, setState] = useState<AppState>(
    () => props.initial ?? (storage ? loadState(storage, index) : initialState(index)),
  )
  // The reducer must see the latest state even for several dispatches in one tick.
  const current = useRef(state)
  const previous = useRef<AppState | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTabState] = useState<TabId>('next')
  const [recipeFilter, setRecipeFilter] = useState<RecipeStatus | null>(null)

  const commit = useCallback((next: AppState) => {
    current.current = next
    setState(next)
    if (storage) saveState(storage, next)
  }, [storage])

  const dispatch = useCallback((action: Action): string | undefined => {
    const result = reduce(current.current, action, index)
    if (result.error !== undefined) return result.error
    if (result.state === current.current) return undefined
    if (UNDOABLE.has(action.type)) {
      previous.current = current.current
      setCanUndo(true)
    } else if (previous.current) {
      previous.current = null
      setCanUndo(false)
    }
    commit(result.state)
    return undefined
  }, [index, commit])

  const undo = useCallback(() => {
    const before = previous.current
    if (!before) return
    previous.current = null
    setCanUndo(false)
    commit(before)
  }, [commit])

  const setTab = useCallback((next: TabId, filter?: RecipeStatus) => {
    setTabState(next)
    setRecipeFilter(filter ?? null)
  }, [])

  const value = useMemo<Store>(() => ({
    state, index, dispatch, undo, canUndo, notice, setNotice, tab, setTab, recipeFilter,
  }), [state, index, dispatch, undo, canUndo, notice, tab, setTab, recipeFilter])

  return <StoreContext.Provider value={value}>{props.children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside a StoreProvider')
  return store
}
