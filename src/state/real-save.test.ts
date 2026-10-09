import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { index } from '../data'
import { scarcity } from '../planner/need'
import { parseRawSave } from '../save/parse'
import { initialState, reduce } from './reducer'
import { snapshotToPatch } from './snapshot'

const PATH = 'sources/real_save_slot6.bin'

// An early save: Peregrin Quay, Maella Abbey and Simpleton reached, the thief's key made, nothing beyond.
describe.skipIf(!existsSync(PATH))('real save (slot 6) on the real data', () => {
  const patch = () => snapshotToPatch(parseRawSave(new Uint8Array(readFileSync(PATH))), index)

  it('ticks only scarce sources at places the save has already passed', () => {
    // The save's flags show these eight as taken: the chests north of Farebury and east of Port Prospect, the
    // ferry barrel, the pot outside Port Prospect's inn, Geyzer, the Tower of Alexandra pot, the beach chest
    // south of Alexandria and the thief's-key chest south-east of the Maella Abbey barn.
    expect(patch().collected).toEqual([
      'seed-of-life-1', 'seed-of-life-2', 'seed-of-life-3',
      'seed-of-wisdom-1',
      'seed-of-strength-1', 'seed-of-strength-2', 'seed-of-strength-3', 'seed-of-strength-4',
    ])
    const reached = index.stageRank('maella-abbey')
    for (const entry of index.data.goals.scarce) {
      for (const source of entry.sources) {
        if (!patch().collected.includes(source.id)) continue
        expect(index.stageRank(index.location(source.location).stage), source.id).toBeLessThanOrEqual(reached)
      }
    }
  })

  it('stays at Maella Abbey: its story chapter is 3, short of every stage the story can prove', () => {
    expect(patch().stage).toBe('maella-abbey')
  })

  it('has Dodgy Dave untouched and no unknown item', () => {
    expect(patch().dave).toEqual({ done: [false, false, false, false, false, false], next: 0 })
    expect(patch().unknownItems).toBe(0)
  })

  it('still counts on every scarce source that is not a seed', () => {
    const { state } = reduce(initialState(index), {
      type: 'applySnapshot', patch: patch(), source: 'upload', hash: 'h', playTimeFrames: 1, at: 't',
    }, index)
    const report = (item: string) => scarcity(index, state).find((r) => r.item === item)
    expect(report('orichalcum')?.uncollected).toBe(6)
    expect(report('icicle-dirk')?.uncollected).toBe(2)
    expect(report('seed-of-strength')?.uncollected).toBe(8)
  })
})
