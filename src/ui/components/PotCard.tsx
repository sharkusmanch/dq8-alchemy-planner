import type { JSX } from 'preact'
import type { DataIndex } from '../../data/types'
import type { AppState } from '../../state/types'

/** What is in the pot, with the Collect button; a quiet line when it is empty. */
export function PotCard(props: { pot: AppState['pot']; index: DataIndex; onCollect(): void }): JSX.Element {
  const { pot, index } = props
  if (!pot) {
    return (
      <section class="card" aria-label="Pot">
        <p class="meta">The pot is empty.</p>
      </section>
    )
  }
  const name = index.hasItem(pot.result) ? index.item(pot.result).name : pot.result
  return (
    <section class="card pot-card" aria-label="Pot">
      <div class="row-main">
        <span class="meta">In the pot</span>
        <span class="name">{name}</span>
        {pot.recipe !== null && <span class="meta">Recipe {pot.recipe}</span>}
      </div>
      <button type="button" class="action" onClick={props.onCollect}>Collect</button>
    </section>
  )
}
