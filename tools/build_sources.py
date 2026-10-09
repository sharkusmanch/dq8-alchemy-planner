#!/usr/bin/env python3
"""Build src/data/sources.json: the ways to get an ingredient that are not shops.

Usage: python3 tools/build_sources.py   (run from the repo root; stdlib only)

Inputs:
  src/data/items.json, recipes.json, stages.json, locations.json   (earlier tasks)
  tools/aliases.json                  source spellings -> canonical item names
  sources/red_scarlet_part2.txt       item cards (Where found, Dropped by), the Town Shops List
                                      (casino prize counters) and the Mini Medals prize list

Only items that are an ingredient of at least one recipe get sources. Per card:
  Where found            -> found / gift / medal (Mini Medal prizes) / other, placed at a location
  Dropped by (normal)    -> drop, one per monster, no location; the guaranteed drop of a boss
                            that is fought once (BOSS_DROPS) -> found, at the place of the fight
  Dropped by (rare)      -> rare-drop, one per monster, no location
  casino prize counters  -> casino, with the token price, at the prize counter's location

Item names resolve exactly as in build_items_recipes.py (canonical name or an explicit alias,
never fuzzy). Every place name is resolved by LANDMARKS below; a place that matches nothing,
a prose entry that matches no rule and a drop by an unknown monster each stop the build.
`where` labels are our own short wording (at most 8 words and 80 characters), never the guide's
sentences; a card place name that reads as directions is replaced by a plain label (SHORT_PLACES).
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True  # importing the sibling scripts must not leave a cache behind
from build_items_recipes import BuildError, Resolver, slug  # noqa: E402
from build_shops import ROW, town_sections  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'sources'
TOOLS = ROOT / 'tools'
OUT = ROOT / 'src' / 'data'

MAX_WHERE = 80
MAX_WORDS = 8
MEDAL_LOCATION = 'princess-minnies-castle'
CONTAINERS = {'chest', 'barrel', 'pot', 'dresser', 'cupboard', 'bag'}
KIND_ORDER = {'found': 0, 'gift': 1, 'medal': 2, 'casino': 3, 'other': 4, 'drop': 5, 'rare-drop': 6}
# Card titles that are not items (memos, and the like).
NOT_ITEMS = re.compile(r"^Morrie's Memo #\d$")
# Monster-card spellings that differ from the drop lists.
MONSTER_ALIASES = {}

# Bosses that are fought once and always drop their item (the type-data code notes mark each as
# a boss with a guaranteed drop, and each monster card names a single fight). That item is a
# one-time pickup at the place of the fight, not a supply: monster -> (location, label).
# Every rule must match once. Red Horn, Blue Fang and the Servant of Darkness are also marked as
# bosses or event fights, but are met again as ordinary monsters, so they stay drops.
BOSS_DROPS = {
    'Geyzer': ('waterfall-cave', 'Waterfall Cave level 3: Geyzer (boss)'),
    'Tortured Soul': ('ruined-abbey', 'Ruined Abbey level 3: Tortured Soul (boss)'),
    'Empyrea': ('empycchu', 'West of Dark Empycchu: Empyrea (boss)'),
    'Megalodon': ('black-citadel', 'Black Citadel level 4: Megalodon (boss)'),
    'Ruin': ('black-citadel', 'Black Citadel: the Ruin (boss)'),
}
USED_BOSSES = set()

# ---------------------------------------------------------------- places

# Lower-case phrase -> location id. The longest phrase found in a place name wins, so
# "west trodain church" beats "trodain" and "beach south of argonia" beats "argonia".
# A field chest described relative to a landmark ("southeast of Neos") belongs to that
# landmark's location. Towns' sub-places (inn, shops, bar, well, floors) are the town.
LANDMARKS = {
    'farebury': 'farebury',
    'waterfall cave': 'waterfall-cave',
    'alexandria': 'alexandria',
    'tower of alexandra': 'tower-of-alexandra',
    'port prospect': 'port-prospect',
    'peregrin quay': 'peregrin-quay',
    'maella abbey': 'maella-abbey',
    'simpleton': 'simpleton',
    'ruined abbey': 'ruined-abbey',
    'riverside chapel': 'riverside-chapel',
    'ascantha': 'ascantha',
    "wisher's peak": 'wishers-peak',
    'pickham': 'pickham',
    'monster arena': 'monster-arena',
    "swordsman's labyrinth": 'swordsmans-labyrinth',
    "red's house": 'reds-house',
    'hilltop hut': 'hilltop-hut',
    'west trodain church': 'west-trodain-church',
    'trodain': 'trodain',
    'mole hole': 'mole-hole',
    "princess minnie's castle": 'princess-minnies-castle',
    'neos': 'neos',
    "pirate's cove": 'pirates-cove',
    'seaview church': 'seaview-church',
    'baccarat': 'baccarat',
    'chateau felix': 'chateau-felix',
    'dark ruins': 'dark-ruins',
    'savella cathedral': 'savella-cathedral',
    'argonia': 'argonia',
    'campsite west of argonia': 'campsite-west-of-argonia',
    'desert chapel': 'desert-chapel',
    'royal hunting ground': 'royal-hunting-ground',
    'arcadia': 'arcadia',
    "rydon's tower": 'rydons-tower',
    'chapel of autumn': 'chapel-of-autumn',
    'orkutsk': 'orkutsk',
    "marta's cottage": 'martas-cottage',
    'herb grotto': 'herb-grotto',
    'dragon graveyard': 'dragon-graveyard',
    'empycchu': 'empycchu',  # covers Dark Empycchu: one location, as in the shops list
    "godbird's eyrie": 'godbirds-eyrie',
    'tryan gully': 'tryan-gully',
    "lord high priest's house": 'lord-high-priests-residence',
    'black citadel': 'black-citadel',
    'dragovian sanctuary': 'dragovian-sanctuary',
    'dragovian path': 'dragovian-path',
    'heavenly dais': 'heavenly-dais',
    # Reached by ship, before the party can walk there (Dunatis "Treasure hunt (Ship)").
    'cape west of pickham': 'ship-shores',
    'island west of maella abbey': 'ship-shores',
    'beach south of argonia': 'ship-shores',
}
# Places that need the Godbird's Soulstone: any place name containing one of these.
FLYING = ('flying spot', 'howlwind hill', 'island west of lakeside cabin')
FLYING_LOCATION = 'aerial-islands'
# "Argonia 4F" and the like are floors of the castle, which opens later than the town.
CASTLE_FLOOR = re.compile(r'^argonia \d+f\b')
CASTLE_LOCATION = 'argonia-castle'
# Areas that open later than the town or dungeon they sit in, each its own location with its own
# stage (a source takes its stage from its location). First match wins, before LANDMARKS.
AREA_RULES = [
    (re.compile(r'^dark ruins b\d'), 'dark-ruins-interior'),               # opens with the Sun Mirror
    (re.compile(r"^godbird's eyrie \(light world\)"), 'godbirds-eyrie-light'),  # after the Soulstone
    (re.compile(r"^pirate's cove level"), 'pirates-cove-dungeon'),           # after the Ultimate Key
    (re.compile(r'.*\bbazaar\b.*\bindoors\b'), 'argonia-indoor-bazaar'),       # once Neos is destroyed
    (re.compile(r'^le club puff puff'), 'le-club-puff-puff'),               # Ultimate Key door
]
# Single chests behind a key that arrives later (Dunatis and Red_Scarlet list them after the key
# is obtained): (item, lower-case place, container) -> location. Every rule must match once.
LOCKED_CHESTS = {
    **{(i, "red's house", 'chest'): 'reds-house-basement' for i in ('garter', 'seed-of-agility')},
    **{(i, 'pickham', 'chest'): 'pickham-locked-room' for i in ('rune-staff', 'power-shield')},
    **{(i, 'trodain 2f', 'chest'): 'trodain-locked-room' for i in ('rusty-old-sword', 'yggdrasil-dew', 'seed-of-magic')},
    ('skull-ring', 'argonia 1f', 'chest'): 'argonia-treasury',
    **{(i, 'arcadia', 'chest'): 'arcadia-item-shop-back' for i in ('titan-belt', 'seed-of-magic')},
    **{(i, "princess minnie's castle", 'chest'): 'minnies-locked-room'
       for i in ('double-edged-sword', 'seed-of-strength', 'seed-of-life')},
    # Thief's Key chests in Farebury (the key is made at Peregrin Quay).
    **{(i, 'farebury weapon shop', 'chest'): 'farebury-weapon-shop-chest' for i in ('cypress-stick', 'dagger')},
    # Magic Key chests (the key comes from Trodain).
    ('agility-ring', 'far corner northeast of riverside chapel', 'chest'): 'riverside-chapel-locked-chests',
    ('seed-of-defence', 'over the mountains northeast of pickham', 'chest'): 'pickham-fields-locked-chests',
    ('gold-ring', "forest north-northwest of red's house", 'chest'): 'pickham-fields-locked-chests',
}
USED_LOCKED = set()
# Place names that could not be placed with confidence: location left unset, listed in DATA_NOTES.md.
UNPLACED = set()
# Card place names that read as directions rather than a label: lower-case place -> the label's
# place. The location is still resolved from the card's wording. Every rule must match once.
SHORT_PLACES = {
    "northwest from the old couple's house by the riverside chapel": 'Northwest of Riverside Chapel',
    'by the south end of the gate to alexandria': 'South end of the Alexandria gate',
    'far east of chateau felix across two rivers': 'Far east of Chateau Felix',
    'flying spot southwest of campsite west of argonia': 'Flying spot southwest of the Argonia campsite',
    'south end of the lake southwest of argonia': 'Lake southwest of Argonia, south end',
}
USED_SHORT = set()


def resolve_place(place):
    low = place.casefold()
    for pattern, location in AREA_RULES:
        if pattern.match(low):
            return location
    if any(f in low for f in FLYING):
        return FLYING_LOCATION
    if CASTLE_FLOOR.match(low):
        return CASTLE_LOCATION
    hits = [(len(phrase), loc) for phrase, loc in LANDMARKS.items() if phrase in low]
    if not hits:
        return None
    return max(hits)[1]


# ---------------------------------------------------------------- prose entries

def gift(where, location):
    return ('gift', where, location)


# Entries of a Where found list that are sentences, not "Place: container". Each rule is
# (regex, builder(match) -> (kind, where, location) | None); None drops the entry (a tail
# that continues the previous one). The label is our own wording.
def _starts(m):
    return gift(f'Starting equipment: {m.group(1)}', 'farebury')


def _dave(m):
    return gift(f'Dodgy Dave reward {m.group(1)} (trade: {m.group(3)})', 'dodgy-dave')


def _rank(m):
    # Rank C needs the monster team built on the way round the world (Red_Scarlet G3).
    location = 'monster-arena-rank-c' if m.group(1) == 'C' else 'monster-arena'
    return gift(f'Monster Arena rank {m.group(1)} prize', location)


def _trolls(m):
    count = {'two': 2, 'three': 3}[m.group(1)]
    return gift(f"Trolls' Maze reward: {count}", 'trolls-maze')


def keys(*parts):
    """A rule that finds its parts in this order anywhere in an entry, whatever the case."""
    return re.compile(r'.*'.join(parts), re.I)


# Each rule names two or three distinctive words of the entry it is for, never the entry itself.
PROSE = [
    # The whole entry: a longer one that goes on to say something else is not this rule's.
    (keys(r'^(?:The )?(Hero|Yangus|Jessica|Angelo) starts\b.{0,20}$'), _starts),
    (keys(r'\b(\d+)(st|nd|rd|th)\b', r'\bDodgy Dave\b', r'\btrade him an? (.+?) for\b'), _dave),
    (keys(r'\brank ([A-G])\b', r'\bMonster Arena\b'), _rank),
    (keys(r'\b(two|three)\b', r"\bTrolls' Maze\b"), _trolls),
    (keys(r'\bWaterfall Cave\b', r'\b2\b', r'\blater\b'),
     lambda m: gift('Waterfall hut woodsman: 2, after the Hunting Ground', 'waterfall-hut-later')),
    (keys(r'\bTool Bag\b', r'\bWaterfall Cave\b'),
     lambda m: gift('Waterfall hut woodsman: 8, returning the Tool Bag', 'waterfall-cave')),
    (keys(r'\bLord of the Dragovians\b', r'\btwice\b'),
     lambda m: gift('Dragovian trial prize: choose the sword', 'dragovian-trials')),
    (keys(r'\bchoose\b', r'\bDragovian Sword\b'), lambda m: None),
    (keys(r'\bKhalamari\b', r'\bbeating\b'),
     lambda m: gift('Khalamari, the ferry boss', 'peregrin-quay')),
    (keys(r'\bPeregrin Quay\b', r'\bgreen\b', r'\binn\b'),
     lambda m: gift('Peregrin Quay inn: man in green', 'peregrin-quay')),
    (keys(r'\bMarek\b', r'\bSoulstone\b'),
     lambda m: gift("Marek's house in Orkutsk: 4, after the Soulstone", 'mareks-house')),
    (keys(r'\bMarek\b', r'\bgrave\b', r'\bMarcello\b'),
     lambda m: gift("Marek at his mother's grave: 4, after Marcello", 'mareks-mothers-grave')),
    (keys(r'\bBaumren\b', r'\bSand of Serenity\b'),
     lambda m: gift("Baumren's tree, after the Sand of Serenity", 'chateau-felix')),
    (keys(r'\bhusband\b', r"\bLady's Ring\b", r'\bFarebury\b'),
     lambda m: gift("Farebury: Lady's Ring owner's husband (missable)", 'farebury')),
    (keys(r'\bbird\b', r'\bSavella Cathedral\b'),
     lambda m: gift('Savella Cathedral: talk to a bird', 'savella-cathedral')),
    # Cows stand all over the overworld from the start; no single place or stage fits.
    (keys(r'\bcows\b', r'\boverworld\b'),
     lambda m: ('found', 'Cows on the overworld', None)),
]
# A Mini Medal prize: the castle, then the medal count, within one list entry.
MEDAL = keys(r"\bMinnie's Castle\b[^,]*?\b(\d+) Mini Medals\b")
PLACED = re.compile(r'^(.+?): (.+)$')


def classify_found(entry, item):
    """Return (kind, where, location) for one Where found entry, or None for a tail."""
    m = MEDAL.search(entry)
    if m:
        return ('medal', f'Mini Medal prize: {m.group(1)} medals', MEDAL_LOCATION)
    for pattern, build in PROSE:
        m = pattern.search(entry)
        if m:
            return build(m)
    m = PLACED.match(entry)
    if not m:
        raise BuildError(f'unrecognised Where found entry {entry!r}; add a PROSE rule')
    place, detail = m.groups()
    if detail not in CONTAINERS and detail != 'well outside':
        raise BuildError(f'unrecognised container {detail!r} in {entry!r}')
    location = resolve_place(place)
    key = (item, place.casefold(), detail)
    if key in LOCKED_CHESTS:
        USED_LOCKED.add(key)
        location = LOCKED_CHESTS[key]
    if location is None and place not in UNPLACED:
        raise BuildError(f'cannot place {place!r}; add it to LANDMARKS or UNPLACED')
    shown = place
    if place.casefold() in SHORT_PLACES:
        USED_SHORT.add(place.casefold())
        shown = SHORT_PLACES[place.casefold()]
    return ('found', f'{shown[0].upper()}{shown[1:]}: {detail}', location)


def split_list(text):
    """Split a card list on commas that are not inside parentheses."""
    parts, depth, current = [], 0, ''
    for ch in text:
        depth += (ch == '(') - (ch == ')')
        if ch == ',' and depth == 0:
            parts.append(current.strip())
            current = ''
        else:
            current += ch
    parts.append(current.strip())
    return [p for p in parts if p]


# ---------------------------------------------------------------- Red_Scarlet cards

FIELD = re.compile(r'^(Where found|Where bought|Dropped by \((?:normal|rare)\)|Buy price|Alchemy Pot Ingredient\?|'
                   r'Mixed Item\?|Who can equip|Sell price)\s*:\s*(.*)$')
LISTED = ('Where found', 'Dropped by (normal)', 'Dropped by (rare)')
TOKEN_PRICE = re.compile(r'([\d,]+) casino tokens')


def card_blocks():
    """Yield (title, body lines, line number) for each boxed card of the item pages."""
    lines = (SRC / 'red_scarlet_part2.txt').read_text(encoding='utf-8', errors='replace').split('\n')
    starts = [n for n, line in enumerate(lines) if line.startswith('/=')]
    for a, b in zip(starts, starts[1:] + [len(lines)]):
        fused = re.match(r'^/=+/\s*\|\s*(.+?)\s*\|?\s*$', lines[a])
        body = lines[a + 1:b]
        if fused:
            title = fused.group(1)
        else:
            if not body or not body[0].startswith('|'):
                continue
            title, body = body[0].strip().strip('|').strip(), body[1:]
        body = [x for x in body if x.strip()]
        if body and all(x.startswith('|') for x in body):
            yield title, body, a + 1


def parse_cards(resolve):
    """Return {item id: {field: [text]}} for every item card."""
    cards = {}
    for title, body, n in card_blocks():
        text = '\n'.join(body)
        if 'Experience:' in text or 'Where fought' in text or 'Battle actions' in text:
            continue  # a monster page
        fields, current = {}, None
        for line in body:
            for segment in re.split(r'\s*\|\|\s*', line.rstrip()):
                raw = segment.lstrip('|')
                t = raw.strip().strip('|').strip()
                f = FIELD.match(t)
                if f:
                    current = f.group(1)
                    fields.setdefault(current, []).append(f.group(2))
                elif current in LISTED and t and len(raw) - len(raw.lstrip(' ')) >= 3:
                    fields[current][-1] += ' ' + t  # a wrapped line, indented under the label
                else:
                    current = None
        if not fields.keys() & {'Buy price', 'Where found', 'Dropped by (normal)', 'Dropped by (rare)'}:
            continue
        if NOT_ITEMS.match(title):
            continue
        item_id = resolve(title, f'Red_Scarlet card, line {n}')
        if item_id in cards:
            raise BuildError(f'two cards for {item_id}')
        cards[item_id] = fields
    return cards


def monster_names():
    names = set()
    for line in (SRC / 'red_scarlet_part2.txt').read_text(encoding='utf-8', errors='replace').split('\n'):
        for m in re.finditer(r'<#\d+>\s+(.+?)\s+\([^)]*Family\)', line):
            names.add(m.group(1))
    return names


# ---------------------------------------------------------------- casino and medals

def casino_rows(resolve):
    """Return [(item id, tokens, location id)] from the Town Shops List's prize counters."""
    rows = []
    for town, _notes, paragraphs in town_sections():
        for paragraph in paragraphs:
            matches = [ROW.match(line) for line in paragraph.strip().split('\n')]
            if not all(matches) or not all(m.group(3) for m in matches):
                continue
            location = f'{slug(town)}-casino'
            for m in matches:
                rows.append((resolve(m.group(1), f'prize counter at {location}'),
                             int(m.group(3).replace(',', '')), location))
    return rows


