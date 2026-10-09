import { createIndex } from './create-index'
import goals from './goals.json'
import items from './items.json'
import locations from './locations.json'
import recipes from './recipes.json'
import shops from './shops.json'
import sources from './sources.json'
import stages from './stages.json'
import type { DataIndex, GameData } from './types'

// The JSON files are typed by their content (empty arrays infer as never[]), so cast
// through unknown to the shared interfaces.
export const data = {
  items, recipes, stages, locations, shops, sources, goals,
} as unknown as GameData

export const index: DataIndex = createIndex(data)
