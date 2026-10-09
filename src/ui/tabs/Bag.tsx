import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { Category, Item } from '../../data/types'
import { Stepper } from '../components/Stepper'
import { useStore } from '../store'

const CATEGORY_LABELS: Record<Category, string> = {
  weapon: 'Weapons',
  armour: 'Armour',
  shield: 'Shields',
  helmet: 'Helmets',
  accessory: 'Accessories',
  item: 'Items',
  cheese: 'Cheese',
  other: 'Other',
}
const ADD_RESULT_LIMIT = 20

const matches = (item: Item, query: string) => item.name.toLowerCase().includes(query.trim().toLowerCase())
const byName = (a: Item, b: Item) => a.name.localeCompare(b.name)

export function Bag(): JSX.Element {
  const { state, index, dispatch } = useStore()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [addQuery, setAddQuery] = useState('')

  const categories = useMemo(
    () => [...new Set(index.data.items.map((item) => item.category))],
    [index],
  )
  const owned = Object.entries(state.inventory)
    .filter(([id, qty]) => qty > 0 && index.hasItem(id))
    .map(([id, qty]) => ({ item: index.item(id), qty }))
    .filter(({ item }) => (category === 'all' || item.category === category) && matches(item, query))
    .sort((a, b) => byName(a.item, b.item))
  const ownedCount = Object.values(state.inventory).filter((qty) => qty > 0).length

  const addResults = addQuery.trim() === ''
    ? []
    : index.data.items.filter((item) => matches(item, addQuery)).sort(byName)
  const equipped = Object.entries(state.equipped)
    .filter(([id, qty]) => qty > 0 && index.hasItem(id))
    .map(([id, qty]) => ({ item: index.item(id), qty }))
    .sort((a, b) => byName(a.item, b.item))

  return (
    <div class="tab">
      <h1>Bag</h1>

      <div class="filters">
        <input
          type="search"
          aria-label="Search bag"
          placeholder="Search bag"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.currentTarget.value as Category | 'all')}
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>

      {owned.length > 0 ? (
        <ul class="rows" aria-label="Owned items">
          {owned.map(({ item, qty }) => (
            <li class="row" key={item.id}>
              <span class="row-main">
                <span class="name">{item.name}</span>
                <span class="meta">{CATEGORY_LABELS[item.category]}</span>
              </span>
              <Stepper
                label={item.name}
                value={qty}
                onChange={(delta) => dispatch({ type: 'adjustItem', item: item.id, delta })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p class="empty">
          {ownedCount === 0 ? 'Nothing in the bag yet. Add items below or import a save in More.' : 'Nothing matches.'}
        </p>
      )}

      <section aria-labelledby="bag-add">
        <h2 id="bag-add">Add item</h2>
        <input
          type="search"
          aria-label="Add item"
          placeholder="Search all items"
          value={addQuery}
          onInput={(e) => setAddQuery(e.currentTarget.value)}
        />
        {addQuery.trim() !== '' && addResults.length === 0 && <p class="empty">No item has that name.</p>}
        {addResults.length > 0 && (
          <ul class="rows" aria-label="Matching items">
            {addResults.slice(0, ADD_RESULT_LIMIT).map((item) => (
              <li class="row" key={item.id}>
                <span class="row-main">
                  <span class="name">{item.name}</span>
                  <span class="meta">{CATEGORY_LABELS[item.category]} · have {state.inventory[item.id] ?? 0}</span>
                </span>
                <button type="button" class="action" aria-label={`Add ${item.name}`} onClick={() => dispatch({ type: 'adjustItem', item: item.id, delta: 1 })}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
        {addResults.length > ADD_RESULT_LIMIT && (
          <p class="meta">Showing {ADD_RESULT_LIMIT} of {addResults.length}. Type more to narrow it down.</p>
        )}
      </section>

      <section aria-labelledby="bag-equipped">
        <h2 id="bag-equipped">Equipped</h2>
        {equipped.length > 0 ? (
          <ul class="rows">
            {equipped.map(({ item, qty }) => (
              <li class="row" key={item.id}>
                <span class="row-main">
                  <span class="name">{item.name}</span>
                  <span class="meta">{CATEGORY_LABELS[item.category]}</span>
                </span>
                <span class="count">×{qty}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="empty">Nothing equipped. Import a save to see what the party wears.</p>
        )}
      </section>
    </div>
  )
}
