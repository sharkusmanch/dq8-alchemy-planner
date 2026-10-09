import type { JSX } from 'preact'

export function Notice(props: {
  message: string
  onDismiss(): void
  action?: { label: string; run(): void }
}): JSX.Element {
  const { action } = props
  return (
    <div class="notice" role="status">
      <p>{props.message}</p>
      {action && <button type="button" onClick={action.run}>{action.label}</button>}
      <button type="button" onClick={props.onDismiss}>Dismiss</button>
    </div>
  )
}
