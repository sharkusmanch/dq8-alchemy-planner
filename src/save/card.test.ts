import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { isCardImage, listCardSaves } from './card'
import { readSaveFile } from './detect'
import { parseRawSave } from './parse'
import { buildSave } from './testing'
import { SaveError, type SaveErrorCode } from './types'

const PAGE = 512
const PAGE_WITH_ECC = 528

function fixture(name: string): Uint8Array {
  const gz = readFileSync(`src/save/__fixtures__/${name}.gz`)
  return new Uint8Array(gunzipSync(gz))
}

function codeOf(fn: () => unknown): SaveErrorCode {
  try {
    fn()
  } catch (e) {
    if (e instanceof SaveError) return e.code
    throw e
  }
  throw new Error('expected a SaveError')
}

/** Deterministic pseudo-random bytes (xorshift32), so the test never depends on Math.random. */
function seededBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length)
  let x = seed >>> 0 || 1
  for (let i = 0; i < length; i++) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    out[i] = x & 0xff
  }
  return out
}

/** Drop the 16-byte spare (ECC) area from every page, giving the other common image layout. */
function stripEcc(card: Uint8Array): Uint8Array {
  const pages = card.length / PAGE_WITH_ECC
  const out = new Uint8Array(pages * PAGE)
  for (let p = 0; p < pages; p++) out.set(card.subarray(p * PAGE_WITH_ECC, p * PAGE_WITH_ECC + PAGE), p * PAGE)
  return out
}

/** The fixture card with its slot 3 save renamed to the European game code (same length, so nothing moves). */
function withEuropeanSave(card: Uint8Array): Uint8Array {
  const from = new TextEncoder().encode('BASLUS-21207dq8_3')
  const to = new TextEncoder().encode('BESLES-53974dq8_3')
  const out = card.slice()
  let renamed = 0
  for (let i = 0; i + from.length <= out.length; i++) {
    if (from.every((byte, k) => out[i + k] === byte)) {
      out.set(to, i)
      renamed++
    }
  }
  if (renamed < 2) throw new Error('expected the directory entry and the file entry')
  return out
}

describe('isCardImage', () => {
  it('recognises the superblock magic of a real card image', () => {
    expect(isCardImage(fixture('dq8-card.ps2'))).toBe(true)
    expect(isCardImage(fixture('empty-card.ps2'))).toBe(true)
  })

  it('rejects raw saves, short input and noise', () => {
    expect(isCardImage(buildSave())).toBe(false)
    expect(isCardImage(new Uint8Array(10))).toBe(false)
    expect(isCardImage(seededBytes(4096, 7))).toBe(false)
  })
})

