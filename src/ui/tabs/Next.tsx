import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { DataIndex, ItemId, Source } from '../../data/types'
import { buildQueue, filler, makeContext, scarcity, stockOf } from '../../planner'
import type { FillerSuggestion, Queue, QueueReason, RecipePlan, ScarceReport } from '../../planner'
import type { AppState } from '../../state/types'
import { Counters } from '../components/Counters'
import { PotCard } from '../components/PotCard'
import { QueueEntry } from '../components/QueueEntry'
import { EQUIPPED_NOTE, equippedCount } from '../equipped'
import { useStore } from '../store'

/** Entries shown before "Show all"; the page stays short enough to reach the filler and the counters. */
const QUEUE_PREVIEW = 5
/** Gather rows shown before "Show all": a mid-game save has dozens, and they are the least urgent part. */
const GATHER_PREVIEW = 5
const MAX_SOURCES_SHOWN = 3

const EMPTY_QUEUE: Record<QueueReason, string> = {
  'no-pot': "You don't have the alchemy pot yet. King Trode gives it to you on the ferry to Peregrin Quay.",
  'all-done': 'Every recipe is done.',
  'nothing-reachable': 'Nothing new is brewable right now. See what to gather below, or advance the story.',
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

/** Runs one planner call on its own, so a failure costs only the section that needs it. */
function attempt<T>(run: () => T): Attempt<T> {
  try {
    return { ok: true, value: run() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const nameOf = (index: DataIndex, id: ItemId) => (index.hasItem(id) ? index.item(id).name : id)

const isDrop = (source: Source) => source.kind === 'drop' || source.kind === 'rare-drop'

/** The first few of `labels`, then how many were left out. */
function listed(labels: string[], separator: string): string {
  const shown = labels.slice(0, MAX_SOURCES_SHOWN).join(separator)
  const more = labels.length - MAX_SOURCES_SHOWN
  return more > 0 ? `${shown}${separator}and ${more} more` : shown
}

/** A source's label already says what kind it is ("Rare drop: Treevil"), so it is printed as it is. */
function sourcesText(sources: Source[]): string {
  return listed(sources.map((source) => source.where), '; ')
}

/** The monster of a drop source, without the "Drop:" or "Rare drop:" that its label starts with. */
const monsterOf = (source: Source) => source.where.replace(/^(?:rare )?drop:\s*/i, '')

/** True when everything the recipe is missing comes only from monster drops (at the player's stage). */
function needsOnlyDrops(plan: RecipePlan): boolean {
  return plan.gather.length > 0 && plan.gather.every((g) => g.sources.length > 0 && g.sources.every(isDrop))
}

/** A scarce shortfall that monsters can fill: information, not an alarm. Monsters are named only with spoilers on. */
function farmText(index: DataIndex, report: ScarceReport, equipped: number, showSpoilers: boolean): string {
  const worn = equipped > 0 ? `, ${equipped} equipped` : ''
  const line = `${nameOf(index, report.item)}: ${report.gap} more to farm from monster drops${worn}`
  if (!showSpoilers) return line
  return `${line} (${listed([...new Set(report.farmable.map(monsterOf))], ', ')})`
}

/** The filler as a one-step plan, buying only what the bag does not already cover. */
function fillerPlan(f: FillerSuggestion, state: AppState): RecipePlan {
  const stock = stockOf(state) // includes the pot's pending result, as the reducer does
  const purchases = f.purchases
    .map((p) => ({ ...p, qty: p.qty - (stock[p.item] ?? 0) }))
    .filter((p) => p.qty > 0)
  return {
    recipe: f.recipe,
    status: purchases.length > 0 ? 'buy' : 'ready',
    cost: purchases.reduce((sum, p) => sum + p.qty * p.unitPrice, 0),
    steps: [{ recipe: f.recipe, mandatory: false }],
    purchases,
    gather: [],
    blockedBy: [],
  }
}

export function Next(): JSX.Element {
  const { state, index, dispatch, setTab } = useStore()
  const [showAll, setShowAll] = useState(false)
  const [showAllGather, setShowAllGather] = useState(false)

  const ctx = useMemo(() => makeContext(index, state), [index, state])
  const queue = useMemo(() => attempt(() => buildQueue(ctx)), [ctx])
  const scarce = useMemo(() => attempt(() => scarcity(index, state)), [index, state])
  const fill = useMemo(() => attempt(() => filler(ctx)), [ctx])

  const { goals } = index.data
  const showPot = state.pot !== null || state.potLevel === 1 || state.potLevel === 2
  // A shortfall is an alarm only when nothing can make it up; one that monsters drop is a chore to list quietly.
  const short = scarce.ok ? scarce.value.filter((s) => s.atRisk) : []
  const lost = short.filter((s) => s.farmable.length === 0)
  const toFarm = short.filter((s) => s.farmable.length > 0)

  // With spoilers off, recipes that only need monster drops are counted, not listed; one whose missing item a
  // character is wearing is listed all the same, because it needs no monster.
  const gather = queue.ok ? queue.value.gather : []
  const worn = (item: ItemId) => equippedCount(state, item) > 0
  const gatherListed = state.settings.showSpoilers
    ? gather
    : gather.filter((plan) => !needsOnlyDrops(plan) || plan.gather.some((g) => worn(g.item)))
  const gatherShown = showAllGather ? gatherListed : gatherListed.slice(0, GATHER_PREVIEW)
  const dropsOnly = gather.length - gatherListed.length

  return (
    <div class="tab">
      <h1>Next</h1>

      {showPot && <PotCard pot={state.pot} index={index} onCollect={() => dispatch({ type: 'collectPot' })} />}

      {!scarce.ok && <p class="error" role="alert">Couldn't check the scarce items: {scarce.error}</p>}
      {lost.map((s) => (
        <p class="warn" key={s.item}>
          {`Short of ${nameOf(index, s.item)} by ${s.gap}: ${s.needed} needed, ${s.inStock} in stock${
            worn(s.item) ? ` (${equippedCount(state, s.item)} equipped)` : ''
          }, ${s.uncollected} left to pick up. Don't spend it on anything else.`}
        </p>
      ))}

      {queue.ok
        ? <QueueSection queue={queue.value} showAll={showAll} onShowAll={() => setShowAll(true)} />
        : (
          <section aria-labelledby="next-queue">
            <h2 id="next-queue">Brewing queue</h2>
            <p class="error" role="alert">Couldn't work out the queue: {queue.error}</p>
          </section>
        )}

      {(!fill.ok || fill.value) && (
        <section aria-label="Filler brew" class="filler">
          <h2>Filler brew</h2>
          {!fill.ok && <p class="error" role="alert">Couldn't work out a filler brew: {fill.error}</p>}
          {fill.ok && fill.value && (
            <ul class="entries">
              <QueueEntry
                plan={fillerPlan(fill.value, state)}
                badge={fill.value.urgent
                  ? 'Urgent: this pot is replaced soon, and brews after that will not count toward it.'
                  : undefined}
                note={`Repeat it ${fill.value.remaining} more times for the ${fill.value.counter} pot counter (${fill.value.unitCost} g each).`}
              />
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="next-progress">
        <h2 id="next-progress">Progress</h2>
        <Counters
          completed={state.completed.length}
          total={index.data.recipes.length}
          milestones={goals.milestones}
          potLevel={state.potLevel}
          brews={state.brews}
          thresholds={goals.brewThresholds}
        />
      </section>

      {gather.length > 0 && (
        <section aria-labelledby="next-gather">
          <h2 id="next-gather">To gather</h2>
          {gatherShown.length > 0 && (
            <ul class="rows" aria-label="Gather">
              {gatherShown.map((plan) => (
                <li class="row gather" key={plan.recipe}>
                  <span class="row-main">
                    <span class="name">{nameOf(index, index.recipe(plan.recipe).result)}</span>
                    {plan.gather.map((g) => (
                      <span class="meta" key={g.item}>
                        {`${nameOf(index, g.item)}: ${worn(g.item) ? `${EQUIPPED_NOTE}. Also: ` : ''}${sourcesText(g.sources)}`}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {gatherShown.length < gatherListed.length && (
            <button type="button" onClick={() => setShowAllGather(true)}>Show all {gatherListed.length} to gather</button>
          )}
          {dropsOnly > 0 && <p class="meta">{`${dropsOnly} more need monster drops`}</p>}
        </section>
      )}

      {toFarm.length > 0 && (
        <ul class="rows farm" aria-label="To farm">
          {toFarm.map((s) => (
            <li class="meta" key={s.item}>
              {farmText(index, s, equippedCount(state, s.item), state.settings.showSpoilers)}
            </li>
          ))}
        </ul>
      )}

      {queue.ok && (queue.value.blocked > 0 || queue.value.later > 0) && (
        <p class="more-links">
          {queue.value.blocked > 0 && (
            <button type="button" onClick={() => setTab('recipes', 'blocked')}>{queue.value.blocked} blocked</button>
          )}
          {queue.value.blocked > 0 && queue.value.later > 0 && ' · '}
          {queue.value.later > 0 && (
            <button type="button" onClick={() => setTab('recipes', 'later')}>{queue.value.later} need a better pot</button>
          )}
        </p>
      )}
    </div>
  )
}

function QueueSection(props: { queue: Queue; showAll: boolean; onShowAll(): void }): JSX.Element {
  const { queue } = props
  const shown = props.showAll ? queue.entries : queue.entries.slice(0, QUEUE_PREVIEW)
  return (
    <section aria-labelledby="next-queue">
      <h2 id="next-queue">Brewing queue</h2>
      {queue.entries.length === 0 && queue.reason !== undefined && <p class="empty">{EMPTY_QUEUE[queue.reason]}</p>}
      {queue.entries.length > 0 && (
        <ul class="entries" aria-label="Brewing queue">
          {shown.map((plan) => <QueueEntry key={plan.recipe} plan={plan} />)}
        </ul>
      )}
      {shown.length < queue.entries.length && (
        <button type="button" onClick={props.onShowAll}>Show all {queue.entries.length} brews</button>
      )}
    </section>
  )
}
