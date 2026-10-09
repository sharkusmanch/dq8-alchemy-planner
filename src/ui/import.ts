import type { CardSave, SaveRegion } from '../save/card'
import { parseRawSave } from '../save/parse'
import { SaveError } from '../save/types'
import { snapshotToPatch } from '../state/snapshot'
import type { Store } from './store'

const FRAMES_PER_SECOND = 60

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n

/** 64-bit FNV-1a as 16 hex digits: not cryptographic, but enough to tell whether the bytes changed. */
function fnv1a64(bytes: Uint8Array): string {
  let hash = FNV_OFFSET
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * FNV_PRIME)
  return hash.toString(16).padStart(16, '0')
}

/**
 * SHA-256 of the bytes as lowercase hex. Browsers only offer crypto.subtle on secure origins, so a copy served over
 * plain http falls back to a `fnv1a64:`-prefixed hash (which never equals a SHA-256 hex string).
 */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return `fnv1a64:${fnv1a64(bytes)}`
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const IMPORT_SUMMARY_PREFIX = 'Imported:'

/** True for a notice that reports a finished import, the only kind the shell offers Undo on. */
export const isUndoableNotice = (message: string): boolean => message.startsWith(IMPORT_SUMMARY_PREFIX)

const EUROPEAN_NOTICE = 'European save: the layout matches, but shops and prices in this app are from the US version.'

/** Play time in sixtieths of a second: the US version counts 60 frames a second, the European one 50. */
const sixtieths = (frames: number, region: SaveRegion): number => (region === 'eu' ? Math.round((frames * 60) / 50) : frames)

const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** Save play time as H:MM (frames at 60 per second). */
export function formatPlayTime(frames: number): string {
  const minutes = Math.floor(frames / FRAMES_PER_SECOND / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** A plain-language message for anything thrown while reading or importing a save. */
export function importErrorMessage(error: unknown): string {
  if (error instanceof SaveError) return error.message
  return `Couldn't read that file: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * Parses a raw save and dispatches applySnapshot. Returns the summary line, which also says how many scarce
 * pickups the save shows as collected and how many items it ignored. `region` is known only for a save taken from a memory card; a raw file is read as US.
 * Throws SaveError; dispatches nothing on error.
 */
export async function importRawSave(
  bytes: Uint8Array,
  source: 'upload' | 'url',
  store: Pick<Store, 'index' | 'dispatch'>,
  now: () => string,
  region: SaveRegion = 'us',
): Promise<string> {
  const snapshot = parseRawSave(bytes)
  const patch = snapshotToPatch(snapshot, store.index)
  const hash = await hashBytes(bytes)
  const playTimeFrames = sixtieths(snapshot.playTimeFrames, region)
  const error = store.dispatch({ type: 'applySnapshot', patch, source, hash, playTimeFrames, at: now() })
  if (error !== undefined) throw new Error(error)
  const stacks = Object.keys(patch.inventory).length
  const parts = [
    `${stacks} stacks`, `${patch.gold} gold`, `${patch.completed.length} recipes done`,
    `play time ${formatPlayTime(playTimeFrames)}`,
  ]
  // The stage the save itself has reached; the app keeps a later stage the player had already set.
  const stage = store.index.data.stages.find((s) => s.id === patch.stage)?.label
  if (stage !== undefined) parts.push(`stage: ${stage}`)
  if (patch.collected.length > 0) {
    parts.push(`${counted(patch.collected.length, 'scarce pickup', 'scarce pickups')} already collected`)
  }
  if (patch.unknownItems > 0) parts.push(`${counted(patch.unknownItems, 'unknown item', 'unknown items')} ignored`)
  const summary = `${IMPORT_SUMMARY_PREFIX} ${parts.join(', ')}`
  return region === 'eu' ? `${summary}. ${EUROPEAN_NOTICE}` : summary
}

export type SaveDescription =
  | { dirName: string; region: SaveRegion; ok: true; playTimeFrames: number; gold: number }
  | { dirName: string; region: SaveRegion; ok: false; error: string }

/** What the card picker shows for one save, play time in sixtieths of a second; an unreadable slot is described, never thrown. */
export function describeSave(save: CardSave): SaveDescription {
  const { dirName, region } = save
  try {
    const snapshot = parseRawSave(save.bytes)
    return { dirName, region, ok: true, playTimeFrames: sixtieths(snapshot.playTimeFrames, region), gold: snapshot.gold }
  } catch (error) {
    return { dirName, region, ok: false, error: importErrorMessage(error) }
  }
}
