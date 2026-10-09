import { SaveError } from './types'

/**
 * Read-only reader for PS2 memory card images (the .ps2 files PCSX2 uses), written from the
 * public format description. A card is an array of pages; pages are grouped into clusters;
 * a FAT (reached through an indirect FAT cluster list in the superblock) chains clusters into
 * directories and files. Images either carry a 16-byte ECC spare area after every 512-byte
 * page or do not; the file size against the superblock geometry tells which.
 */

/** The version of the game a save is from, by its directory on the card. */
export type SaveRegion = 'us' | 'eu'

export interface CardSave {
  dirName: string
  bytes: Uint8Array
  region: SaveRegion
}

const MAGIC = 'Sony PS2 Memory Card Format '
/** Save directory prefixes. The European version uses the same save layout. */
const GAME_PREFIXES: [prefix: string, region: SaveRegion][] = [['BASLUS-21207', 'us'], ['BESLES-53974', 'eu']]

const PAGE_SIZE = 512
const ECC_SIZE = 16
const ENTRY_SIZE = 512
const MAX_CLUSTERS = 1 << 22

// superblock field offsets
const SB_PAGE_SIZE = 0x28
const SB_PAGES_PER_CLUSTER = 0x2a
const SB_CLUSTERS_PER_CARD = 0x30
const SB_ALLOC_OFFSET = 0x34
const SB_ROOT_CLUSTER = 0x3c
const SB_IFC_LIST = 0x50
const SB_IFC_COUNT = 32

// directory entry field offsets
const DE_MODE = 0x00
const DE_LENGTH = 0x04
const DE_CLUSTER = 0x10
const DE_NAME = 0x40
const DE_NAME_LENGTH = 32

const MODE_FILE = 0x0010
const MODE_DIRECTORY = 0x0020
const MODE_EXISTS = 0x8000

const FAT_ALLOCATED = 0x80000000
const FAT_NO_NEXT = 0x7fffffff

const bad = (why: string): SaveError =>
  new SaveError('card-format', `This is not a readable PS2 memory card image: ${why}`)

/** True when the bytes start with the PS2 memory card superblock magic. */
export function isCardImage(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false
  return true
}

interface Card {
  bytes: Uint8Array
  view: DataView
  pagesPerCluster: number
  clusterSize: number
  clusterCount: number
  allocOffset: number
  rootCluster: number
  pageStride: number
  ifcList: number[]
}

function openCard(bytes: Uint8Array): Card {
  if (!isCardImage(bytes) || bytes.length < 0x150) throw bad('missing superblock')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pageSize = view.getUint16(SB_PAGE_SIZE, true)
  const pagesPerCluster = view.getUint16(SB_PAGES_PER_CLUSTER, true)
  const clusterCount = view.getUint32(SB_CLUSTERS_PER_CARD, true)
  const allocOffset = view.getUint32(SB_ALLOC_OFFSET, true)
  const rootCluster = view.getUint32(SB_ROOT_CLUSTER, true)

  if (pageSize !== PAGE_SIZE) throw bad(`unsupported page size ${pageSize}`)
  if (pagesPerCluster < 1 || pagesPerCluster > 32) throw bad(`unsupported cluster size ${pagesPerCluster}`)
  if (clusterCount < 1 || clusterCount > MAX_CLUSTERS) throw bad(`unsupported cluster count ${clusterCount}`)
  if (allocOffset >= clusterCount || rootCluster >= clusterCount - allocOffset) throw bad('bad directory layout')

  const pageCount = clusterCount * pagesPerCluster
  let pageStride: number
  if (bytes.length === pageCount * (PAGE_SIZE + ECC_SIZE)) pageStride = PAGE_SIZE + ECC_SIZE
  else if (bytes.length === pageCount * PAGE_SIZE) pageStride = PAGE_SIZE
  else throw bad('file size does not match the card geometry (truncated or damaged image)')

  const ifcList: number[] = []
  for (let i = 0; i < SB_IFC_COUNT; i++) ifcList.push(view.getUint32(SB_IFC_LIST + 4 * i, true))
  return {
    bytes,
    view,
    pagesPerCluster,
    clusterSize: pagesPerCluster * PAGE_SIZE,
    clusterCount,
    allocOffset,
    rootCluster,
    pageStride,
    ifcList,
  }
}

/** Copy one absolute cluster's data (spare areas removed) into `out` at `at`. */
function copyCluster(card: Card, absolute: number, out: Uint8Array, at: number): void {
  if (absolute >= card.clusterCount) throw bad('cluster outside the card')
  for (let p = 0; p < card.pagesPerCluster; p++) {
    const start = (absolute * card.pagesPerCluster + p) * card.pageStride
    out.set(card.bytes.subarray(start, start + PAGE_SIZE), at + p * PAGE_SIZE)
  }
}

