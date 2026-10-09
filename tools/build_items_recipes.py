#!/usr/bin/env python3
"""Build src/data/items.json and src/data/recipes.json from the reference sources.

Usage: python3 tools/build_items_recipes.py   (run from the repo root; stdlib only)

Inputs (all under sources/, gitignored): ra_codenotes.json, ra_checklist.xlsx,
red_scarlet_part2.txt, dragons_den_alchemy.html.
Optional: tools/curated/price_overrides.json  { "<item id>": { "buy"?: n, "sell"?: n } }

Name resolution is exact (case-insensitive) against the canonical names from the RA code
note at 0x409a10, plus the explicit table in tools/aliases.json. No fuzzy matching: an
unmapped name stops the build.
"""
import html
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'sources'
TOOLS = ROOT / 'tools'
OUT = ROOT / 'src' / 'data'

ITEM_TABLE_ADDR = 0x409A10
RECIPE_BASE = 0x40E87D
RECIPE_COUNT = 184

CATEGORY_BY_HEADER = {
    'III-F1A': 'weapon', 'III-F1B': 'weapon', 'III-F1C': 'weapon', 'III-F1D': 'weapon',
    'III-F1E': 'weapon', 'III-F1F': 'weapon', 'III-F1G': 'weapon', 'III-F1H': 'weapon',
    'III-F1I': 'weapon', 'III-F1J': 'weapon', 'III-F1K': 'weapon',
    'III-F2A': 'armour', 'III-F2B': 'shield', 'III-F2C': 'helmet',
    'III-F3': 'accessory', 'III-F4': 'item', 'III-F5': 'other',
}


class BuildError(Exception):
    pass


def slug(name):
    s = name.lower().replace("'", '').replace('’', '')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


# ---------------------------------------------------------------- items

def load_codenotes():
    data = json.loads((SRC / 'ra_codenotes.json').read_text(encoding='utf-8'))
    return {int(n['Address'], 16): n['Note'] for n in data['CodeNotes']}


def build_items(notes):
    items = []
    for line in notes[ITEM_TABLE_ADDR].split('\r\n'):
        m = re.match(r'^([0-9A-Fa-f]{4}) - (.+)$', line.strip())
        if not m:
            continue
        game_id, name = int(m.group(1), 16), m.group(2).strip()
        if name == 'Nothing' or 'DUMMY' in name:
            continue
        items.append({'id': slug(name), 'gameId': game_id, 'name': name})
    ids = [i['id'] for i in items]
    dupes = [k for k, v in Counter(ids).items() if v > 1]
    if dupes:
        raise BuildError(f'duplicate item slugs: {dupes}')
    return items


class Resolver:
    def __init__(self, items, aliases):
        self.by_name = {i['name'].casefold(): i['id'] for i in items}
        self.aliases = {}
        for src_name, canon in aliases.items():
            if canon.casefold() not in self.by_name:
                raise BuildError(f'alias target is not a canonical item name: {src_name!r} -> {canon!r}')
            self.aliases[src_name.casefold()] = self.by_name[canon.casefold()]
        self.used_aliases = set()

    def __call__(self, name, where):
        key = name.strip().casefold()
        if key in self.by_name:
            return self.by_name[key]
        if key in self.aliases:
            self.used_aliases.add(key)
            return self.aliases[key]
        raise BuildError(f'unmapped name {name!r} ({where}); add it to tools/aliases.json')


# ---------------------------------------------------------------- Red_Scarlet cards

def parse_cards(resolve):
    lines = (SRC / 'red_scarlet_part2.txt').read_text(encoding='utf-8', errors='replace').split('\n')
    headers = []
    for n, line in enumerate(lines):
        m = re.match(r'^\s*\|\s*\(([IVX]+-[A-Z0-9]+)\)\s+(.*?)\s*\|\s*$', line)
        if m:
            headers.append((n, m.group(1)))
    cards = {}
    count = 0
    for n, line in enumerate(lines):
        if 'Buy price' not in line:
            continue
        count += 1
        top = n
        while not lines[top].startswith('/==='):
            top -= 1
        # The title is the first boxed line. One card has its top edge fused to the title line.
        fused = re.match(r'^/=+/\s*\|\s*(.+?)\s*\|?\s*$', lines[top])
        title_line = fused.group(1) if fused else lines[top + 1].strip().strip('|').strip()
        header = [h for pos, h in headers if pos < n][-1]
        category = CATEGORY_BY_HEADER[header]
        if header == 'III-F4' and title_line.lower().endswith('cheese'):
            category = 'cheese'
        m = re.search(r'Buy price:\s*(.*?)\s*/\s*Sell price:\s*(.*?)\s*\|?\s*$', line)
        if not m:
            raise BuildError(f'unparseable price line {n + 1}: {line!r}')
        buy_text, sell_text = m.groups()
        buy = re.search(r'\$([\d,]+)', buy_text)
        sell = re.search(r'\$([\d,]+)', sell_text)
        item_id = resolve(title_line, f'Red_Scarlet card, line {n + 1}')
        if item_id in cards:
            raise BuildError(f'two cards for {item_id}')
        cards[item_id] = {
            'category': category,
            'buy': int(buy.group(1).replace(',', '')) if buy else None,
            'sell': int(sell.group(1).replace(',', '')) if sell else None,
        }
    if count != 322:
        raise BuildError(f'expected 322 price lines, found {count}')
    return cards


