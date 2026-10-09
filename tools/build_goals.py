#!/usr/bin/env python3
"""Build src/data/goals.json from tools/curated/goals.json, and check the scarce arithmetic.

Usage: python3 tools/build_goals.py   (run from the repo root, after the other three scripts)

Inputs:
  tools/curated/goals.json                 written by hand; copied once it checks out, with the
                                           RAM addresses of the save signs turned into file offsets
  src/data/items.json, recipes.json, stages.json, locations.json, shops.json, sources.json
  sources/ra_codenotes.json                the notes each save sign is checked against

A scarce source may carry one sign by which a save shows it as taken (see DATA_NOTES.md):
  "flag": { "address": "0x40979e", "bit": 7 }   a treasure or event flag, by RAM address
  "medalPrize": 8                               its place in the order Mini Medal prizes are given
  "killCount": { "address": "0x40c920" }        the 16-bit kill count of a boss fought once
In src/data/goals.json an address becomes `offset`, the offset into the save file.

Checks, each of which stops the build:
  - every item, stage and location that goals.json names exists;
  - scarce source ids are `<item>-<n>`, numbered from 1 without gaps;
  - every save sign agrees with the code note at its address: the note has a line for the bit
    that names the item, the nth Mini Medal prize is the item, the kill count is of the boss
    that the label names;
  - the scarce list is exactly the rule below plus ALWAYS_SCARCE;
  - the whole-run need of every scarce item equals EXPECTED_NEED (see DATA_NOTES.md).

Scarce rule: an ingredient that nothing supplies without limit, that is, no shop stocks it, no
casino prize counter offers it, no recipe makes it and no monster has it as its normal drop.
A boss that is fought once is no such monster: build_sources.py lists its guaranteed drop as a
found source, and the scarce list has it as a one-time source like any chest.

Whole-run need of an item: one unit for each time a recipe lists it (every recipe brewed once)
and one for each Dodgy Dave request for it, plus the same again for every forced repeat brew.
A repeat brew is forced when recipes and requests consume more of a product than the recipes
that make it supply, and nothing but the pot supplies it (no shop and no source of any kind).
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True  # importing the sibling script must not leave a cache behind
from build_items_recipes import BuildError  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CURATED = ROOT / 'tools' / 'curated' / 'goals.json'
NOTES = ROOT / 'sources' / 'ra_codenotes.json'
OUT = ROOT / 'src' / 'data'

MAX_LABEL = 80
SAVE_BASE = 0x408e00   # file offset = RAM address - SAVE_BASE
SAVE_SIZE = 23776
SIGNS = ('flag', 'medalPrize', 'killCount')
MEDAL_NOTE = 0x408fae  # the count of Mini Medal prizes received; its note lists the prizes in order
# Where a note words the item differently from its name: source id -> what the note's line says.
# The Trolls' Maze reward is one event that hands over both kinds of seed.
NOTE_WORDING = {
    'conquerors-axe-1': "conquerer's axe",
    'dangerous-bustier-2': 'dangeous bustier',
    'seed-of-life-13': 'seeds of life',
    'seed-of-strength-12': 'seeds of strength',
}
REPEATABLE_KINDS = {'drop', 'casino'}
# Farmable in principle (the Metal King Slime's normal drop, at 1 in 64), listed because the
# achievement guide singles it out. Orichalcum needs no exception: its only normal drop is the
# Ruin's, a one-time source.
ALWAYS_SCARCE = {'slime-crown'}
# Units of each scarce item that brewing all 184 recipes and serving Dodgy Dave consumes.
EXPECTED_NEED = {
    'icicle-dirk': 2, 'orichalcum': 8, 'slime-crown': 4, 'gold-nugget': 4, 'templars-sword': 1,
    'battle-fork': 1, 'miracle-sword': 1, 'conquerors-axe': 1, 'dangerous-bustier': 1,
    'metal-king-spear': 1, 'dragovian-sword': 1, 'seed-of-life': 1, 'seed-of-wisdom': 1,
    'seed-of-strength': 1,
}


def load(name):
    return json.loads((OUT / f'{name}.json').read_text(encoding='utf-8'))


def check_references(goals, items, stages, locations):
    if set(goals) != {'brewThresholds', 'potStages', 'milestones', 'dave', 'scarce'}:
        raise BuildError(f'unexpected keys in goals.json: {sorted(goals)}')
    for pot, stage in goals['potStages'].items():
        if stage not in stages:
            raise BuildError(f'potStages.{pot}: unknown stage {stage!r}')
    for request in goals['dave']:
        if set(request) != {'item', 'reward'} or request['item'] not in items or not request['reward'].strip():
            raise BuildError(f'bad Dodgy Dave request: {request}')
    seen = set()
    for entry in goals['scarce']:
        item = entry['item']
        if set(entry) != {'item', 'sources'} or item not in items or item in seen:
            raise BuildError(f'bad or repeated scarce entry: {item!r}')
        seen.add(item)
        for n, source in enumerate(entry['sources'], 1):
            signs = set(source) - {'id', 'label', 'location'}
            if not {'id', 'label', 'location'} <= set(source) or source['id'] != f'{item}-{n}' \
                    or not signs <= set(SIGNS) or len(signs) > 1:
                raise BuildError(f'scarce source {source.get("id")!r} should be {item}-{n} with id, label, '
                                 f'location and at most one of {", ".join(SIGNS)}')
            if source['location'] not in locations:
                raise BuildError(f'{source["id"]}: unknown location {source["location"]!r}')
            if not 0 < len(source['label']) <= MAX_LABEL:
                raise BuildError(f'{source["id"]}: label must be 1-{MAX_LABEL} characters')


def address_of(source, sign):
    text = source[sign].get('address') if isinstance(source[sign], dict) else None
    if not isinstance(text, str) or not re.fullmatch(r'0x[0-9a-f]{6}', text):
        raise BuildError(f'{source["id"]}: {sign} needs an address like "0x40979e"')
    address = int(text, 16)
    if not SAVE_BASE <= address < SAVE_BASE + SAVE_SIZE:
        raise BuildError(f'{source["id"]}: {text} is outside the save')
    return address


def check_signs(goals, items, notes):
    """Check every save sign against its code note; return {source id: sign as written to the data}."""
    prizes = re.findall(r'^(\d+) - (.+?)\s*$', notes.get(MEDAL_NOTE, ''), re.M)
    out = {}
    for entry in goals['scarce']:
        name = items[entry['item']]['name'].casefold()
        for source in entry['sources']:
            sid = source['id']
            wording = NOTE_WORDING.get(sid, name)
            if 'flag' in source:
                address, bit = address_of(source, 'flag'), source['flag'].get('bit')
                if set(source['flag']) != {'address', 'bit'} or bit not in range(8):
                    raise BuildError(f'{sid}: flag needs an address and a bit from 0 to 7')
                lines = [line for line in notes.get(address, '').splitlines()
                         if re.match(rf'b{bit}\b', line.strip(), re.I)]
                if len(lines) != 1 or wording not in lines[0].casefold():
                    raise BuildError(f'{sid}: the note at {address:#x} has no line for bit {bit} naming {wording!r}')
                out[sid] = {'flag': {'offset': address - SAVE_BASE, 'bit': bit}}
            elif 'medalPrize' in source:
                n = source['medalPrize']
                if not (isinstance(n, int) and 1 <= n <= len(prizes)):
                    raise BuildError(f'{sid}: medalPrize must be 1 to {len(prizes)}, the prizes in the note')
                medals, prize = prizes[n - 1]
                if prize.casefold() != name or f'{medals} Mini Medals' not in source['label']:
                    raise BuildError(f'{sid}: prize {n} in the note is {prize} for {medals} medals')
                out[sid] = {'medalPrize': n}
            elif 'killCount' in source:
                address = address_of(source, 'killCount')
                m = re.fullmatch(r'(.+) Kill Count \[16-Bit\]', notes.get(address, '').strip())
                if set(source['killCount']) != {'address'} or not m or m.group(1) not in source['label']:
                    raise BuildError(f'{sid}: the note at {address:#x} is not the kill count of a monster in the label')
                out[sid] = {'killCount': {'offset': address - SAVE_BASE}}
    used = Counter(sid for sid in NOTE_WORDING if sid in out and 'flag' in out[sid])
    if set(used) != set(NOTE_WORDING):
        raise BuildError(f'NOTE_WORDING rules that matched no flag: {sorted(set(NOTE_WORDING) - set(used))}')
    return out


def check_rule(goals, recipes, shops, sources):
    ingredients = {i for r in recipes for i in r['ingredients']}
    made = {r['result'] for r in recipes}
    sold = {i for shop in shops for i in shop['stock']}
    repeatable = {s['item'] for s in sources if s['kind'] in REPEATABLE_KINDS}
    by_rule = (ingredients - made - sold - repeatable) | ALWAYS_SCARCE
    listed = {entry['item'] for entry in goals['scarce']}
    if listed != by_rule:
        raise BuildError(f'scarce list differs from the rule: missing {sorted(by_rule - listed)}, '
                         f'extra {sorted(listed - by_rule)}')


def whole_run_need(goals, recipes, shops, sources):
    """Return (need per item, {recipeIndex: forced repeat brews})."""
    scarce = {entry['item'] for entry in goals['scarce']}
    makers = {}
    for r in recipes:
        makers.setdefault(r['result'], []).append(r)
    supplied_elsewhere = {i for shop in shops for i in shop['stock']} | {s['item'] for s in sources}
    requests = Counter(request['item'] for request in goals['dave'])
    repeats = Counter()
    for _ in range(100):
        need = Counter(requests)
        for r in recipes:
            for i in r['ingredients']:
                need[i] += 1 + repeats[r['recipeIndex']]
        changed = False
        for item in sorted(makers):
            if item in supplied_elsewhere:
                continue
            made = sum(1 + repeats[r['recipeIndex']] for r in makers[item])
            if need[item] <= made:
                continue
            # Repeat the recipe that eats the fewest scarce units; a tie that matters needs a person.
            cost = lambda r: sum(1 for i in r['ingredients'] if i in scarce)  # noqa: E731
            ranked = sorted(makers[item], key=cost)
            if len(ranked) > 1 and cost(ranked[0]) == cost(ranked[1]) > 0:
                raise BuildError(f'{item}: two recipes eat scarce items; choose the one to repeat by hand')
            repeats[ranked[0]['recipeIndex']] += need[item] - made
            changed = True
        if not changed:
            return need, repeats
    raise BuildError('repeat brews do not settle: two pot-only products feed each other')


def main():
    goals = json.loads(CURATED.read_text(encoding='utf-8'))
    items = {i['id']: i for i in load('items')}
    recipes, shops, sources = load('recipes'), load('shops'), load('sources')
    check_references(goals, items, {s['id'] for s in load('stages')}, {l['id'] for l in load('locations')})
    check_rule(goals, recipes, shops, sources)
    if not NOTES.is_file():
        raise BuildError(f'{NOTES.relative_to(ROOT)} is missing, so the save signs cannot be checked. Put the '
                         'RetroAchievements code notes export there (as for build_items_recipes.py) and run '
                         'this script again; src/data/goals.json was left as it is.')
    notes = {int(n['Address'], 16): n['Note']
             for n in json.loads(NOTES.read_text(encoding='utf-8'))['CodeNotes'] if n.get('Note')}
    signs = check_signs(goals, items, notes)
    for entry in goals['scarce']:
        entry['sources'] = [{'id': s['id'], 'label': s['label'], 'location': s['location'], **signs.get(s['id'], {})}
                            for s in entry['sources']]

    need, repeats = whole_run_need(goals, recipes, shops, sources)
    by_index = {r['recipeIndex']: r for r in recipes}
    print('forced repeat brews: ' + ', '.join(
        f'{by_index[n]["result"]} (recipe {n}) x{count}' for n, count in sorted(repeats.items())))
    print(f'{"scarce item":<20}{"direct":>7}{"repeats":>8}{"need":>5}{"one-time":>9}{"gap":>4}')
    found = {}
    for entry in goals['scarce']:
        item = entry['item']
        direct = sum(r['ingredients'].count(item) for r in recipes)
        found[item] = need[item]
        gap = max(0, need[item] - len(entry['sources']))
        print(f'{item:<20}{direct:>7}{need[item] - direct:>8}{need[item]:>5}{len(entry["sources"]):>9}{gap:>4}')
    if found != EXPECTED_NEED:
        diff = sorted(set(found.items()) ^ set(EXPECTED_NEED.items()))
        raise BuildError(f'scarce arithmetic changed; update EXPECTED_NEED and DATA_NOTES.md: {diff}')

    (OUT / 'goals.json').write_text(json.dumps(goals, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    kinds = Counter(sign for sign_of in signs.values() for sign in sign_of)
    print(f'wrote goals: {len(goals["dave"])} Dodgy Dave requests, {len(goals["scarce"])} scarce items, '
          f'{sum(len(e["sources"]) for e in goals["scarce"])} one-time sources '
          f'({", ".join(f"{kinds[k]} by {k}" for k in SIGNS)})')


if __name__ == '__main__':
    try:
        main()
    except BuildError as e:
        sys.exit(f'build error: {e}')