function readAbsoluteUint32(card: Card, absolute: number, byteOffset: number): number {
  if (absolute >= card.clusterCount) throw bad('cluster outside the card')
  const page = Math.floor(byteOffset / PAGE_SIZE)
  const start = (absolute * card.pagesPerCluster + page) * card.pageStride + (byteOffset % PAGE_SIZE)
  return card.view.getUint32(start, true)
}

/** FAT entry of a cluster number counted from the start of the allocatable area. */
function fatEntry(card: Card, relative: number): number {
  const perCluster = card.clusterSize / 4
  const fatIndex = Math.floor(relative / perCluster)
  const ifcIndex = Math.floor(fatIndex / perCluster)
  const ifcCluster = card.ifcList[ifcIndex]
  if (ifcCluster === undefined) throw bad('cluster outside the FAT')
  const fatCluster = readAbsoluteUint32(card, ifcCluster, 4 * (fatIndex % perCluster))
  return readAbsoluteUint32(card, fatCluster, 4 * (relative % perCluster))
}

/** Read `length` bytes of the cluster chain starting at `first`; bounded by the card's cluster count. */
function readChain(card: Card, first: number, length: number): Uint8Array {
  const needed = Math.ceil(length / card.clusterSize)
  const available = card.clusterCount - card.allocOffset
  if (needed > available) throw bad('file larger than the card')
  const data = new Uint8Array(needed * card.clusterSize)
  const seen = new Set<number>()
  let cluster = first
  for (let n = 0; n < needed; n++) {
    if (cluster >= available) throw bad('cluster chain leaves the card')
    if (seen.has(cluster)) throw bad('cluster chain loops')
    seen.add(cluster)
    copyCluster(card, card.allocOffset + cluster, data, n * card.clusterSize)
    if (n === needed - 1) break
    const entry = fatEntry(card, cluster)
    const next = entry & FAT_NO_NEXT
    if ((entry & FAT_ALLOCATED) === 0 || next === FAT_NO_NEXT) throw bad('cluster chain ends early')
    cluster = next
  }
  return data.subarray(0, length)
}

interface Entry {
  mode: number
  length: number
  cluster: number
  name: string
}

function parseEntry(data: Uint8Array, index: number): Entry {
  const view = new DataView(data.buffer, data.byteOffset + index * ENTRY_SIZE, ENTRY_SIZE)
  let name = ''
  for (let i = 0; i < DE_NAME_LENGTH; i++) {
    const c = view.getUint8(DE_NAME + i)
    if (c === 0) break
    name += String.fromCharCode(c)
  }
  return {
    mode: view.getUint16(DE_MODE, true),
    length: view.getUint32(DE_LENGTH, true),
    cluster: view.getUint32(DE_CLUSTER, true),
    name,
  }
}

/** Entries of the directory whose chain starts at `first`; the first entry (".") holds the count. */
function readDirectory(card: Card, first: number, count: number | null): Entry[] {
  const perCluster = card.clusterSize / ENTRY_SIZE
  // the entry count lives in the "." entry at the start of the first cluster
  const total = count ?? parseEntry(readChain(card, first, ENTRY_SIZE), 0).length
  if (total > (card.clusterCount - card.allocOffset) * perCluster) throw bad('directory larger than the card')
  const data = readChain(card, first, total * ENTRY_SIZE)
  const entries: Entry[] = []
  for (let i = 0; i < total; i++) entries.push(parseEntry(data, i))
  return entries
}

/**
 * Find every Dragon Quest VIII save on the card: for each root directory named BASLUS-21207… (USA)
 * or BESLES-53974… (Europe), the file inside it with the same name as the directory. Sorted by directory name.
 * @throws SaveError('card-format') for a damaged or truncated image
 */
export function listCardSaves(bytes: Uint8Array): CardSave[] {
  const card = openCard(bytes)
  const root = readDirectory(card, card.rootCluster, null)
  const saves: CardSave[] = []
  for (const dir of root) {
    if ((dir.mode & MODE_EXISTS) === 0 || (dir.mode & MODE_DIRECTORY) === 0) continue
    const region = GAME_PREFIXES.find(([prefix]) => dir.name.startsWith(prefix))?.[1]
    if (region === undefined) continue
    const file = readDirectory(card, dir.cluster, dir.length).find(
      (e) => (e.mode & MODE_EXISTS) !== 0 && (e.mode & MODE_FILE) !== 0 && e.name === dir.name,
    )
    if (!file) continue
    saves.push({ dirName: dir.name, bytes: readChain(card, file.cluster, file.length).slice(), region })
  }
  return saves.sort((a, b) => (a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0))
}