# ---------------------------------------------------------------- checklist

def parse_checklist():
    z = zipfile.ZipFile(SRC / 'ra_checklist.xlsx')
    shared = re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode('utf-8'), re.S)
    strings = [html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', s, re.S))) for s in shared]
    sheet = z.read('xl/worksheets/sheet2.xml').decode('utf-8')
    rows = []
    for _, body in re.findall(r'<row [^>]*?r="(\d+)"[^>]*>(.*?)</row>', sheet, re.S):
        cells = {}
        for col, attrs, inner in re.findall(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', body, re.S):
            if not inner:
                continue
            v = re.search(r'<v>(.*?)</v>', inner, re.S)
            if v:
                cells[col] = strings[int(v.group(1))] if 't="s"' in attrs else v.group(1)
            else:
                t = re.search(r'<t[^>]*>(.*?)</t>', inner, re.S)
                if t:
                    cells[col] = html.unescape(t.group(1))
        rows.append(cells)
    header, body = rows[0], rows[1:]
    if [header.get(c) for c in 'BCDE'] != ['Create', 'Item 1', 'Item 2', 'Item 3']:
        raise BuildError(f'unexpected checklist header: {header}')
    out = []
    for cells in body:
        if cells.get('B'):
            out.append((cells['B'].strip(), [cells[c].strip() for c in 'CDE' if cells.get(c)]))
    return out


# ---------------------------------------------------------------- recipes

def note_label_and_hint(note):
    lines = note.split('\r\n')
    m = re.search(r'Alchemy Recipe Status:\s*(.+)$', lines[0])
    if not m:
        raise BuildError(f'unexpected recipe note: {lines[0]!r}')
    hint = None
    for line in lines[1:]:
        h = re.match(r'^\[(.+)\]$', line.strip())
        if h:
            hint = [p.strip() for p in h.group(1).split(' + ')]
    return m.group(1).strip(), hint


def build_recipes(notes, checklist, resolve):
    crecipes = [(resolve(res, 'checklist'), [resolve(i, f'checklist ingredient of {res}') for i in ing])
                for res, ing in checklist]
    if len(crecipes) != RECIPE_COUNT:
        raise BuildError(f'checklist has {len(crecipes)} recipes, expected {RECIPE_COUNT}')
    by_result = defaultdict(list)
    for k, (res, ing) in enumerate(crecipes):
        by_result[res].append(k)

    labelled = defaultdict(list)  # result id -> [(recipeIndex, hint ids or None)]
    for r in range(RECIPE_COUNT):
        note = notes.get(RECIPE_BASE + r)
        if note is None:
            raise BuildError(f'no code note for recipe {r}')
        label, hint = note_label_and_hint(note)
        hint_ids = sorted(resolve(h, f'hint of recipe {r}') for h in hint) if hint else None
        labelled[resolve(label, f'code note of recipe {r}')].append((r, hint_ids))

    # One pair is unlabelled: two notes say "Magic water" and none says "Elfin elixir".
    # The sources do not say which note is which. Published saves point to the lower recipe
    # number being Elfin elixir, so that is what is assigned; it is not confirmed in the game.
    # See "Unconfirmed" in tools/DATA_NOTES.md for the evidence and how to check.
    guessed = []
    magic, elfin = 'magic-water', 'elfin-elixir'
    if len(labelled[magic]) == 2 and not labelled.get(elfin) and len(by_result[magic]) == 1 \
            and len(by_result[elfin]) == 1:
        first, second = sorted(labelled[magic])
        labelled[elfin] = [first]
        labelled[magic] = [second]
        guessed = [first[0], second[0]]
    else:
        raise BuildError('Magic water / Elfin elixir situation changed; review the guess')

    recipes = {}
    for res, entries in labelled.items():
        cands = list(by_result[res])
        if len(cands) != len(entries):
            raise BuildError(f'{res}: {len(entries)} notes but {len(cands)} checklist recipes')
        pending = []
        for r, hint in entries:
            match = [k for k in cands if hint is not None and sorted(crecipes[k][1]) == hint]
            if hint is not None:
                if len(match) != 1:
                    raise BuildError(f'recipe {r} ({res}): hint {hint} matches {len(match)} checklist recipes')
                cands.remove(match[0])
                recipes[r] = crecipes[match[0]]
            else:
                pending.append(r)
        if len(pending) == 1 and len(cands) == 1:
            recipes[pending[0]] = crecipes[cands[0]]
        elif pending:
            raise BuildError(f'{res}: cannot settle {pending} against {cands}')
    return recipes, crecipes, guessed


# ---------------------------------------------------------------- Dragon's Den

def cross_check(recipes, resolve):
    # Dragon's Den is only a cross-check: a name that cannot be mapped is reported as a
    # disagreement (marked with '?') instead of stopping the build.
    def lenient(name, where):
        try:
            return resolve(name, where)
        except BuildError:
            return '?' + name.strip()

    text = (SRC / 'dragons_den_alchemy.html').read_text(encoding='utf-8', errors='replace')
    dd = defaultdict(list)
    for row in re.findall(r'<tr.*?</tr>', text, re.S):
        cells = [html.unescape(re.sub(r'<[^>]+>', '', c)).strip()
                 for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)]
        if len(cells) != 3 or cells[0] == 'Result':
            continue  # page header and footer rows
        res = lenient(cells[0], "Dragon's Den result")
        ing = sorted(lenient(p, f"Dragon's Den ingredient of {cells[0]}")
                     for p in re.split(r'\s*\+\s*', cells[2]) if p.strip())
        dd[res].append(ing)
    mine = defaultdict(list)
    for res, ing in recipes.values():
        mine[res].append(sorted(ing))
    problems = []
    for res in sorted(set(dd) | set(mine)):
        a, b = sorted(mine.get(res, [])), sorted(dd.get(res, []))
        if a != b:
            problems.append((res, a, b))
    return problems, sum(len(v) for v in dd.values())


# ---------------------------------------------------------------- main

def main():
    notes = load_codenotes()
    items = build_items(notes)
    aliases = json.loads((TOOLS / 'aliases.json').read_text(encoding='utf-8'))
    resolve = Resolver(items, aliases)

    cards = parse_cards(resolve)
    overrides_path = TOOLS / 'curated' / 'price_overrides.json'
    overrides = json.loads(overrides_path.read_text(encoding='utf-8')) if overrides_path.exists() else {}
    known = {i['id'] for i in items}
    for item_id in overrides:
        if item_id not in known:
            raise BuildError(f'price override for unknown item {item_id!r}')

    for item in items:
        card = cards.get(item['id'])
        item['category'] = card['category'] if card else 'other'
        if card:
            if card['buy'] is not None:
                item['buy'] = card['buy']
            if card['sell'] is not None:
                item['sell'] = card['sell']
        for key, value in overrides.get(item['id'], {}).items():
            if key not in ('buy', 'sell'):
                raise BuildError(f'bad override key {key!r} for {item["id"]}')
            item[key] = value

    checklist = parse_checklist()
    recipes, crecipes, guessed = build_recipes(notes, checklist, resolve)

    # assertions
    assert len(recipes) == RECIPE_COUNT, 'need 184 recipes'
    assert set(recipes) == set(range(RECIPE_COUNT)), 'recipeIndex must be exactly 0-183'
    assert sorted((r, sorted(i)) for r, i in recipes.values()) == \
        sorted((r, sorted(i)) for r, i in crecipes), 'recipe set must equal the checklist set'
    sizes = Counter(len(i) for _, i in recipes.values())
    assert sizes == {2: 120, 3: 64}, f'ingredient counts {dict(sizes)}'
    item_ids = {i['id'] for i in items}
    for res, ing in recipes.values():
        assert res in item_ids and all(x in item_ids for x in ing)

    problems, dd_total = cross_check(recipes, resolve)
    print(f"Dragon's Den rows: {dd_total}; disagreements with the checklist: {len(problems)}")
    for res, mine, theirs in problems:
        print(f'  {res}: checklist/notes={mine} dragons-den={theirs}')
    print(f'unconfirmed recipe pair (Elfin elixir, Magic water): {guessed}')

    unused = set(resolve.aliases) - resolve.used_aliases
    if unused:
        print(f'unused aliases: {sorted(unused)}')

    items.sort(key=lambda i: i['gameId'])
    ordered = [{'id': i['id'], 'gameId': i['gameId'], 'name': i['name'], 'category': i['category'],
                **{k: i[k] for k in ('buy', 'sell') if k in i}} for i in items]
    # The pair whose numbers are not confirmed is marked, so the app can tell the player to check them.
    out_recipes = [{'recipeIndex': r, 'result': recipes[r][0], 'ingredients': recipes[r][1],
                    **({'recipeIndexUnconfirmed': True} if r in guessed else {})}
                   for r in sorted(recipes)]
    (OUT / 'items.json').write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    (OUT / 'recipes.json').write_text(json.dumps(out_recipes, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'wrote {len(ordered)} items, {len(out_recipes)} recipes; '
          f'{sum(1 for i in ordered if i["category"] == "other")} items categorised other')


if __name__ == '__main__':
    try:
        main()
    except BuildError as e:
        sys.exit(f'build error: {e}')
