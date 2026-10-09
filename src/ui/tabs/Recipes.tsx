import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Recipe } from '../../data/types'
import { makeContext } from '../../planner/context'
import { planAll } from '../../planner/acquire'
import type { RecipePlan, RecipeStatus } from '../../planner/types'
import { STATUS_LABELS, StatusChip } from '../components/StatusChip'
import { EQUIPPED_NOTE, equippedCount } from '../equipped'
import { useStore } from '../store'

const STATUSES = Object.keys(STATUS_LABELS) as RecipeStatus[]

export function Recipes(): JSX.Element {
  const { state, index, dispatch, recipeFilter } = useStore()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<RecipeStatus | 'all'>(recipeFilter ?? 'all')
  useEffect(() => { setStatus(recipeFilter ?? 'all') }, [recipeFilter])

  const planned = useMemo(() => {
    try {
      const plans = new Map<number, RecipePlan>()
      for (const plan of planAll(makeContext(index, state))) plans.set(plan.recipe, plan)
      return { plans, error: null as string | null }
    } catch (error) {
      return { plans: new Map<number, RecipePlan>(), error: error instanceof Error ? error.message : String(error) }
    }
  }, [index, state])

  const recipes = useMemo(
    () => [...index.data.recipes].sort((a, b) => a.recipeIndex - b.recipeIndex),
    [index],
  )
  const needle = query.trim().toLowerCase()
  const nameOf = (id: string) => (index.hasItem(id) ? index.item(id).name : id)
  const visible = recipes.filter((recipe: Recipe) => {
    const plan = planned.plans.get(recipe.recipeIndex)
    if (status !== 'all' && plan?.status !== status) return false
    if (needle === '') return true
    return [recipe.result, ...recipe.ingredients].some((id) => nameOf(id).toLowerCase().includes(needle))
  })
  const hidden = state.settings.showSpoilers
    ? []
    : visible.filter((recipe) => planned.plans.get(recipe.recipeIndex)?.status === 'blocked')
  const shown = hidden.length === 0 ? visible : visible.filter((recipe) => !hidden.includes(recipe))
  const doneCount = state.completed.length

  return (
    <div class="tab">
      <h1>Recipes</h1>
      <p class="meta">{doneCount} of {recipes.length} done</p>

      <div class="filters">
        <input
          type="search"
          aria-label="Search recipes"
          placeholder="Search by result or ingredient"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.currentTarget.value as RecipeStatus | 'all')}
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {planned.error !== null && (
        <p class="error" role="alert">Couldn't work out recipe statuses: {planned.error}</p>
      )}

      {shown.length > 0 && (
        <ul class="rows" aria-label="Recipes">
          {shown.map((recipe) => {
            const plan = planned.plans.get(recipe.recipeIndex)
            const completed = state.completed.includes(recipe.recipeIndex)
            const result = nameOf(recipe.result)
            // Missing items that a character is wearing: nothing to find, only to unequip.
            const worn = [...new Set([...(plan?.gather.map((g) => g.item) ?? []), ...(plan?.blockedBy ?? [])])]
              .filter((item) => equippedCount(state, item) > 0)
            return (
              <li class="row recipe" key={recipe.recipeIndex}>
                <span class="row-main">
                  <span class="name">{result}</span>
                  <span class="meta">{recipe.ingredients.map(nameOf).join(' + ')}</span>
                  <span class="meta">
                    Recipe {recipe.recipeIndex}
                    {state.pot?.recipe === recipe.recipeIndex ? ' · in the pot' : ''}
                    {recipe.recipeIndexUnconfirmed ? ' · save number unconfirmed' : ''}
                  </span>
                  {worn.map((item) => <span class="meta" key={item}>{`${nameOf(item)}: ${EQUIPPED_NOTE}`}</span>)}
                </span>
                {plan && <StatusChip status={plan.status} />}
                <button
                  type="button"
                  class="toggle"
                  aria-pressed={completed}
                  aria-label={`Done: ${result} (recipe ${recipe.recipeIndex})`}
                  onClick={() => dispatch({ type: 'toggleCompleted', recipe: recipe.recipeIndex })}
                >
                  Done
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {shown.length === 0 && hidden.length === 0 && (
        <p class="empty">{recipes.length === 0 ? 'No recipe data loaded.' : 'No recipes match.'}</p>
      )}
      {hidden.length > 0 && <p class="later">{hidden.length} more later in the story</p>}
    </div>
  )
}
