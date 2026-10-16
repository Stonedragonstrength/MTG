import { expect, test } from 'vitest';
import { abilitiesGiven, abilitiesOf, abilityBlocked, costWords, levelChange, levelNow, levelsOf, loyaltyChange, loyaltyWords } from './abilities';

const card = (name: string, oracleText: string) => ({ name, oracleText });

test('Monstrosity: its cost, how many counters, and that it happens once', () => {
  const [m] = abilitiesOf(card('Ember Swallower', '{5}{R}{R}: Monstrosity 3. (If this creature isn’t monstrous, put three +1/+1 counters on it and it becomes monstrous.)\nWhen this creature becomes monstrous, each player sacrifices three lands.'));
  expect(m).toMatchObject({ label: 'Monstrosity 3', cost: { generic: 5, pips: [['R'], ['R']] }, tap: false, effect: { kind: 'counters', n: 3, once: 'monstrous' } });
  const [x] = abilitiesOf(card('Polukranos, World Eater', '{X}{X}{G}: Monstrosity X.'));
  expect(x).toMatchObject({ label: 'Monstrosity X', cost: { generic: 0, pips: [['G']], x: 2 }, effect: { n: 'X' } });
});

test('Adapt, Outlast, and a plain "put a +1/+1 counter on this creature"', () => {
  expect(abilitiesOf(card('Incubation Druid', '{T}: Add one mana of any type that a land you control could produce.\n{3}{G}{G}: Adapt 3.'))).toMatchObject([
    { label: 'Adapt 3', effect: { kind: 'counters', n: 3, ifNone: true } },
  ]);
  expect(abilitiesOf(card('Abzan Battle Priest', 'Outlast {W} ({W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.)\nEach creature you control with a +1/+1 counter on it has lifelink.'))).toMatchObject([
    { label: 'Outlast', tap: true, cost: { generic: 0, pips: [['W']] }, effect: { kind: 'counters', n: 1 } },
  ]);
  expect(abilitiesOf(card('Fire Sages', '{1}{R}{R}: Put a +1/+1 counter on this creature.'))).toMatchObject([{ label: '+1/+1 counter', tap: false }]);
});

test('firebreathing and the like: until end of turn, as many times as it is paid for', () => {
  expect(abilitiesOf(card('Whispering Shade', 'Swampwalk\n{B}: This creature gets +1/+1 until end of turn.'))).toMatchObject([
    { label: '+1/+1 until end of turn', effect: { kind: 'boost', power: 1, toughness: 1, keywords: [] } },
  ]);
  expect(abilitiesOf(card('Spitfire Handler', '{R}: This creature gets +1/+0 and gains first strike until end of turn.'))[0].effect).toEqual({
    kind: 'boost',
    power: 1,
    toughness: 0,
    keywords: ['first strike'],
  });
  expect(abilitiesOf(card('Stromgald Crusader', 'Protection from white\n{B}: This creature gains flying until end of turn.\n{B}{B}: This creature gets +1/+0 until end of turn.'))).toMatchObject([
    { label: 'flying until end of turn' },
    { label: '+1/+0 until end of turn' },
  ]);
  // "Activate only once each turn" is taken on trust.
  expect(abilitiesOf(card('Mobile Fort', '{3}: This creature gets +3/-1 until end of turn. Activate only once each turn.'))).toMatchObject([{ effect: { power: 3, toughness: -1 } }]);
});

test('a cost that is not only mana and {T}, or an effect it does not know, is left to the players', () => {
  expect(abilitiesOf(card('Atog', 'Sacrifice an artifact: This creature gets +2/+2 until end of turn.'))).toEqual([]);
  expect(abilitiesOf(card('Cruel Sadist', '{B}, {T}, Pay 1 life: Put a +1/+1 counter on this creature.'))).toEqual([]);
  expect(abilitiesOf(card('Prodigal Sorcerer', '{T}: This creature deals 1 damage to any target.'))).toEqual([]);
  expect(abilitiesOf(null)).toEqual([]);
});

