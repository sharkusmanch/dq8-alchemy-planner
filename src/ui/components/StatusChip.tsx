import type { JSX } from 'preact'
import type { RecipeStatus } from '../../planner/types'

export const STATUS_LABELS: Record<RecipeStatus, string> = {
  done: 'Done',
  ready: 'Ready',
  buy: 'Buy',
  chain: 'Chain',
  gather: 'Gather',
  blocked: 'Blocked',
  later: 'Later',
}

export function StatusChip(props: { status: RecipeStatus }): JSX.Element {
  return <span class={`chip chip-${props.status}`}>{STATUS_LABELS[props.status]}</span>
}
