#!/usr/bin/env python3
"""Build src/data/stages.json, locations.json and shops.json.

Usage: python3 tools/build_shops.py [--strict]   (run from the repo root; stdlib only)

Inputs:
  tools/curated/stages.json     ordered story checkpoints, copied as they are
  tools/curated/locations.json  places and the stage each first becomes reachable, copied
  src/data/items.json           item ids, names and gold prices (tools/build_items_recipes.py)
  tools/aliases.json            source spellings -> canonical item names
  sources/red_scarlet_part2.txt "Town Shops List" (shop stock and prices)
  sources/ra_codenotes.json     Zoom flags at 0x409090-0x409094 (checks every zoomBit)
Optional: tools/curated/price_overrides.json  { "<item id>": { "buy"?: n, "sell"?: n } }

Item names resolve exactly as in build_items_recipes.py: canonical name or an explicit alias,
never a fuzzy match; an unmapped name stops the build.

Every gold price in the shops list is compared with the item's `buy` in items.json. Each
disagreement is printed. Items listed in price_overrides.json are settled and only counted.
With --strict the build fails while any unsettled disagreement remains.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True  # importing the sibling script must not leave a cache behind
from build_items_recipes import BuildError, Resolver, load_codenotes, slug  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'sources'
TOOLS = ROOT / 'tools'
CURATED = TOOLS / 'curated'
OUT = ROOT / 'src' / 'data'

ZOOM_BASE = 0x409090
ZOOM_BYTES = 5
ZOOM_COUNT = 34
REQUIRED_STAGES = ['basic-pot', 'improved-pot', 'ship', 'flight', 'postgame']

# Zoom-note spellings that do not slug to a location id.
ZOOM_NOTE_LOCATIONS = {
    'Pereguin Quay': 'peregrin-quay',
    "Princess Minnie's": 'princess-minnies-castle',
    'Chateaux Felix': 'chateau-felix',
    'Royal Hunting Grounds': 'royal-hunting-ground',
}

# Shops-list town headings that do not slug to a location id.
TOWN_LOCATIONS = {
    'Empycchu and Dark Empycchu': 'empycchu',  # one stock list for both towns
}
TOWNS_WITHOUT_SHOPS = {'Lakeside Cabin'}

# The shop's own label, by the generic part of its heading in the list.
SHOP_NAMES = {
    'weapon shop': 'Weapon shop',
    'armour shop': 'Armour shop',
    'item shop': 'Item shop',
    'item shop 1': 'Item shop',
    'item shop 2': 'Item shop',
    'weapon and armour shop': 'Weapon and armour shop',
    'weapon/armour shop': 'Weapon and armour shop',
    'item/armour shop': 'Item and armour shop',
    'little girl next to item shop': 'Item shop',
}

# Curated facts about single shops, keyed by (location id, position within the town's list).
# `sells` is an item the shop must stock: it stops the table drifting out of step with the
# list. `id` and `name` replace the defaults; the remaining keys are copied to the shop.
SHOP_RULES = {
    # Sells only once its three locked chests have been opened (thief's key).
    ('peregrin-quay', 3): {'sells': 'bandana', 'id': 'peregrin-quay-item-stall',
                           'name': 'Item stall (after opening its three chests)'},
    ('neos', 0): {'sells': 'chain-whip', 'availableUntil': 'black-citadel'},
    ('neos', 1): {'sells': 'silver-cuirass', 'availableUntil': 'black-citadel'},
    ('neos', 2): {'sells': 'gold-rosary', 'availableUntil': 'black-citadel'},
    ('neos', 3): {'sells': 'turtle-shell', 'id': 'neos-item-shop-behind-inn',
                  'name': 'Item shop behind the inn',
                  'availableFrom': 'purgatory-island', 'availableUntil': 'black-citadel'},
    ('campsite-west-of-argonia', 0): {'sells': 'turtle-shell', 'timeOfDay': 'day'},
    ('argonia', 2): {'sells': 'zombiesbane', 'id': 'argonia-bazaar-weapons',
                     'name': 'Bazaar weapon stall', 'availableFrom': 'argonia-bazaar'},
    ('argonia', 3): {'sells': 'heavy-armour', 'id': 'argonia-bazaar-armour',
                     'name': 'Bazaar armour stall', 'availableFrom': 'argonia-bazaar'},
    # Sells a leaf only while the party holds none.
    ('argonia', 4): {'sells': 'yggdrasil-leaf', 'id': 'argonia-bazaar-yggdrasil-leaf',
                     'name': 'Bazaar Yggdrasil leaf stall', 'availableFrom': 'argonia-bazaar'},
    ('argonia', 5): {'sells': 'gold-ring', 'id': 'argonia-bazaar-accessories',
                     'name': 'Bazaar accessory stall', 'availableFrom': 'argonia-bazaar'},
    ('argonia', 6): {'sells': 'fresh-milk', 'id': 'argonia-bazaar-cheese-ingredients',
                     'name': 'Bazaar cheese ingredient stall', 'availableFrom': 'argonia-bazaar'},
    ('argonia', 7): {'sells': 'prayer-ring', 'id': 'argonia-bazaar-items',
                     'name': 'Bazaar item stall', 'availableFrom': 'argonia-bazaar'},
    ('orkutsk', 0): {'sells': 'king-axe', 'timeOfDay': 'night'},
    ('orkutsk', 1): {'sells': 'dragon-mail', 'timeOfDay': 'day'},
    # Opens during the first visit, which is the location's own stage: nothing to override.
    ('dragovian-sanctuary', 0): {'sells': 'dragon-dung'},
}
# Towns whose section carries a note outside the shop headings. Each was read when the
# rules above were written; a note anywhere else stops the build until someone reads it.
TOWNS_WITH_NOTES = {'neos', 'campsite-west-of-argonia', 'argonia', 'arcadia'}

EXPECTED = {'towns': 20, 'shops': 51, 'gold rows': 264, 'token rows': 12}

ROW = re.compile(r'^\s*(\S.*?)\s{2,}(?:\$([\d,]+)|([\d,]+) tokens)\s*$')
CONDITION = re.compile(r'\b(open|opens|only|until|after|night|nighttime|day|daytime)\b', re.I)


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


# ---------------------------------------------------------------- stages and locations

def check_stages(stages):
    ids = [s['id'] for s in stages]
    if len(set(ids)) != len(ids):
        raise BuildError('duplicate stage ids')
    story = 0
    for s in stages:
        if not {'id', 'label'} <= set(s) <= {'id', 'label', 'storyMin', 'trialMin'} \
                or slug(s['id']) != s['id'] or not s['label'].strip():
            raise BuildError(f'bad stage entry: {s}')
        # A save proves the stage once its story chapter (storyMin) or its count of Dragovian
        # trials beaten (trialMin) is at least this; a later stage never asks for an earlier chapter.
        for key in ('storyMin', 'trialMin'):
            if key in s and not (isinstance(s[key], int) and 1 <= s[key] <= 255):
                raise BuildError(f'{s["id"]}: {key} must be a whole number from 1 to 255')
        if s.get('storyMin', story) < story:
            raise BuildError(f'{s["id"]}: storyMin is lower than an earlier stage\'s')
        story = s.get('storyMin', story)
    missing = [r for r in REQUIRED_STAGES if r not in ids]
    if missing:
        raise BuildError(f'required stages missing: {missing}')
    if [i for i in ids if i in REQUIRED_STAGES] != REQUIRED_STAGES:
        raise BuildError(f'required stages out of order; need {REQUIRED_STAGES}')
    return {stage_id: rank for rank, stage_id in enumerate(ids)}


def zoom_bits(notes):
    """Return {location id: zoomBit} from the Zoom flag code notes."""
    bits = {}
    for offset in range(ZOOM_BYTES):
        note = notes.get(ZOOM_BASE + offset)
        if note is None or not note.startswith('Zoom List Flags'):
            raise BuildError(f'no Zoom flag note at {ZOOM_BASE + offset:#x}')
        for line in note.split('\r\n')[1:]:
            m = re.match(r'^b([0-7]) - (.+?)[\s,]*$', line.strip())
            if not m:
                raise BuildError(f'unexpected Zoom note line: {line!r}')
            name = m.group(2)
            location = ZOOM_NOTE_LOCATIONS.get(name, slug(name))
            if location in bits:
                raise BuildError(f'Zoom destination listed twice: {name!r}')
            bits[location] = offset * 8 + int(m.group(1))
    if sorted(bits.values()) != list(range(ZOOM_COUNT)):
        raise BuildError(f'expected Zoom bits 0-{ZOOM_COUNT - 1}, found {sorted(bits.values())}')
    return bits


def check_locations(locations, ranks, bits):
    ids = [l['id'] for l in locations]
    if len(set(ids)) != len(ids):
        raise BuildError('duplicate location ids')
    for l in locations:
        if not {'id', 'name', 'stage'} <= set(l) <= {'id', 'name', 'stage', 'zoomBit'} \
                or slug(l['id']) != l['id'] or not l['name'].strip():
            raise BuildError(f'bad location entry: {l}')
        if l['stage'] not in ranks:
            raise BuildError(f'location {l["id"]} has unknown stage {l["stage"]!r}')
    curated = {l['id']: l['zoomBit'] for l in locations if 'zoomBit' in l}
    if curated != bits:
        diff = sorted(set(curated.items()) ^ set(bits.items()))
        raise BuildError(f'zoomBit values disagree with the code notes: {diff}')
    return {l['id']: l for l in locations}


# ---------------------------------------------------------------- shops list

def town_sections():
    """Yield (town name, heading notes, paragraphs) for each town of the Town Shops List."""
    lines = (SRC / 'red_scarlet_part2.txt').read_text(encoding='utf-8', errors='replace').split('\n')
    marks = [n for n, line in enumerate(lines) if re.search(r'\|\s*\(III-[HI]\) ', line)]
    if len(marks) != 2:
        raise BuildError(f'expected one Town Shops List and one following header, found {len(marks)}')
    section = []
    for line in lines[marks[0] + 2:marks[1] - 1] + ['-' * 77]:
        if re.fullmatch(r'-{20,}\s*', line):
            paragraphs = [p for p in re.split(r'\n\s*\n', '\n'.join(section)) if p.strip()]
            if paragraphs:
                heading = [h.strip() for h in paragraphs[0].split('\n')]
                title, notes = [], []
                for h in heading:
                    (notes if h.startswith('*') or notes else title).append(re.sub(r'^\(III-H\d+\)\s*', '', h))
                yield ' '.join(title), notes, paragraphs[1:]
            section = []
        else:
            section.append(line)


def parse_shops(resolve, locations):
    """Return (shops, price rows, counts). A price row is (item id, gold price, shop id)."""
    shops, prices, counts = [], [], Counter()
    for town, heading_notes, paragraphs in town_sections():
        if town in TOWNS_WITHOUT_SHOPS:
            if any(ROW.match(line) for p in paragraphs for line in p.split('\n')):
                raise BuildError(f'{town}: stock rows found in a town listed as having no shops')
            continue
        counts['towns'] += 1
        location = TOWN_LOCATIONS.get(town, slug(town))
        if location not in locations:
            raise BuildError(f'shops-list town {town!r} is not a location; add it to tools/curated/locations.json')
        noted = bool(heading_notes)
        position = 0
        heading = None
        for paragraph in paragraphs:
            text = paragraph.strip()
            rows = [ROW.match(line) for line in text.split('\n')]
            if not all(rows):
                if is_heading(text):
                    heading = text
                elif not text.startswith('Inn:'):
                    noted = True  # a sentence about the town or one of its shops
                continue
            if heading is None:
                raise BuildError(f'{town}: stock rows without a shop heading')
            tokens = [bool(row.group(3)) for row in rows]
            if heading.startswith('Casino') != all(tokens) or any(tokens) != all(tokens):
                raise BuildError(f'{town}: {heading!r} mixes gold and token prices')
            if all(tokens):
                counts['token rows'] += len(rows)  # prize counters are sources, not shops
            else:
                shops.append(make_shop(location, position, heading, heading_notes, rows, resolve, prices))
                counts['gold rows'] += len(rows)
                position += 1
            heading = None
        if noted != (location in TOWNS_WITH_NOTES):
            raise BuildError(f'{town}: note {"found" if noted else "expected"}; review TOWNS_WITH_NOTES and SHOP_RULES')
    counts['shops'] = len(shops)
    return shops, prices, counts


def is_heading(text):
    return '\n' not in text and re.sub(r'\s*\(.*\)$', '', text).casefold() in {*SHOP_NAMES, 'casino'}


def make_shop(location, position, heading, heading_notes, rows, resolve, prices):
    generic = re.sub(r'\s*\(.*\)$', '', heading)
    rule = dict(SHOP_RULES.get((location, position), {}))
    name = rule.pop('name', SHOP_NAMES[generic.casefold()])
    shop_id = rule.pop('id', f'{location}-{slug(name)}')
    stock = []
    for row in rows:
        item = resolve(row.group(1), f'shops list, {shop_id}')
        if item in stock:
            raise BuildError(f'{shop_id}: {item} listed twice')
        stock.append(item)
        prices.append((item, int(row.group(2).replace(',', '')), shop_id))
    sells = rule.pop('sells', None)
    if sells is not None and sells not in stock:
        raise BuildError(f'{shop_id}: rule expects {sells} in stock; SHOP_RULES is out of step with the list')
    condition = ' '.join([heading[len(generic):]] + heading_notes)
    if CONDITION.search(condition) and sells is None:
        raise BuildError(f'{shop_id}: the list attaches a condition to this shop; add it to SHOP_RULES')
    listed_time = 'night' if re.search(r'night', condition, re.I) else \
        'day' if re.search(r'\bday', condition, re.I) else None
    if rule.get('timeOfDay') != listed_time:
        raise BuildError(f'{shop_id}: list says time of day {listed_time}, rule says {rule.get("timeOfDay")}')
    extra = set(rule) - {'availableFrom', 'availableUntil', 'timeOfDay'}
    if extra:
        raise BuildError(f'{shop_id}: unknown rule keys {sorted(extra)}')
    return {'id': shop_id, 'location': location, 'name': name, 'stock': stock,
            **{k: rule[k] for k in ('availableFrom', 'availableUntil', 'timeOfDay') if k in rule}}


def check_shops(shops, locations, ranks, counts):
    ids = [s['id'] for s in shops]
    dupes = [k for k, v in Counter(ids).items() if v > 1]
    if dupes:
        raise BuildError(f'duplicate shop ids: {dupes}; give them an id in SHOP_RULES')
    positions = Counter(s['location'] for s in shops)
    for (location, position) in SHOP_RULES:
        if position >= positions[location]:
            raise BuildError(f'SHOP_RULES names shop {position} of {location}, which the list does not have')
    for shop in shops:
        start = ranks[locations[shop['location']]['stage']]
        for key in ('availableFrom', 'availableUntil'):
            if key in shop and shop[key] not in ranks:
                raise BuildError(f'{shop["id"]}: unknown stage {shop[key]!r}')
        if 'availableFrom' in shop:
            if ranks[shop['availableFrom']] <= start:
                raise BuildError(f'{shop["id"]}: availableFrom is not later than its location stage')
            start = ranks[shop['availableFrom']]
        if 'availableUntil' in shop and ranks[shop['availableUntil']] <= start:
            raise BuildError(f'{shop["id"]}: closes before it opens')
    for key, expected in EXPECTED.items():
        if counts[key] != expected:
            raise BuildError(f'expected {expected} {key} in the shops list, found {counts[key]}')


def check_prices(prices, items, overrides):
    """Return (unsettled, settled) disagreements between the shops list and items.json."""
    buy = {i['id']: i.get('buy') for i in items}
    listed = {}
    for item, price, shop in prices:
        listed.setdefault(item, {}).setdefault(price, []).append(shop)
    unsettled, settled = [], []
    for item in sorted(listed):
        if set(listed[item]) == {buy[item]}:
            continue
        seen = '; '.join(f'{price} at {", ".join(shops)}' for price, shops in sorted(listed[item].items()))
        line = f'{item}: shops list says {seen}; items.json buy is {buy[item]}'
        (settled if item in overrides else unsettled).append(line)
    return unsettled, settled


# ---------------------------------------------------------------- main

def main(argv):
    strict = '--strict' in argv
    stages = load_json(CURATED / 'stages.json')
    curated_locations = load_json(CURATED / 'locations.json')
    items = load_json(OUT / 'items.json')
    overrides_path = CURATED / 'price_overrides.json'
    overrides = load_json(overrides_path) if overrides_path.exists() else {}

    ranks = check_stages(stages)
    locations = check_locations(curated_locations, ranks, zoom_bits(load_codenotes()))
    resolve = Resolver(items, load_json(TOOLS / 'aliases.json'))
    shops, prices, counts = parse_shops(resolve, locations)
    check_shops(shops, locations, ranks, counts)

    unused = sorted(set(locations) - {s['location'] for s in shops}
                    - {l['id'] for l in curated_locations if 'zoomBit' in l})
    print(f'locations with neither a shop nor a Zoom flag: {unused}')

    unsettled, settled = check_prices(prices, items, overrides)
    print(f'price disagreements with items.json: {len(unsettled)} unsettled, '
          f'{len(settled)} settled by price_overrides.json')
    for line in unsettled:
        print(f'  {line}')
    if unsettled and strict:
        raise BuildError('unsettled price disagreements (--strict)')

    for name, value in (('stages', stages), ('locations', curated_locations), ('shops', shops)):
        (OUT / f'{name}.json').write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'wrote {len(stages)} stages, {len(curated_locations)} locations, {len(shops)} shops '
          f'({counts["gold rows"]} stock rows; {counts["token rows"]} casino token rows left for sources.json)')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except BuildError as e:
        sys.exit(f'build error: {e}')