test('what would do nothing says why', () => {
  const [m] = abilitiesOf(card('Ember Swallower', '{5}{R}{R}: Monstrosity 3.'));
  expect(abilityBlocked(m, {})).toBeNull();
  expect(abilityBlocked(m, { counters: { monstrous: 1 } })).toBe('It is monstrous already.');
  const [adapt] = abilitiesOf(card('Druid', '{3}{G}{G}: Adapt 3.'));
  expect(abilityBlocked(adapt, { counters: { p1p1: 1 } })).toBe('It has +1/+1 counters already.');
  const [outlast] = abilitiesOf(card('Priest', 'Outlast {W}'));
  expect(abilityBlocked(outlast, { tapped: true })).toBe('It is tapped.');
});

// ---- Level up ----

const STUDENT = card(
  'Student of Warfare',
  'Level up {W} ({W}: Put a level counter on this. Level up only as a sorcery.)\nLEVEL 2-6\n3/3\nFirst strike\nLEVEL 7+\n4/4\nDouble strike',
);
const KARGAN = card(
  'Kargan Dragonlord',
  'Level up {R} ({R}: Put a level counter on this. Level up only as a sorcery.)\nLEVEL 4-7\n4/4\nFlying\nLEVEL 8+\n8/8\nFlying, trample\n{R}: This creature gets +1/+0 until end of turn.',
);

test('Level up is a button of its own; the level sections are read with their sizes', () => {
  expect(abilitiesOf(STUDENT)).toMatchObject([{ label: 'Level up', cost: { generic: 0, pips: [['W']] }, effect: { kind: 'level' } }]);
  expect(levelsOf(STUDENT).map((b) => [b.min, b.max, b.power, b.toughness, b.text])).toEqual([
    [2, 6, 3, 3, 'First strike'],
    [7, Infinity, 4, 4, 'Double strike'],
  ]);
  expect(levelNow(STUDENT, 1)).toBeNull();
  expect(levelNow(STUDENT, 2)?.power).toBe(3);
  expect(levelNow(STUDENT, 9)?.power).toBe(4);
  expect(levelChange({ ...STUDENT, power: '1', toughness: '1' }, 7)).toEqual({ power: 3, toughness: 3 });
  expect(levelChange({ ...STUDENT, power: '1', toughness: '1' }, 0)).toEqual({ power: 0, toughness: 0 });
});

test('an ability under a level is there only once the creature has reached it', () => {
  expect(abilitiesOf(KARGAN, 0).map((a) => a.label)).toEqual(['Level up']);
  expect(abilitiesOf(KARGAN, 8).map((a) => a.label)).toEqual(['Level up', '+1/+0 until end of turn']);
});

// ---- Discover, and costs beyond mana and {T} ----

const NURSERY = {
  name: 'Hidden Nursery',
  typeLine: 'Land — Cave',
  oracleText:
    'This land enters tapped.\n{T}: Add {G}.\n{4}{G}, {T}, Sacrifice this land: Discover 4. Activate only as a sorcery. (Exile cards from the top of your library until you exile a nonland card with mana value 4 or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)',
};
const SENSOR = {
  name: 'Long-Range Sensor',
  typeLine: 'Artifact',
  oracleText:
    'Whenever you attack a player, put a charge counter on this artifact.\n{1}, Remove two charge counters from this artifact: Discover 4. Activate only as a sorcery.',
};
const TREASURE = {
  name: 'Buried Treasure',
  typeLine: 'Artifact — Treasure',
  oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.\n{5}, Exile this card from your graveyard: Discover 5. Activate only as a sorcery.',
};
const QUINTORIUS = {
  name: 'Quintorius Kand',
  typeLine: 'Legendary Planeswalker — Quintorius',
  oracleText:
    'Whenever you cast a spell from exile, Quintorius Kand deals 2 damage to each opponent and you gain 2 life.\n+1: Create a 3/2 red and white Spirit creature token.\n−3: Discover 4.\n−6: Exile any number of target cards from your graveyard. Add {R} for each card exiled this way. You may play those cards this turn.',
};