def medal_prizes(resolve):
    """Return {item id: medals} from the Mini Medals prize list."""
    text = (SRC / 'red_scarlet_part2.txt').read_text(encoding='utf-8', errors='replace')
    start = text.index('(III-I2) Medal Prizes')
    prizes = {}
    for m in re.finditer(r'^(\d{3}) Medals: (.+?)\s*$', text[start:start + 1500], re.M):
        prizes[resolve(m.group(2), 'Mini Medal prize list')] = int(m.group(1))
    if len(prizes) != 11:
        raise BuildError(f'expected 11 Mini Medal prizes, found {len(prizes)}')
    return prizes


# ---------------------------------------------------------------- main

def build(items, recipes, locations, cards, casino, resolve_monster):
    ingredients = {i for r in recipes for i in r['ingredients']}
    location_ids = {l['id'] for l in locations}
    by_item = {}

    def add(item, kind, where, location=None, tokens=None):
        if len(where) > MAX_WHERE or len(where.split()) > MAX_WORDS or not where:
            raise BuildError(f'bad label for {item} (at most {MAX_WORDS} words and {MAX_WHERE} characters): {where!r}')
        if location is not None and location not in location_ids:
            raise BuildError(f'{item}: {where!r} uses unknown location {location!r}; add it to tools/curated/locations.json')
        source = {'item': item, 'kind': kind, 'where': where}
        if location is not None:
            source['location'] = location
        if tokens is not None:
            source['tokens'] = tokens
        if source not in by_item.setdefault(item, []):
            by_item[item].append(source)

    for item in ingredients:
        fields = cards.get(item, {})
        for text in fields.get('Where found', []):
            for entry in split_list(text):
                found = classify_found(entry, item)
                if found is not None:
                    add(item, *found)
        for field, kind, label in (('Dropped by (normal)', 'drop', 'Drop'),
                                   ('Dropped by (rare)', 'rare-drop', 'Rare drop')):
            for text in fields.get(field, []):
                for monster in split_list(text):
                    name = resolve_monster(monster)
                    if kind == 'drop' and name in BOSS_DROPS:
                        USED_BOSSES.add(name)
                        location, where = BOSS_DROPS[name]
                        add(item, 'found', where, location)
                    else:
                        add(item, kind, f'{label}: {name}')
    for item, tokens, location in casino:
        if item in ingredients:
            add(item, 'casino', f'Casino prize: {tokens:,} tokens', location, tokens)

    order = {i['id']: n for n, i in enumerate(items)}
    out = []
    for item in sorted(by_item, key=order.get):
        out += sorted(by_item[item], key=lambda s: KIND_ORDER[s['kind']])  # stable: card order within a kind
    return out


