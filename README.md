# DQ8 Alchemy Planner

A web app that plans the alchemy side of Dragon Quest VIII on PS2 (USA) for the RetroAchievements set. It tells you what to brew next, what to buy and where, and what you are about to waste.

**Use it:** https://sharkusmanch.github.io/dq8-alchemy-planner/

It is built for a phone, so you can keep it open next to the game.

## What it tracks

- All 184 recipes, including the 10, 25, 50, 100, 150 and 184 recipe milestones.
- The two missable brew counters: 30 brews in the basic pot before it is upgraded, and 100 brews in the improved pot before the instant pot.
- The scarce ingredients that make the full list missable, such as the Icicle Dirks, Orichalcum and Slime Crowns, with the one-time places to get each.
- Dodgy Dave's item exchange, which uses up items you may want for recipes.
- The cheeses, which are simply among the 184 recipes; the app has no cheese-specific feature.

## The five tabs

- **Next**: the pot (with a Collect button), a warning for any scarce item you can no longer get enough of, and a queue of recipes to brew in a sensible order. Each queue entry has a brew button, labelled "Brewed" or, when the recipe needs an intermediate brewed first, "Brewed <item>" (with the instant pot, "Brewed all N steps"). An entry that needs purchases also has a Bought button. Below the queue come a filler brew for the pot counters, your progress counters, the first few recipes that need an item you have to find (with a button for the rest), and a quiet line for each scarce item that monster drops still have to supply.
- **Shop**: what to buy, grouped by town and shop, with a Bought button on each line, "Bought all here" for each place, and a total against your gold. "Everything reachable" lists purchases beyond what you can afford now. A "Whole run" estimate sits at the bottom.
- **Bag**: your items, with steppers to correct counts, a search, and a list of what is equipped.
- **Recipes**: all 184 recipes with a status for each, a search and a filter. You can tick a recipe done or not done by hand.
- **More**: import a save, set the save URL, story stage, pot level and gold, Dodgy Dave's requests (each can be marked done by hand, "He wants this now" says he has moved on to it, and the one he wants now has a "Handed in" button), scarce-item pickups, a spoiler toggle, export and import of your progress, reset, and credits.

By default the app hides later story places, recipes and requests behind a count ("31 more later in the story"). Turn on Show spoilers in More to see them.

## Getting your game in

You can do any of these, or none of them and just tap.

**By hand.** Set your story stage, pot level and gold in More, then add your items in Bag. As you play, press Bought on the Shop tab (or on a Next entry that needs purchases), the brew button on Next after you brew, and Collect on Next when you take the result out of the pot.

While the pot takes time (basic and improved pots), each press of the brew button records one brew and the queue re-plans around what is in the pot. A recipe that needs an intermediate brewed first therefore takes one press per trip to the pot. With the instant pot, one press brews every step.

**From a save file.** In More, choose a file under "Import a save". It accepts:

- A raw save of exactly 23,776 bytes.
- A PCSX2 folder memory card save. Each save is a file named like `BASLUS-21207dq8_0` inside a folder of the same name; pick that file directly.
- A whole `.ps2` memory card image. If it holds one Dragon Quest VIII save, that is imported straight away. If it holds several, the app lists them with play time and gold and you choose one.

Importing replaces your bag, gold, pot, brew counters, completed recipes and Dodgy Dave progress with what the save holds. The story stage only moves forward. After an import the scarce-item pickups reflect the save, the same as the bag: one the save shows as taken (an opened chest, a Mini Medal prize, a boss beaten) is ticked, and every other one is un-ticked, whatever you had ticked by hand. Your settings are kept. The line shown after an import says how many scarce pickups are already collected, and how many items it ignored because it does not know them (a cheat device can put such items in a save). Undo is offered right after an import or a reset, until your next change (a stepper tap, Bought, a toggle, anything).

A save is a snapshot from your last church save. Anything you bought, found or brewed since then, you enter by tapping.

**From a save URL.** If you host your newest save somewhere yourself, put its address in More and the app imports it whenever the bytes change. See [docs/save-url.md](docs/save-url.md).

## Privacy

