export type ItemId = string
export type StageId = string
export type LocationId = string
export type Category =
  | 'weapon' | 'armour' | 'shield' | 'helmet' | 'accessory' | 'item' | 'cheese' | 'other'
export interface Item { id: ItemId; gameId: number; name: string; category: Category; buy?: number; sell?: number }
/** `recipeIndexUnconfirmed`: which status byte of the save belongs to this recipe is not settled (see DATA_NOTES). */
export interface Recipe { recipeIndex: number; result: ItemId; ingredients: ItemId[]; recipeIndexUnconfirmed?: boolean }
/**
 * `storyMin` and `trialMin` let a save prove the stage: it has been reached once the save's story chapter, or
 * its count of Dragovian trials beaten, is at least that value.
 */
export interface Stage { id: StageId; label: string; storyMin?: number; trialMin?: number }
export interface Location { id: LocationId; name: string; stage: StageId; zoomBit?: number }
export interface Shop {
  id: string; location: LocationId; name: string; stock: ItemId[]
  availableFrom?: StageId; availableUntil?: StageId; timeOfDay?: 'day' | 'night'
}
export type SourceKind = 'found' | 'drop' | 'rare-drop' | 'casino' | 'medal' | 'gift' | 'other'
export interface Source { item: ItemId; kind: SourceKind; where: string; location?: LocationId; tokens?: number }
/**
 * A one-time source. At most one of `flag`, `medalPrize` and `killCount` says how a save shows it as taken:
 * a set bit at a file offset, the place of a prize in the order Mini Medal prizes are given (from 1), or a
 * monster's 16-bit kill count at a file offset being at least 1. A source with none is ticked by hand.
 */
export interface ScarceSource {
  id: string; label: string; location: LocationId
  flag?: { offset: number; bit: number }
  medalPrize?: number
  killCount?: { offset: number }
}
export interface Goals {
  brewThresholds: { basic: number; improved: number }
  /** Stage at which each pot arrives. The stage before `improved` is the last chance for the basic counter. */
  potStages: { basic: StageId; improved: StageId; instant: StageId }
  milestones: number[]
  dave: { item: ItemId; reward: string }[]
  scarce: { item: ItemId; sources: ScarceSource[] }[]
}
export interface GameData {
  items: Item[]; recipes: Recipe[]; stages: Stage[]; locations: Location[]
  shops: Shop[]; sources: Source[]; goals: Goals
}
export interface DataIndex {
  data: GameData
  item(id: ItemId): Item                       // throws on unknown id
  hasItem(id: ItemId): boolean
  itemByGameId(gameId: number): Item | undefined
  maxGameId: number
  recipe(recipeIndex: number): Recipe          // throws on unknown
  recipesFor(result: ItemId): Recipe[]         // recipes producing the item, ascending recipeIndex
  recipesUsing(item: ItemId): Recipe[]         // ascending recipeIndex, each recipe once
  stageRank(id: StageId): number               // position in data.stages; throws on unknown
  shopsSelling(item: ItemId): Shop[]           // ascending shop id
  sourcesOf(item: ItemId): Source[]
  location(id: LocationId): Location           // throws on unknown
  isScarce(item: ItemId): boolean
}