def check_casino(casino, cards):
    """The prize counters and the cards' token prices must agree."""
    listed = {item: tokens for item, tokens, _ in casino}
    if len(listed) != len(casino) or len(casino) != 12:
        raise BuildError(f'expected 12 distinct casino prizes, found {len(casino)}')
    on_cards = {}
    for item, fields in cards.items():
        for text in fields.get('Buy price', []):
            m = TOKEN_PRICE.search(text)
            if m:
                on_cards[item] = int(m.group(1).replace(',', ''))
    if on_cards != listed:
        raise BuildError(f'casino token prices differ between the card pages and the prize counters: '
                         f'{sorted(set(on_cards.items()) ^ set(listed.items()))}')


def check_medals(prizes, cards):
    """Each prize in the medal list must show on its card as the same medal count."""
    for item, medals in prizes.items():
        texts = ' '.join(cards.get(item, {}).get('Where found', []))
        counts = [int(n) for n in MEDAL.findall(texts)]
        if counts != [medals]:
            raise BuildError(f'{item}: medal list says {medals}, card says {counts}')


def main():
    items = json.loads((OUT / 'items.json').read_text(encoding='utf-8'))
    recipes = json.loads((OUT / 'recipes.json').read_text(encoding='utf-8'))
    locations = json.loads((OUT / 'locations.json').read_text(encoding='utf-8'))
    resolve = Resolver(items, json.loads((TOOLS / 'aliases.json').read_text(encoding='utf-8')))

    cards = parse_cards(resolve)
    monsters = monster_names()

    def resolve_monster(name):
        name = MONSTER_ALIASES.get(name, name)
        if name not in monsters:
            raise BuildError(f'drop by unknown monster {name!r}; add it to MONSTER_ALIASES')
        return name

    casino = casino_rows(resolve)
    check_casino(casino, cards)
    check_medals(medal_prizes(resolve), cards)
    sources = build(items, recipes, locations, cards, casino, resolve_monster)
    if USED_BOSSES != set(BOSS_DROPS):
        raise BuildError(f'BOSS_DROPS rules that matched no ingredient drop: {sorted(set(BOSS_DROPS) - USED_BOSSES)}')
    if USED_LOCKED != set(LOCKED_CHESTS):
        raise BuildError(f'LOCKED_CHESTS rules that matched no source: {sorted(set(LOCKED_CHESTS) - USED_LOCKED)}')
    if USED_SHORT != set(SHORT_PLACES):
        raise BuildError(f'SHORT_PLACES rules that matched no source: {sorted(set(SHORT_PLACES) - USED_SHORT)}')

    (OUT / 'sources.json').write_text(json.dumps(sources, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    kinds = Counter(s['kind'] for s in sources)
    print(f'wrote {len(sources)} sources for {len({s["item"] for s in sources})} items: '
          + ', '.join(f'{k} {v}' for k, v in sorted(kinds.items())))
    unplaced = sorted({s['where'] for s in sources if s['kind'] in ('found', 'gift') and 'location' not in s})
    print(f'found or gift sources without a location: {unplaced}')


if __name__ == '__main__':
    try:
        main()
    except BuildError as e:
        sys.exit(f'build error: {e}')
