import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { DataIndex, ItemId } from '../../data/types'
import { consumesScarce } from '../../planner'
import type { Purchase, RecipePlan } from '../../planner'
import type { AppState } from '../../state/types'
import { equippedCount } from '../equipped'
import { useStore } from '../store'
import { StatusChip } from './StatusChip'

const nameOf = (index: DataIndex, id: ItemId) => (index.hasItem(id) ? index.item(id).name : id)
const unique = <T,>(values: T[]) => [...new Set(values)]

function purchaseCost(purchases: Purchase[]): number {
  return purchases.reduce((sum, p) => sum + p.qty * p.unitPrice, 0)
}

interface Need { item: ItemId; have: number; need: number }

/**
 * What the player must hold before starting: the ingredients of every step, minus what earlier steps of the
 * same entry make. `have` counts the pot's pending result, as the planner does. Items still to be bought show
 * as short until the Bought button is pressed, and the Buy line says what to get. A short item that a character
 * has equipped says so, since unequipping it may be all that is needed.
 */
function externalNeeds(index: DataIndex, state: AppState, plan: RecipePlan): Need[] {
  const made = new Map<ItemId, number>()
  const need = new Map<ItemId, number>()
  for (const step of plan.steps) {
    const recipe = index.recipe(step.recipe)
    for (const ingredient of recipe.ingredients) {
      const available = made.get(ingredient) ?? 0
      if (available > 0) made.set(ingredient, available - 1)
      else need.set(ingredient, (need.get(ingredient) ?? 0) + 1)
    }
    made.set(recipe.result, (made.get(recipe.result) ?? 0) + 1)
  }
  const stock = (item: ItemId) => (state.inventory[item] ?? 0) + (state.pot?.result === item ? 1 : 0)
  return [...need].map(([item, count]) => ({ item, need: count, have: stock(item) }))
}

/**
 * One brew the player can do: result, ingredients with have/need, purchases, steps, and the Bought / Brewed
 * buttons. While the pot takes time (levels 1 and 2) each step is a separate trip to the pot, so the button
 * brews only the first step and the queue re-plans around the pot's pending result. The instant pot (level 3)
 * brews every step in order and stops at the first the game rejects. A repeat brew that would use up a scarce
 * item asks first, inline: as a step of a queued plan it says which plan, on its own it warns more strongly.
 */
export function QueueEntry(props: { plan: RecipePlan; badge?: string; note?: string }): JSX.Element {
  const { plan } = props
  const { state, index, dispatch } = useStore()
  const [error, setError] = useState<string | null>(null)
  const [scarceItems, setScarceItems] = useState<string[] | null>(null)
  const result = nameOf(index, index.recipe(plan.recipe).result)
  const needs = externalNeeds(index, state, plan)
  const cost = purchaseCost(plan.purchases)
  const multi = plan.steps.length > 1
  const instant = state.potLevel === 3
  const stepResult = (i: number) => nameOf(index, index.recipe(plan.steps[i]!.recipe).result)
  const brewLabel = !multi ? 'Brewed' : instant ? `Brewed all ${plan.steps.length} steps` : `Brewed ${stepResult(0)}`
  // The page repeats these buttons, so each one's accessible name says what it brews or buys. The name
  // always starts with the visible label.
  const brewName = !multi ? `Brewed ${result}` : instant ? `${brewLabel} for ${result}` : brewLabel
  const boughtName = `Bought ${plan.purchases.map((p) => `${p.qty} ${nameOf(index, p.item)}`).join(', ')}`
  // A queued plan ends in the mandatory brew it is for; a brew offered on its own (the filler) has none.
  const queuedPlan = plan.steps.some((step) => step.mandatory)

  const bought = () => {
    setError(null)
    for (const purchase of plan.purchases) {
      const problem = dispatch({ type: 'buy', item: purchase.item, qty: purchase.qty })
      if (problem !== undefined) { setError(problem); return }
    }
  }

  /** The steps this press brews: all of them in the instant pot, otherwise just the first. */
  const stepsToBrew = () => (instant ? plan.steps : plan.steps.slice(0, 1))

  const run = () => {
    setError(null)
    setScarceItems(null)
    const steps = stepsToBrew()
    for (let i = 0; i < steps.length; i++) {
      const problem = dispatch({ type: 'brew', recipe: steps[i]!.recipe })
      if (problem === undefined) continue
      if (steps.length === 1) { setError(problem); return }
      const done = i === 0 ? 'Nothing was brewed.' : `Steps 1 to ${i} were brewed.`
      setError(`Step ${i + 1} of ${steps.length} (${stepResult(i)}) failed: ${problem}. ${done}`)
      return
    }
  }

  const brewed = () => {
    setError(null)
    const scarce = unique(stepsToBrew().flatMap((step) => consumesScarce(index, state, step.recipe)))
    if (scarce.length > 0) setScarceItems(scarce.map((item) => nameOf(index, item)))
    else run()
  }

  return (
    <li class="entry">
      <div class="entry-head">
        <h3 class="name">{result}</h3>
        <StatusChip status={plan.status} />
      </div>
      {props.badge !== undefined && <p class="warn">{props.badge}</p>}
      {props.note !== undefined && <p class="meta">{props.note}</p>}
      <div class="ingredients">
        {needs.map((n) => (
          <div class={n.have >= n.need ? 'ing' : 'ing short'} key={n.item}>
            {`${nameOf(index, n.item)}: have ${n.have} / need ${n.need}${
              n.have < n.need && equippedCount(state, n.item) > 0 ? ` (${equippedCount(state, n.item)} equipped)` : ''
            }`}
          </div>
        ))}
      </div>
      {plan.purchases.length > 0 && (
        <p class="buy">
          {`Buy ${plan.purchases.map((p) => `${p.qty} × ${nameOf(index, p.item)}`).join(', ')} for ${cost} g`}
        </p>
      )}
      {multi && (
        <ol class="steps" aria-label={`Steps for ${result}`}>
          {plan.steps.map((step, i) => {
            const recipe = index.recipe(step.recipe)
            const text = `Brew ${nameOf(index, recipe.result)} from ${recipe.ingredients.map((id) => nameOf(index, id)).join(' + ')}`
            return <li key={step.recipe}>{!instant && i > 0 ? `then: ${text}` : text}</li>
          })}
        </ol>
      )}
      {error !== null && <p class="error" role="alert">{error}</p>}
      {scarceItems !== null ? (
        <div class="confirm" role="alert">
          <p>
            {queuedPlan
              ? `This uses your ${scarceItems.join(', ')} — ${scarceItems.length === 1 ? 'it is' : 'they are'} scarce. It is part of the plan for ${result}.`
              : `This uses your ${scarceItems.join(', ')}, which you still need for other recipes.`}
          </p>
          <button type="button" class="action" onClick={run}>Brew anyway</button>
          <button type="button" onClick={() => setScarceItems(null)}>Cancel</button>
        </div>
      ) : (
        <div class="entry-actions">
          {plan.purchases.length > 0 && <button type="button" aria-label={boughtName} onClick={bought}>Bought</button>}
          <button type="button" class="action" aria-label={brewName} onClick={brewed}>{brewLabel}</button>
        </div>
      )}
    </li>
  )
}
