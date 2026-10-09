import type { JSX } from 'preact'
import type { TabId } from '../store'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'next', label: 'Next' },
  { id: 'shop', label: 'Shop' },
  { id: 'bag', label: 'Bag' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'more', label: 'More' },
]

export function TabBar(props: { tab: TabId; onSelect(tab: TabId): void }): JSX.Element {
  return (
    <nav class="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          aria-current={t.id === props.tab ? 'page' : undefined}
          onClick={() => props.onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
