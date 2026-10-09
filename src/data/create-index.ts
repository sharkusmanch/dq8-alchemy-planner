import type {
  DataIndex, GameData, Item, ItemId, Location, LocationId, Recipe, Shop, Source, StageId,
} from './types'

function lookup<K, V>(map: Map<K, V>, key: K, what: string): V {
  const found = map.get(key)
  if (found === undefined) throw new Error(`Unknown ${what}: ${String(key)}`)
  return found
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

export function createIndex(data: GameData): DataIndex {
  const itemsById = new Map<ItemId, Item>()
  const itemsByGameId = new Map<number, Item>()
  let maxGameId = 0
  for (const item of data.items) {
    itemsById.set(item.id, item)
    itemsByGameId.set(item.gameId, item)
    if (item.gameId > maxGameId) maxGameId = item.gameId
  }

  const recipesByIndex = new Map<number, Recipe>()
  const recipesByResult = new Map<ItemId, Recipe[]>()
  const recipesByIngredient = new Map<ItemId, Recipe[]>()
  const byRecipeIndex = [...data.recipes].sort((a, b) => a.recipeIndex - b.recipeIndex)
  for (const recipe of byRecipeIndex) {
    recipesByIndex.set(recipe.recipeIndex, recipe)
    push(recipesByResult, recipe.result, recipe)
    for (const ingredient of new Set(recipe.ingredients)) push(recipesByIngredient, ingredient, recipe)
  }

  const stageRanks = new Map<StageId, number>(data.stages.map((stage, rank) => [stage.id, rank]))
  const locationsById = new Map<LocationId, Location>(data.locations.map((l) => [l.id, l]))

  const shopsByItem = new Map<ItemId, Shop[]>()
  const byShopId = [...data.shops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const shop of byShopId) for (const item of new Set(shop.stock)) push(shopsByItem, item, shop)

  const sourcesByItem = new Map<ItemId, Source[]>()
  for (const source of data.sources) push(sourcesByItem, source.item, source)

  const scarce = new Set<ItemId>(data.goals.scarce.map((entry) => entry.item))

  return {
    data,
    item: (id) => lookup(itemsById, id, 'item'),
    hasItem: (id) => itemsById.has(id),
    itemByGameId: (gameId) => itemsByGameId.get(gameId),
    maxGameId,
    recipe: (recipeIndex) => lookup(recipesByIndex, recipeIndex, 'recipe'),
    recipesFor: (result) => recipesByResult.get(result) ?? [],
    recipesUsing: (item) => recipesByIngredient.get(item) ?? [],
    stageRank: (id) => lookup(stageRanks, id, 'stage'),
    shopsSelling: (item) => shopsByItem.get(item) ?? [],
    sourcesOf: (item) => sourcesByItem.get(item) ?? [],
    location: (id) => lookup(locationsById, id, 'location'),
    isScarce: (item) => scarce.has(item),
  }
}