Save files are read entirely in your browser. They are never uploaded. There are no accounts and no analytics. The app makes no network requests except to a save URL you set yourself (or, in a self-hosted copy built with a default save URL, that copy's own server).

Your progress lives in your browser's localStorage. Clearing site data erases it, so use Export in More to keep a backup file, and Import to restore it.

## Self-hosting

The public site on GitHub Pages never contacts anything unless you give it a save URL. If you run your own copy and keep your newest save on the same server, you can have it import the save by itself:

1. Build with a default save URL: `VITE_DEFAULT_SAVE_URL=./save npm run build`. The variable is read at build time; leave it unset for the plain build.
2. Serve `dist/` and, at that path on the same origin (`/save` for the example above), the newest save file: the plain 23,776-byte save, not a memory card. Send `Cache-Control: no-store`. Answer 404 while no save has been synced.
3. Open the page. With the box empty in More, the app checks that address when it opens and when you come back to it, and imports the save whenever its bytes change. The More tab says "This copy checks its own server for your newest save." A link you type there still takes priority.

Because the save is on the page's own origin, no CORS header is needed, and whatever protects the page (a login in front of it, say) protects the save. If that login expires, the app says so and asks you to reload the page. A 404 from the built-in address is not treated as an error on its own: the app stays quiet when it checks automatically, and Refresh now says that no save has been synced to the server yet.

Unticking "Check for a new save automatically" in More turns the on-open and on-return checks off for one browser; Refresh now still works. Exported state files carry this choice but never the URL, and importing one keeps the browser's own values for both. The details of the address contract are in [docs/save-url.md](docs/save-url.md).

## Scope

PS2, USA release (SLUS-21207). The shops, prices and recipes in the app are from that release.

A save from the European PS2 release has the same layout. On a memory card image the app recognises it, labels it "European version" and imports it, with a reminder that shops and prices are the US ones. A raw European save file cannot be told apart from a US one and is read as US, so its play time shows a sixth too short. The Japanese PS2 release, the 3DS version and the mobile version are not supported.

## Limits

- It does not know which gear you want to keep and wear. Check before you brew something you are using.
- It does not track which ordinary treasure chests you have opened. Items found in chests are entered by hand.
- The whole-run gold and gather totals on the Shop tab are estimates. The gold figure is an upper bound: it assumes you buy everything that shops sell.
- Two recipe numbers (Magic water and Elfin elixir) are unconfirmed when importing a save, because the sources do not settle which is which. The app follows what published saves point to, and the Recipes tab marks both "save number unconfirmed". If one of those shows as done when it should not be, or the other way round, toggle it by hand there.
- A save shows the story stage only roughly at two points: after the Dragon Graveyard side quest and after the escape from Purgatory Island it may import one stage early. Set the stage in More if a shop you can use is missing.
- An item a character has equipped is not counted as stock. Where the app would send you to find such an item it first says it is equipped; unequip it in the game and import again, or add it in Bag.
- By the recipe graph, a full run needs 8 Orichalcum and 4 Slime Crowns. That is one more of each than some guides state, because Liquid Metal Sword has to be brewed twice. The app uses its own figure.

## Running it locally

Needs Node.js 24 or later.

```
npm ci
npm run dev        # development server
npm test           # unit and data tests
npm run typecheck
npm run build      # static site in dist/
```

Pushing to `main` builds and publishes the site to GitHub Pages with the workflow in `.github/workflows/pages.yml`.

## Regenerating the data

The recipe, item, shop and goal data in `src/data/` is committed, so you do not need to do this to use or build the app. The Python scripts in `tools/` (standard library only) rebuild it from reference material that is not part of this repository:

```
python3 tools/build_items_recipes.py
python3 tools/build_shops.py
python3 tools/build_sources.py
python3 tools/build_goals.py
```

Run them from the repository root, in that order. They read the guides and notes credited below from a `sources/` directory, which is gitignored and which you must fill yourself; each script's header names the files it expects. Names from different sources are matched exactly or through `tools/aliases.json`, and any name that cannot be matched stops the build. `tools/DATA_NOTES.md` records what could not be confirmed from two sources, including the Magic water and Elfin elixir guess.

## Credits

The recipe and item data is factual game information gathered from the work of others:

- **bdjeffyp**, for the RetroAchievements guide and alchemy checklist.
- The authors of the Dragon Quest VIII **RetroAchievements** set and its code notes, for the documentation of the game's memory that makes save reading possible.
- **Red_Scarlet**, for the GameFAQs walkthrough (item cards, shops and where items are found).
- **Dunatis2000**, for the 100% walkthrough.
- **Dragon's Den** (woodus.com), for its alchemy recipe tables.

## Disclaimer and licence

This is an unofficial, fan-made tool. It is not affiliated with or endorsed by Square Enix or Level-5. It ships no game assets. Dragon Quest is a trademark of its owners.

The code is released under the [MIT licence](LICENSE).
