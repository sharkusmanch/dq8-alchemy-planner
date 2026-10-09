import type { JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import type { Location, Stage } from '../../data/types'
import type { SaveRegion } from '../../save/card'
import { readSaveFile } from '../../save/detect'
import { parseImportedState, exportState } from '../../state/persist'
import {
  describeSave, formatPlayTime, importErrorMessage, importRawSave, type SaveDescription,
} from '../import'
import { usePoller } from '../poller'
import { useStore } from '../store'

const EXPORT_FILENAME = 'dq8-alchemy-planner.json'
const POT_LEVELS = ['No pot yet', 'Basic pot', 'Improved pot', 'Instant pot']

type Confirm = 'dave' | 'reset' | null

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** Takes the chosen file out of a file input and clears the input so the same file can be picked again. */
function takeFile(input: HTMLInputElement): File | undefined {
  const file = input.files?.[0]
  input.value = ''
  return file
}

export function More(): JSX.Element {
  const { state, index, dispatch, undo, canUndo } = useStore()
  const poller = usePoller()
  const { showSpoilers, saveUrl } = state.settings
  const currentUrl = useRef(saveUrl) // read after an await, when the closure may be a render behind
  currentUrl.current = saveUrl

  const [importError, setImportError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [card, setCard] = useState<SaveDescription[] | null>(null)
  const [cardSaves, setCardSaves] = useState<{ bytes: Uint8Array; region: SaveRegion }[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [daveError, setDaveError] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const stages = index.data.stages
  const stageRank = (id: string): number => stages.findIndex((s) => s.id === id)
  const playerRank = stageRank(state.stage)

  async function importBytes(bytes: Uint8Array, region?: SaveRegion): Promise<void> {
    try {
      setStatus(await importRawSave(bytes, 'upload', { index, dispatch }, () => new Date().toISOString(), region))
      setCard(null)
    } catch (error) {
      setImportError(importErrorMessage(error))
    }
  }

  async function onSaveFile(input: HTMLInputElement): Promise<void> {
    const file = takeFile(input)
    if (!file) return
    setImportError(null)
    setStatus(null)
    setCard(null)
    try {
      const found = readSaveFile(new Uint8Array(await file.arrayBuffer()))
      if (found.kind === 'raw') await importBytes(found.bytes)
      else if (found.saves.length === 1) await importBytes(found.saves[0]!.bytes, found.saves[0]!.region)
      else {
        setCardSaves(found.saves.map(({ bytes, region }) => ({ bytes, region })))
        setCard(found.saves.map((save) => describeSave(save)))
      }
    } catch (error) {
      setImportError(importErrorMessage(error))
    }
  }

  async function onStateFile(input: HTMLInputElement): Promise<void> {
    const file = takeFile(input)
    if (!file) return
    setBackupError(null)
    setStatus(null)
    try {
      const imported = parseImportedState(await file.text(), index)
      // Exports leave the save URL out, so the current one stays.
      const error = dispatch({ type: 'importState', state: { ...imported, settings: { ...imported.settings, saveUrl: currentUrl.current } } })
      if (error !== undefined) throw new Error(error)
      setStatus('State imported.')
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    }
  }

  async function refresh(): Promise<void> {
    if (!poller) return
    setRefreshing(true)
    try {
      await poller.trigger(true)
    } finally {
      setRefreshing(false)
    }
  }

  const lastImport = state.lastImport
  const lastImportAt = lastImport ? new Date(lastImport.at) : null

  // Dodgy Dave. He can move on without a hand-in, so the done requests need not come first.
  const dave = index.data.goals.dave
  const handedIn = (k: number): boolean => state.dave.done[k] === true
  const wanted = dave[state.dave.next]
  const allDone = dave.every((_, k) => handedIn(k))
  // With spoilers off, requests Dave has not got to yet are counted, not named.
  const reachedUpTo = Math.max(state.dave.next, ...dave.map((_, k) => (handedIn(k) ? k : -1)))
  const daveShown = dave.map((_, k) => k).filter((k) => showSpoilers || k <= reachedUpTo)
  function handIn(): void {
    setConfirm(null)
    setDaveError(dispatch({ type: 'daveHandIn' }) ?? null)
  }

  // Scarce sources
  const locationRank = (id: string): number => {
    try {
      return stageRank(index.location(id).stage)
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }
  const reachable = (location: Location['id']): boolean => showSpoilers || locationRank(location) <= playerRank
  const scarceGroups = index.data.goals.scarce
    .map((entry) => ({ entry, shown: entry.sources.filter((s) => reachable(s.location)) }))
    .filter((group) => group.shown.length > 0)
  const hiddenSources = index.data.goals.scarce.reduce((n, entry) => n + entry.sources.length, 0)
    - scarceGroups.reduce((n, group) => n + group.shown.length, 0)

  const stageLabel = (stage: Stage, rank: number): string =>
    showSpoilers || rank <= playerRank + 1 ? stage.label : `Later (${rank - playerRank - 1})`

  return (
    <div class="tab">
      <h1>More</h1>

      <section aria-labelledby="more-import">
        <h2 id="more-import">Import a save</h2>
        <p class="meta">
          Pick a raw save file or a PCSX2 memory card image (.ps2). It is read in your browser and never uploaded.
        </p>
        <input
          type="file"
          aria-label="Save file or memory card"
          onChange={(e) => { void onSaveFile(e.currentTarget) }}
        />
        {importError !== null && <p class="error" role="alert">{importError}</p>}

        {card !== null && (
          <>
            <p>This card holds several saves. Pick one to import.</p>
            <ul class="rows" aria-label="Saves on this card">
              {card.map((save, i) => (
                <li class="row" key={save.dirName}>
                  <span class="row-main">
                    <span class="name">{save.dirName}</span>
                    {save.ok
                      ? (
                        <span class="meta">
                          {save.region === 'eu' ? 'European version · ' : ''}
                          Play time {formatPlayTime(save.playTimeFrames)} · {save.gold} gold
                        </span>
                      )
                      : <span class="meta error">Unreadable: {save.error}</span>}
                  </span>
                  <button
                    type="button"
                    class="action"
                    disabled={!save.ok}
                    aria-label={`Import ${save.dirName}`}
                    onClick={() => { setImportError(null); void importBytes(cardSaves[i]!.bytes, cardSaves[i]!.region) }}
                  >
                    Import
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {status !== null && canUndo && <p role="status">{status}</p>}
        <p class="meta">
          {lastImport === null || lastImportAt === null
            ? 'No save imported yet.'
            : `Last import: ${lastImport.source === 'url' ? 'from your save URL' : 'uploaded'} at ${
              Number.isNaN(lastImportAt.getTime()) ? lastImport.at : lastImportAt.toLocaleString()
            }, play time ${formatPlayTime(lastImport.playTimeFrames)}`}
        </p>
        {canUndo && (
          <button type="button" onClick={() => { undo(); setStatus(null) }}>Undo</button>
        )}

        <h3>Save URL</h3>
        <p class="meta">
          Optional. A link that returns your newest save file; it is checked when the app opens and when you come back to it.
        </p>
        <div class="field-row">
          <input
            type="url"
            aria-label="Save URL"
            placeholder="https://example.com/dq8-save.bin"
            value={saveUrl}
            onInput={(e) => dispatch({ type: 'setSetting', key: 'saveUrl', value: e.currentTarget.value })}
          />
          <button type="button" disabled={!poller || saveUrl.trim() === '' || refreshing} onClick={() => { void refresh() }}>
            {refreshing ? 'Checking…' : 'Refresh now'}
          </button>
        </div>
      </section>

      <section aria-labelledby="more-progress">
        <h2 id="more-progress">Where you are</h2>
        <label class="field">
          <span>Story stage</span>
          <select
            aria-label="Story stage"
            value={state.stage}
            onChange={(e) => dispatch({ type: 'setStage', stage: e.currentTarget.value })}
          >
            {stages.map((stage, rank) => <option key={stage.id} value={stage.id}>{stageLabel(stage, rank)}</option>)}
          </select>
        </label>
        <label class="field">
          <span>Pot level</span>
          <select
            aria-label="Pot level"
            value={String(state.potLevel)}
            onChange={(e) => dispatch({ type: 'setPotLevel', level: Number(e.currentTarget.value) as 0 | 1 | 2 | 3 })}
          >
            {POT_LEVELS.map((label, level) => <option key={level} value={String(level)}>{label}</option>)}
          </select>
        </label>
        <label class="field">
          <span>Gold (leave empty if unknown)</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            aria-label="Gold"
            value={state.gold ?? ''}
            onInput={(e) => {
              const text = e.currentTarget.value.trim()
              if (text === '') dispatch({ type: 'setGold', gold: null })
              else if (Number.isFinite(Number(text))) dispatch({ type: 'setGold', gold: Number(text) })
            }}
          />
        </label>
      </section>

      <section aria-labelledby="more-dave">
        <h2 id="more-dave">Dodgy Dave</h2>
        {dave.length === 0 && <p class="empty">There are no Dodgy Dave requests to track.</p>}
        {dave.length > 0 && (
          <ul class="rows" aria-label="Dodgy Dave's requests">
            {daveShown.map((k) => {
              const request = dave[k]!
              const name = index.item(request.item).name
              return (
                <li class="row" key={k}>
                  <span class="row-main">
                    <span class="name">{name}</span>
                    <span class="meta">
                      {handedIn(k) ? 'Handed in' : `Reward: ${request.reward}`}
                      {k === state.dave.next && !allDone ? ' · Dave wants this now' : ''}
                    </span>
                  </span>
                  {k !== state.dave.next && !allDone && (
                    <button
                      type="button"
                      aria-label={`He wants this now: ${name}`}
                      onClick={() => { setConfirm(null); setDaveError(dispatch({ type: 'setDaveNext', request: k }) ?? null) }}
                    >
                      He wants this now
                    </button>
                  )}
                  <button
                    type="button"
                    class="toggle"
                    aria-pressed={handedIn(k)}
                    aria-label={`Done: ${name}`}
                    onClick={() => dispatch({ type: 'toggleDave', request: k })}
                  >
                    Done
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {daveShown.length < dave.length && (
          <p class="later">{dave.length - daveShown.length} more later in the story.</p>
        )}
        {allDone && dave.length > 0 && <p class="empty">All of Dodgy Dave's requests are done.</p>}
        {wanted !== undefined && !allDone && (
          <>
            <p>
              <strong>Dave wants now:</strong> {index.item(wanted.item).name}
              {' '}(you have {state.inventory[wanted.item] ?? 0}).{' '}
              {handedIn(state.dave.next)
                ? 'You have handed it in before; another one only earns gold.'
                : `Reward: ${wanted.reward}.`}
            </p>
            {confirm === 'dave' ? (
              <div class="confirm">
                <p>
                  {index.item(wanted.item).name} is a one-time item that may not be easy to get again.
                  Hand it in now?
                </p>
                <button type="button" class="action" onClick={handIn}>Yes, hand in {index.item(wanted.item).name}</button>
                <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            ) : (
              <button
                type="button"
                class="action"
                onClick={() => {
                  setDaveError(null)
                  if (index.isScarce(wanted.item)) setConfirm('dave')
                  else handIn()
                }}
              >
                Handed in
              </button>
            )}
            {daveError !== null && <p class="error" role="alert">{daveError}</p>}
          </>
        )}
      </section>

      <section aria-labelledby="more-scarce">
        <h2 id="more-scarce">Scarce items</h2>
        <p class="meta">Tick each source once you have picked it up, so the planner stops counting on it.</p>
        {scarceGroups.map(({ entry, shown }) => (
          <fieldset class="check-group" key={entry.item}>
            <legend>{index.item(entry.item).name}</legend>
            {shown.map((source) => (
              <label class="check" key={source.id}>
                <input
                  type="checkbox"
                  checked={state.collected.includes(source.id)}
                  onChange={() => dispatch({ type: 'toggleCollected', sourceId: source.id })}
                />
                {source.label}
              </label>
            ))}
          </fieldset>
        ))}
        {scarceGroups.length === 0 && hiddenSources === 0 && <p class="empty">No scarce items to track.</p>}
        {hiddenSources > 0 && <p class="later">{hiddenSources} more at places you haven't reached yet.</p>}
      </section>

      <section aria-labelledby="more-spoilers">
        <h2 id="more-spoilers">Spoilers</h2>
        <p class="meta">Off, the app counts later recipes, requests and places instead of naming them.</p>
        <button
          type="button"
          class="toggle"
          aria-pressed={showSpoilers}
          onClick={() => dispatch({ type: 'setSetting', key: 'showSpoilers', value: !showSpoilers })}
        >
          Show spoilers
        </button>
      </section>

      <section aria-labelledby="more-backup">
        <h2 id="more-backup">Back up and reset</h2>
        <p class="meta">Export keeps your progress in a file. It leaves out the save URL.</p>
        <button type="button" onClick={() => download(EXPORT_FILENAME, exportState(state))}>Export</button>
        <p class="meta">Import replaces your progress with an exported file.</p>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="Planner state file"
          onChange={(e) => { void onStateFile(e.currentTarget) }}
        />
        {backupError !== null && <p class="error" role="alert">{backupError}</p>}

        {confirm === 'reset' ? (
          <div class="confirm">
            <p>
              Reset the planner? This clears your bag, progress and settings, including your save URL.
              You can undo it once.
            </p>
            <button
              type="button"
              class="action"
              onClick={() => {
                setConfirm(null)
                const error = dispatch({ type: 'reset' })
                if (error === undefined) setStatus('Everything was reset.')
              }}
            >
              Yes, reset everything
            </button>
            <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm('reset')}>Reset…</button>
        )}
      </section>

      <section aria-labelledby="more-credits">
        <h2 id="more-credits">Credits</h2>
        <p>
          Unofficial, fan-made and not affiliated with Square Enix or Level-5. It ships no game assets, and saves are
          processed only in your browser. The code is MIT licensed.
        </p>
        <p>
          The recipe data is factual game information gathered from bdjeffyp's RetroAchievements guide and checklist,
          the RetroAchievements set and code-note authors, Red_Scarlet's walkthrough, Dunatis2000's 100% walkthrough,
          and Dragon's Den.
        </p>
      </section>
    </div>
  )
}
