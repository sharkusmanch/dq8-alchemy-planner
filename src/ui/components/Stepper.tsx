import type { JSX } from 'preact'

/** A − / count / + control. `label` is the thing being counted, used for the accessible names. */
export function Stepper(props: { label: string; value: number; onChange(delta: number): void }): JSX.Element {
  return (
    <div class="stepper" role="group" aria-label={`${props.label} quantity`}>
      <button type="button" aria-label={`Decrease ${props.label}`} onClick={() => props.onChange(-1)}>−</button>
      <span class="count">{props.value}</span>
      <button type="button" aria-label={`Increase ${props.label}`} onClick={() => props.onChange(1)}>+</button>
    </div>
  )
}
