import type { DataIndex, Item, ItemId, ScarceSource, StageId } from '../data/types'
import type { SaveSnapshot } from '../save/types'
import type { AppState, SnapshotPatch } from './types'

function add(stock: Record<ItemId, number>, item: ItemId, qty: number): void {
  if (qty > 0) stock[item] = (stock[item] ?? 0) + qty
}

/** True when the data names a way for a save to show the source as taken. One without is ticked by hand only. */
export function hasSaveSign(source: ScarceSource): boolean {
  return source.flag !== undefined || source.medalPrize !== undefined || source.killCount !== undefined
}

function sameMultiset(a: readonly ItemId[], b: readonly ItemId[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort()
  const y = [...b].sort()
  return x.every((item, i) => item === y[i])
}

/**
 * Maps a parsed save to what it says about the state. An item id the data has no item for is skipped and counted,
 * wherever it is held.
 */
export function snapshotToPatch(snap: SaveSnapshot, index: DataIndex): SnapshotPatch {
  const inventory: Record<ItemId, number> = {}
  const equipped: Record<ItemId, number> = {}
  let unknownItems = 0
  const itemOf = (gameId: number): Item | undefined => {
    const item = index.itemByGameId(gameId)
    if (!item) unknownItems++
    return item
  }

  for (const stack of snap.bag) {
    const item = itemOf(stack.gameId)
    if (item) add(inventory, item.id, stack.qty)
  }
  for (const character of snap.characters) {
    for (const held of character.items) {
      const item = itemOf(held.gameId)
      if (item) add(held.equipped ? equipped : inventory, item.id, 1)
    }
  }

  const completed: number[] = []
  snap.recipeStatus.forEach((status, n) => {
    if (status & 1) completed.push(n)
  })

  let pot: AppState['pot'] = null
  if (snap.pot) {
    const result = itemOf(snap.pot.result)
    if (result) {
      const ingredients: ItemId[] = []
      for (const gameId of snap.pot.ingredients) {
        const ingredient = itemOf(gameId)
        if (ingredient) ingredients.push(ingredient.id)
      }
      const match = index.recipesFor(result.id).find((r) => sameMultiset(r.ingredients, ingredients))
      pot = { recipe: match ? match.recipeIndex : null, result: result.id, ingredients }
    }
  }

  // The latest stage the save proves: among the Zoom destinations it has unlocked, the stage at which its pot
  // arrives, and the stages its story chapter or its beaten trials have reached. Several stages have no Zoom
  // destination, so the pot or the story can prove a later one than Zoom does.
  const stages = index.data.stages
  let stage = stages[0]?.id ?? ''
  let bestRank = 0
  const reached = (candidate: StageId): void => {
    const rank = index.stageRank(candidate)
    if (rank > bestRank) {
      bestRank = rank
      stage = candidate
    }
  }
  const unlocked = new Set(snap.zoomBits)
  for (const location of index.data.locations) {
    if (location.zoomBit !== undefined && unlocked.has(location.zoomBit)) reached(location.stage)
  }
  const { potStages } = index.data.goals
  const potStage = [undefined, potStages.basic, potStages.improved, potStages.instant][snap.potLevel]
  if (potStage) reached(potStage) // an empty id means the data does not say
  for (const candidate of stages) {
    const byStory = candidate.storyMin !== undefined && snap.storyProgress >= candidate.storyMin
    const byTrials = candidate.trialMin !== undefined && snap.trialProgress >= candidate.trialMin
    if (byStory || byTrials) reached(candidate.id)
  }

  // Scarce sources the save shows as taken. One without a sign in the data can only be ticked by hand.
  const byteAt = (offset: number): number => snap.progress[offset] ?? 0
  const taken = (source: ScarceSource): boolean => {
    if (source.flag) return ((byteAt(source.flag.offset) >> source.flag.bit) & 1) === 1
    if (source.medalPrize !== undefined) return snap.medalPrizes >= source.medalPrize
    if (source.killCount) return (byteAt(source.killCount.offset) | (byteAt(source.killCount.offset + 1) << 8)) >= 1
    return false
  }
  const collected = index.data.goals.scarce.flatMap((entry) => entry.sources.filter(taken).map((source) => source.id))

  // Dave can move on without a hand-in, so each request has its own flag; the sequence says which one he wants now.
  const requests = index.data.goals.dave
  const dave = {
    done: requests.map((_, k) => (snap.daveTrades[k] ?? 0) >= 1),
    next: snap.daveSequence < requests.length ? snap.daveSequence : 0,
  }

  return {
    inventory,
    equipped,
    gold: snap.gold,
    potLevel: snap.potLevel,
    pot,
    completed,
    brews: { basic: snap.brews.basic, improved: snap.brews.improved },
    dave,
    collected,
    stage,
    unknownItems,
  }
}