test('a Hidden cave: Discover 4 for its mana, a tap, and the land itself', () => {
  const [d] = abilitiesOf(NURSERY);
  expect(abilitiesOf(NURSERY)).toHaveLength(1); // "{T}: Add {G}" is mana, not a row
  expect(d).toMatchObject({ label: 'Discover 4', cost: { generic: 4, pips: [['G']] }, tap: true, sacrifice: true, effect: { kind: 'discover', n: 4 } });
  expect(costWords(d)).toEqual(['sacrifice it']);
});

test('Long-Range Sensor pays with its charge counters, and says so when it has too few', () => {
  const [d] = abilitiesOf(SENSOR);
  expect(d).toMatchObject({ label: 'Discover 4', cost: { generic: 1 }, tap: false, remove: { kind: 'charge', n: 2 } });
  expect(costWords(d)).toEqual(['remove two charge counters']);
  expect(abilityBlocked(d, { counters: { charge: 1 } })).toBe('Not enough charge counters.');
  expect(abilityBlocked(d, { counters: { charge: 2 } })).toBeNull();
});

test('Buried Treasure is used from the graveyard, and exiles itself to pay', () => {
  expect(abilitiesOf(TREASURE)).toMatchObject([{ label: 'Discover 5', cost: { generic: 5 }, graveyard: true, effect: { kind: 'discover', n: 5 } }]);
  expect(costWords(abilitiesOf(TREASURE)[0])).toEqual(['exile it from your graveyard']);
});

test('a planeswalker’s loyalty abilities are all rows: −3 Discover 4, and the others say what they do', () => {
  const [plus, d, minus] = abilitiesOf(QUINTORIUS);
  expect(abilitiesOf(QUINTORIUS)).toHaveLength(3);
  expect(d).toMatchObject({ label: 'Discover 4', loyalty: -3, tap: false, cost: { generic: 0, pips: [] } });
  expect(plus).toMatchObject({
    label: 'Create a 3/2 red and white Spirit creature token.',
    loyalty: 1,
    effect: { kind: 'loyalty', text: 'Create a 3/2 red and white Spirit creature token.' },
  });
  expect(minus).toMatchObject({ loyalty: -6, effect: { kind: 'loyalty' } });
  expect(loyaltyWords(-3)).toBe('−3');
  expect(loyaltyWords(1)).toBe('+1');
  expect(loyaltyWords('-X')).toBe('−X');
  // Loyalty counts only where it is kept as counters.
  expect(abilityBlocked(d, { counters: { loyalty: 2 } })).toBe('Not enough loyalty.');
  expect(abilityBlocked(d, { counters: { loyalty: 3 } })).toBeNull();
  expect(abilityBlocked(d, {})).toBeNull();
  // A creature's "+1:" is Spark (Alchemy), not loyalty.
  expect(abilitiesOf({ name: 'Blood Poet', typeLine: 'Creature — Vampire Cleric', oracleText: '+1: Blood Poet gains lifelink until end of turn.' })).toEqual([]);
});

test('Ellie and Alan: the creature card exiled is X', () => {
  expect(
    abilitiesOf({
      name: 'Ellie and Alan, Paleontologists',
      typeLine: 'Legendary Creature — Human Scientist',
      oracleText: '{T}, Exile a creature card from your graveyard: Discover X, where X is the mana value of the exiled card. Activate only as a sorcery.',
    }),
  ).toMatchObject([{ label: 'Discover X', tap: true, exiles: 'creature', effect: { kind: 'discover', n: 'exiled' } }]);
});

test('counters as a cost grow a creature too; "your choice of" is left to the players', () => {
  expect(abilitiesOf(card('Spike Soldier', 'Remove a +1/+1 counter from Spike Soldier: Spike Soldier gets +2/+2 until end of turn.'))).toMatchObject([
    { label: '+2/+2 until end of turn', remove: { kind: 'p1p1', n: 1 } },
  ]);
  expect(abilitiesOf(card('Lunar Avenger', 'Remove a +1/+1 counter from this creature: This creature gains your choice of flying, first strike, or haste until end of turn.'))).toEqual([]);
  // Sacrificed or exiled, it is not there to grow.
  expect(abilitiesOf(card('Odd Thing', 'Sacrifice this creature: This creature gets +2/+2 until end of turn.'))).toEqual([]);
});

