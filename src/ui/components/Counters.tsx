import type { JSX } from 'preact'
import type { AppState } from '../../state/types'

export interface CountersProps {
  completed: number
  total: number
  milestones: number[]
  potLevel: AppState['potLevel']
  brews: AppState['brews']
  thresholds: { basic: number; improved: number }
}

function Counter(props: { label: string; value: number; target: number; detail?: string }): JSX.Element {
  const done = props.value >= props.target
  return (
    <li class="row counter">
      <span class="row-main">
        <span class="name">{props.label}</span>
        {props.detail !== undefined && <span class="meta">{props.detail}</span>}
      </span>
      <span class="count">{props.value} / {props.target}</span>
      {done && <span class="chip chip-ready">Done</span>}
    </li>
  )
}

/** A counter of a replaced pot that fell short: it can no longer be earned, so say so rather than hide it. */
function Missed(props: { label: string; value: number; target: number }): JSX.Element {
  return (
    <li class="row counter missed">
      <span class="meta">{`${props.label}: ${props.value} / ${props.target} — missed (the pot was upgraded)`}</span>
    </li>
  )
}

function milestoneText(completed: number, total: number, milestones: number[]): string | undefined {
  if (completed >= total) return undefined
  const next = [...milestones].sort((a, b) => a - b).find((m) => m > completed)
  if (next === undefined) return 'All milestones reached'
  return `Next milestone: ${next} (${next - completed} to go)`
}

/** Recipes done, plus the brew counter of the current pot; a finished counter of an earlier pot stays, marked Done, and an unfinished one is marked missed. */
export function Counters(props: CountersProps): JSX.Element {
  const { potLevel, brews, thresholds } = props
  const basicDone = brews.basic >= thresholds.basic
  const improvedDone = brews.improved >= thresholds.improved
  const showBasic = potLevel === 1 || basicDone
  const showImproved = potLevel === 2 || improvedDone
  const basicMissed = potLevel >= 2 && !basicDone
  const improvedMissed = potLevel >= 3 && !improvedDone
  return (
    <ul class="rows" aria-label="Progress">
      <Counter
        label="Recipes done"
        value={props.completed}
        target={props.total}
        detail={milestoneText(props.completed, props.total, props.milestones)}
      />
      {showBasic && <Counter label="Basic pot brews" value={brews.basic} target={thresholds.basic} />}
      {showImproved && <Counter label="Improved pot brews" value={brews.improved} target={thresholds.improved} />}
      {basicMissed && <Missed label="Basic pot brews" value={brews.basic} target={thresholds.basic} />}
      {improvedMissed && <Missed label="Improved pot brews" value={brews.improved} target={thresholds.improved} />}
    </ul>
  )
}
