import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIndex } from '../data/create-index'
import { SaveError } from '../save/types'
import { buildSave } from '../save/testing'
import type { Action } from '../state/types'
import { miniData } from '../testing/mini'
import { describeSave, formatPlayTime, hashBytes, importRawSave, isUndoableNotice } from './import'

const index = createIndex(miniData)
const NOW = '2026-10-09T12:00:00.000Z'

function stubStore() {
  const dispatch = vi.fn((_action: Action): string | undefined => undefined)
  return { store: { index, dispatch }, dispatch }
}

describe('hashBytes', () => {
  it('is the lowercase hex SHA-256', async () => {
    expect(await hashBytes(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await hashBytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('hashBytes without crypto.subtle (plain-http origins)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('falls back to a deterministic hash that tells different bytes apart', async () => {
    vi.stubGlobal('crypto', {})
    const a = new Uint8Array([1, 2, 3])
    const hashA = await hashBytes(a)
    expect(await hashBytes(new Uint8Array([1, 2, 3]))).toBe(hashA)
    expect(await hashBytes(new Uint8Array([1, 2, 4]))).not.toBe(hashA)
    expect(await hashBytes(new Uint8Array([1, 2, 3, 0]))).not.toBe(hashA)
    expect(await hashBytes(new Uint8Array(23776).fill(5))).not.toBe(await hashBytes(new Uint8Array(23776).fill(6)))
    expect(hashA).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    expect(await hashBytes(new Uint8Array())).toBe('fnv1a64:cbf29ce484222325') // FNV-1a offset basis
  })

  it('imports a save with the fallback hash', async () => {
    vi.stubGlobal('crypto', {})
    const { store, dispatch } = stubStore()
    await importRawSave(buildSave(), 'upload', store, () => NOW)
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ hash: expect.stringMatching(/^fnv1a64:/) })
  })
})

describe('formatPlayTime', () => {
  it('shows hours and zero-padded minutes from 60 frames per second', () => {
    expect(formatPlayTime(0)).toBe('0:00')
    expect(formatPlayTime(3600)).toBe('0:01')
    expect(formatPlayTime((3600 + 300) * 60)).toBe('1:05')
    expect(formatPlayTime((100 * 3600 + 59 * 60 + 59) * 60)).toBe('100:59')
  })
})

describe('importRawSave', () => {
  it('dispatches one applySnapshot and returns the summary line', async () => {
    const { store, dispatch } = stubStore()
    const bytes = buildSave({
      gold: 5,
      playTimeFrames: (3600 + 300) * 60,
      bag: [{ gameId: 1, qty: 3 }, { gameId: 2, qty: 1 }],
      recipeStatus: Object.assign(new Array<number>(184).fill(0), { 0: 3, 7: 1 }),
    })
    const summary = await importRawSave(bytes, 'upload', store, () => NOW)

    expect(summary).toBe('Imported: 2 stacks, 5 gold, 2 recipes done, play time 1:05, stage: Stage one')
    expect(dispatch).toHaveBeenCalledTimes(1)
    const action = dispatch.mock.calls[0]![0]
    expect(action).toMatchObject({
      type: 'applySnapshot', source: 'upload', at: NOW, playTimeFrames: (3600 + 300) * 60, hash: await hashBytes(bytes),
    })
    if (action.type !== 'applySnapshot') throw new Error('unreachable')
    expect(action.patch.inventory).toEqual({ a: 3, b: 1 })
    expect(action.patch.gold).toBe(5)
  })

  it('names the stage the save has reached, by its label', async () => {
    const { store } = stubStore()
    const summary = await importRawSave(buildSave({ zoomBits: [0], potLevel: 2 }), 'upload', store, () => NOW)
    expect(summary).toMatch(/, stage: Stage two$/)
  })

  it('passes the url source through', async () => {
    const { store, dispatch } = stubStore()
    await importRawSave(buildSave(), 'url', store, () => NOW)
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ source: 'url' })
  })

  it('throws a SaveError and dispatches nothing for a 10-byte buffer', async () => {
    const { store, dispatch } = stubStore()
    await expect(importRawSave(new Uint8Array(10), 'upload', store, () => NOW)).rejects.toBeInstanceOf(SaveError)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('treats a save of zeros as an empty slot and dispatches nothing', async () => {
    const { store, dispatch } = stubStore()
    await expect(importRawSave(new Uint8Array(23776), 'upload', store, () => NOW)).rejects.toMatchObject({ code: 'empty' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('rejects a file of the right size that does not start like a save', async () => {
    const { store, dispatch } = stubStore()
    const bytes = new Uint8Array(23776).fill(0xff)
    await expect(importRawSave(bytes, 'upload', store, () => NOW)).rejects.toMatchObject({
      code: 'format', message: 'This is not a Dragon Quest VIII PS2 save',
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('imports a save that holds an item id outside the table, skipping that item', async () => {
    const { store, dispatch } = stubStore()
    const bytes = buildSave({ bag: [{ gameId: 1, qty: 2 }, { gameId: index.maxGameId + 1, qty: 1 }] })
    const summary = await importRawSave(bytes, 'upload', store, () => NOW)
    const action = dispatch.mock.calls[0]![0]
    if (action.type !== 'applySnapshot') throw new Error('unreachable')
    expect(action.patch.inventory).toEqual({ a: 2 })
    expect(summary).toBe('Imported: 1 stacks, 0 gold, 0 recipes done, play time 0:01, stage: Stage one, 1 unknown item ignored')
  })

  it('counts the unknown items it ignored', async () => {
    const { store } = stubStore()
    const bytes = buildSave({ bag: [{ gameId: 387, qty: 1 }, { gameId: 388, qty: 4 }] })
    expect(await importRawSave(bytes, 'upload', store, () => NOW)).toMatch(/, 2 unknown items ignored$/)
  })

  it('says how many scarce pickups the save shows as already collected, and nothing when there are none', async () => {
    const flagged = createIndex({
      ...miniData,
      goals: { ...miniData.goals, scarce: [{ item: 's', sources: [
        { id: 's-1', label: 'Chest', location: 'town', flag: { offset: 0x99e, bit: 7 } },
        { id: 's-2', label: 'Prize', location: 'town', medalPrize: 4 },
        { id: 's-3', label: 'By hand', location: 'town' },
      ] }] },
    })
    const dispatch = vi.fn((_action: Action): string | undefined => undefined)
    const run = (fields: Parameters<typeof buildSave>[0]) => importRawSave(buildSave(fields), 'upload', { index: flagged, dispatch }, () => NOW)
    expect(await run({ progress: { 0x99e: 0x80 }, medalPrizes: 5 })).toBe(
      'Imported: 0 stacks, 0 gold, 0 recipes done, play time 0:01, stage: Stage one, 2 scarce pickups already collected',
    )
    expect(await run({ medalPrizes: 4 })).toMatch(/, stage: Stage one, 1 scarce pickup already collected$/)
    expect(await run({})).toMatch(/, stage: Stage one$/)
    const action = dispatch.mock.calls[0]![0]
    if (action.type !== 'applySnapshot') throw new Error('unreachable')
    expect(action.patch.collected).toEqual(['s-1', 's-2'])
  })

  it('reads a European save at 50 frames a second and says the data is from the US version', async () => {
    const { store, dispatch } = stubStore()
    const bytes = buildSave({ gold: 7, playTimeFrames: (3600 + 300) * 50 })
    const summary = await importRawSave(bytes, 'upload', store, () => NOW, 'eu')
    expect(summary).toBe(
      'Imported: 0 stacks, 7 gold, 0 recipes done, play time 1:05, stage: Stage one. '
      + 'European save: the layout matches, but shops and prices in this app are from the US version.',
    )
    // Stored in sixtieths of a second, so the last-import line reads the same for both versions.
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ playTimeFrames: (3600 + 300) * 60 })
    expect(isUndoableNotice(summary)).toBe(true)
  })
})

describe('describeSave', () => {
  it('reads play time and gold, and reports an unreadable slot instead of throwing', () => {
    const good = describeSave({ dirName: 'BASLUS-21207dq8_0', region: 'us', bytes: buildSave({ gold: 42, playTimeFrames: 7200 }) })
    expect(good).toEqual({ dirName: 'BASLUS-21207dq8_0', region: 'us', ok: true, playTimeFrames: 7200, gold: 42 })
    const bad = describeSave({ dirName: 'BASLUS-21207dq8_1', region: 'us', bytes: new Uint8Array(23776) })
    expect(bad).toMatchObject({ dirName: 'BASLUS-21207dq8_1', ok: false })
    expect((bad as { error: string }).error).toMatch(/empty/i)
  })

  it('gives the play time of a European save in sixtieths of a second, from its 50 frames a second', () => {
    const save = { dirName: 'BESLES-53974dq8_0', region: 'eu' as const, bytes: buildSave({ playTimeFrames: 3600 * 50 }) }
    const described = describeSave(save)
    expect(described).toMatchObject({ ok: true, region: 'eu', playTimeFrames: 3600 * 60 })
    expect(formatPlayTime((described as { playTimeFrames: number }).playTimeFrames)).toBe('1:00')
  })
})