test('what an Equipment or Aura gives in quotes is read as the creature’s own', () => {
  const whip = {
    name: "Swashbuckler's Whip",
    oracleText:
      'Equipped creature has reach, "{2}, {T}: Tap target artifact or creature," and "{8}, {T}: Discover 10." (Exile cards from the top of your library until you exile a nonland card with mana value 10 or less.)\nEquip {1}',
  };
  expect(abilitiesGiven(whip)).toMatchObject([{ key: '0.1:discover', label: 'Discover 10', cost: { generic: 8 }, tap: true }]);
  expect(abilitiesGiven(card('Midnight Covenant', 'Enchant creature\nEnchanted creature has "{B}: This creature gets +1/+1 until end of turn."'))).toMatchObject([
    { label: '+1/+1 until end of turn', effect: { kind: 'boost', power: 1, toughness: 1 } },
  ]);
  expect(abilitiesGiven(card('Bonesplitter', 'Equipped creature gets +2/+0.\nEquip {1}'))).toEqual([]);
});

test('−X: X loyalty comes off, as many as its player names', () => {
  const nalaar = {
    name: 'Chandra Nalaar',
    typeLine: 'Legendary Planeswalker — Chandra',
    oracleText: '+1: Chandra Nalaar deals 1 damage to target player or planeswalker.\n−X: Chandra Nalaar deals X damage to target creature.\n−8: Chandra Nalaar deals 10 damage to target player or planeswalker and each creature that player or that planeswalker’s controller controls.',
  };
  const [, x] = abilitiesOf(nalaar);
  expect(x).toMatchObject({ loyalty: '-X', label: 'Chandra Nalaar deals X damage to target creature.', effect: { kind: 'loyalty', text: '~ deals X damage to target creature.' } });
  expect(loyaltyChange(x, 3)).toBe(-3);
  expect(abilityBlocked(x, { counters: { loyalty: 2 } }, 3)).toBe('Not enough loyalty.');
  expect(abilityBlocked(x, { counters: { loyalty: 2 } }, 2)).toBeNull();
});

test('a legendary planeswalker speaks of itself by its first name', () => {
  const [plus] = abilitiesOf({
    name: 'Chandra, Torch of Defiance',
    typeLine: 'Legendary Planeswalker — Chandra',
    oracleText: "+1: Exile the top card of your library. You may cast that card. If you don't, Chandra deals 2 damage to each opponent.",
  });
  expect(plus.effect).toEqual({ kind: 'loyalty', text: "Exile the top card of your library. You may cast that card. If you don't, ~ deals 2 damage to each opponent." });
  expect(plus.label).toBe("Exile the top card of your library. You may cast that card. If you don't, Chandra deals 2 damage to each opponent.");
});

test('storing mana: "{1}, {T}: Put a storage counter on this land", a Mana Battery’s charge counter', () => {
  expect(abilitiesOf(card('Dreadship Reef', '{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.\n{1}, Remove X storage counters from this land: Add X mana in any combination of {U} and/or {B}.'))).toMatchObject([
    { label: 'Storage counter', tap: true, cost: { generic: 1, pips: [] }, effect: { kind: 'counters', n: 1, counter: 'storage' } },
  ]);
  expect(abilitiesOf(card('Fountain of Cho', '{T}: Put a storage counter on this land.'))).toMatchObject([{ label: 'Storage counter', tap: true, cost: { generic: 0 } }]);
  expect(abilitiesOf(card('Black Mana Battery', '{2}, {T}: Put a charge counter on this artifact.'))).toMatchObject([
    { label: 'Charge counter', tap: true, cost: { generic: 2 }, effect: { counter: 'charge' } },
  ]);
  // A note to keep beside it is the players' own.
  expect(abilitiesOf(card('Jeweled Amulet', '{1}, {T}: Put a charge counter on this artifact. Note the type of mana spent to pay this activation cost. Activate only if there are no charge counters on this artifact.'))).toEqual([]);
});
