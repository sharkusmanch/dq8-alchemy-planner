export interface SaveSnapshot {
  playTimeFrames: number
  potLevel: 0 | 1 | 2 | 3
  potStatus: 0 | 1 | 2
  /** game item ids, zero ingredients dropped; null when pot status is 0 */
  pot: { result: number; ingredients: number[] } | null
  gold: number
  bag: { gameId: number; qty: number }[]
  /** four characters in order Hero, Yangus, Jessica, Angelo; empty slots dropped */
  characters: { items: { gameId: number; equipped: boolean }[] }[]
  recipeStatus: number[]            // 184 bytes
  brews: { basic: number; improved: number; successful: number }
  zoomBits: number[]                // set bit numbers, ascending; 0 = Farebury
  daveSequence: number              // 0–5
  daveTrades: number[]              // six counts
  medalPrizes: number               // Mini Medal prizes received, in the order they are given
  storyProgress: number             // chapter of the main story; rises as the story advances
  trialProgress: number             // Dragovian trials beaten, 0–6
  /**
   * Non-zero bytes of the progress blocks (PROGRESS_BLOCKS in layout.ts: event flags, treasure flags and
   * monster records), by file offset. The parser does not interpret them: the game data names the bit or
   * the counter that stands for a pickup.
   */
  progress: Record<number, number>
}
export type SaveErrorCode = 'size' | 'empty' | 'format' | 'pot' | 'card-format' | 'no-saves'
export class SaveError extends Error {
  constructor(public code: SaveErrorCode, message: string) { super(message); this.name = 'SaveError' }
}