describe('listCardSaves', () => {
  it('returns exactly the two DQ8 saves, in directory-name order', () => {
    const saves = listCardSaves(fixture('dq8-card.ps2'))
    expect(saves.map((s) => s.dirName)).toEqual(['BASLUS-21207dq8_0', 'BASLUS-21207dq8_3'])
    for (const s of saves) expect(s.bytes.length).toBe(23776)
  })

  it('extracts bytes that parse to the synthetic gold amounts', () => {
    const saves = listCardSaves(fixture('dq8-card.ps2'))
    expect(saves.map((s) => parseRawSave(s.bytes).gold)).toEqual([111, 333])
    expect(saves[0]!.bytes).toEqual(buildSave({ gold: 111 }))
    expect(saves[1]!.bytes).toEqual(buildSave({ gold: 333 }))
  })

  it('reads an image without the per-page ECC spare area the same way', () => {
    const plain = stripEcc(fixture('dq8-card.ps2'))
    expect(isCardImage(plain)).toBe(true)
    const saves = listCardSaves(plain)
    expect(saves.map((s) => s.dirName)).toEqual(['BASLUS-21207dq8_0', 'BASLUS-21207dq8_3'])
    expect(saves[1]!.bytes).toEqual(buildSave({ gold: 333 }))
  })

  it('says which version of the game each save is from', () => {
    expect(listCardSaves(fixture('dq8-card.ps2')).map((s) => s.region)).toEqual(['us', 'us'])
  })

  it('lists a European save too, marked as such', () => {
    const saves = listCardSaves(withEuropeanSave(fixture('dq8-card.ps2')))
    expect(saves.map((s) => [s.dirName, s.region])).toEqual([['BASLUS-21207dq8_0', 'us'], ['BESLES-53974dq8_3', 'eu']])
    expect(saves[1]!.bytes).toEqual(buildSave({ gold: 333 }))
  })

  it('returns no saves for a freshly formatted card', () => {
    expect(listCardSaves(fixture('empty-card.ps2'))).toEqual([])
  })

  it('throws card-format for a truncated image without hanging', () => {
    const cut = fixture('dq8-card.ps2').subarray(0, 100 * 1024)
    expect(codeOf(() => listCardSaves(cut))).toBe('card-format')
  })

  it('throws card-format for an image whose size matches neither page layout', () => {
    const card = fixture('dq8-card.ps2')
    const padded = new Uint8Array(card.length + 1)
    padded.set(card)
    expect(codeOf(() => listCardSaves(padded))).toBe('card-format')
  })

  it('throws card-format for a bad page size or cluster geometry', () => {
    const card = fixture('dq8-card.ps2').slice()
    const view = new DataView(card.buffer)
    view.setUint16(0x28, 1024, true)
    expect(codeOf(() => listCardSaves(card))).toBe('card-format')
    view.setUint16(0x28, 512, true)
    view.setUint16(0x2a, 0, true)
    expect(codeOf(() => listCardSaves(card))).toBe('card-format')
  })

  it('terminates with card-format when the root directory FAT chain loops', () => {
    const card = fixture('dq8-card.ps2').slice()
    const view = new DataView(card.buffer)
    const clusterPages = view.getUint16(0x2a, true)
    const clusterBytes = clusterPages * PAGE_WITH_ECC
    const rootRel = view.getUint32(0x3c, true)
    const fatAbs = view.getUint32(view.getUint32(0x50, true) * clusterBytes, true)
    // point the root directory's FAT entry at itself, so its chain never ends
    view.setUint32(fatAbs * clusterBytes + 4 * rootRel, 0x80000000 | rootRel, true)
    // and claim a root directory far longer than one cluster
    const rootAbs = view.getUint32(0x34, true) + rootRel
    view.setUint32(rootAbs * clusterBytes + 4, 1000, true)
    expect(codeOf(() => listCardSaves(card))).toBe('card-format')
  })

  it('throws card-format when the indirect FAT points outside the card', () => {
    const card = fixture('dq8-card.ps2').slice()
    new DataView(card.buffer).setUint32(0x50, 0x7fffffff, true)
    expect(codeOf(() => listCardSaves(card))).toBe('card-format')
  })
})

describe('readSaveFile', () => {
  it('treats exactly 23,776 bytes as a raw save', () => {
    const bytes = buildSave()
    const result = readSaveFile(bytes)
    expect(result.kind).toBe('raw')
    if (result.kind === 'raw') expect(result.bytes).toBe(bytes)
  })

  it('returns the saves of a memory card', () => {
    const result = readSaveFile(fixture('dq8-card.ps2'))
    expect(result.kind).toBe('card')
    if (result.kind === 'card') expect(result.saves.map((s) => s.dirName)).toEqual(['BASLUS-21207dq8_0', 'BASLUS-21207dq8_3'])
  })

  it('reports no-saves for a card without a Dragon Quest VIII save', () => {
    try {
      readSaveFile(fixture('empty-card.ps2'))
      throw new Error('expected a SaveError')
    } catch (e) {
      expect(e).toBeInstanceOf(SaveError)
      expect((e as SaveError).code).toBe('no-saves')
      expect((e as SaveError).message).toBe('This memory card has no Dragon Quest VIII save')
    }
  })

  it('reports size for 1 MB of noise', () => {
    expect(codeOf(() => readSaveFile(seededBytes(1024 * 1024, 12345)))).toBe('size')
  })

  it('reports size for a 10-byte file', () => {
    expect(codeOf(() => readSaveFile(new Uint8Array(10)))).toBe('size')
  })

  it('reports card-format for the first 100 KB of a card image', () => {
    const cut = fixture('dq8-card.ps2').subarray(0, 100 * 1024)
    expect(codeOf(() => readSaveFile(cut))).toBe('card-format')
  })
})
