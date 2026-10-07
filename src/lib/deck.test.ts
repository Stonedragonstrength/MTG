import { describe, expect, test } from 'vitest';
import type { CardRecord } from './types';
import {
  addCard,
  changeCardCount,
  colorBreakdown,
  compositionExtras,
  createDeck,
  deckSize,
  deckStats,
  groupCards,
  importLines,
  manaCurve,
  manaValue,
  offColorCards,
  setCommander,
  setPartner,
  shortType,
  starRatings,
} from './deck';

describe('shortType', () => {
  test('shows the subtype after the dash', () => {
    expect(shortType('Creature — Elf Druid')).toBe('Elf Druid');
    expect(shortType('Legendary Creature — Elemental')).toBe('Elemental');
    expect(shortType('Artifact — Equipment')).toBe('Equipment');
  });

  test('cards without a dash add nothing — the group header already says it', () => {
    expect(shortType('Instant')).toBe('');
    expect(shortType('Legendary Artifact')).toBe('');
  });

  test('double-faced cards read their front face', () => {
    expect(shortType('Creature — Human Wizard // Creature — Human Insect')).toBe('Human Wizard');
  });
});

function card(name: string, typeLine: string, manaCost = '{1}'): CardRecord {
  return {
    id: `id-${name}`,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost,
    power: null,
    toughness: null,
    colors: [],
    colorIdentity: ['G'],
    imageNormal: `https://img.example/${name}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

describe('deck building', () => {
  test('basics stack when added twice', () => {
    let deck = createDeck('Stompy');
    deck = addCard(deck, card('Forest', 'Basic Land — Forest'));
    deck = addCard(deck, card('Forest', 'Basic Land — Forest'));
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].count).toBe(2);
  });

  test('commander is singleton: a non-basic added twice stays at one', () => {
    let deck = createDeck('Stompy');
    const ring = card('Sol Ring', 'Artifact');
    deck = addCard(deck, ring);
    const again = addCard(deck, ring);
    expect(again).toBe(deck); // unchanged reference = recognizable no-op
    expect(again.cards[0].count).toBe(1);
  });

  test('count changes clamp at zero and drop the card', () => {
    let deck = createDeck('Stompy');
    deck = addCard(deck, card('Llanowar Elves', 'Creature — Elf Druid'));
    deck = changeCardCount(deck, 'id-Llanowar Elves', -1);
    expect(deck.cards).toHaveLength(0);
  });

  test('deck size counts copies plus the commander', () => {
    let deck = createDeck('Stompy');
    deck = setCommander(deck, card('Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'));
    deck = addCard(deck, card('Forest', 'Basic Land — Forest'));
    deck = changeCardCount(deck, 'id-Forest', 4);
    expect(deckSize(deck)).toBe(6);
  });

  test('the commander sets the deck colors from identity', () => {
    let deck = createDeck('Stompy');
    deck = setCommander(deck, card('Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'));
    expect(deck.colors).toEqual(['G']);
    expect(deck.commander?.name).toBe('Ashaya, Soul of the Wild');
  });
});

describe('partner commander', () => {
  const thrasios = { ...card('Thrasios', 'Legendary Creature — Merfolk'), colorIdentity: ['G', 'U'] };
  const tymna = { ...card('Tymna', 'Legendary Creature — Human'), colorIdentity: ['W', 'B'] };

  test('a partner joins the command zone: the size counts it and the colors combine', () => {
    let deck = setCommander(createDeck('Pair'), thrasios);
    deck = setPartner(deck, tymna);
    expect(deck.partner?.name).toBe('Tymna');
    expect(deckSize(deck)).toBe(2);
    expect([...deck.colors].sort()).toEqual(['B', 'G', 'U', 'W']);
  });

  test('removing the partner falls back to the commander alone', () => {
    let deck = setPartner(setCommander(createDeck('Pair'), thrasios), tymna);
    deck = setPartner(deck, null);
    expect(deck.partner).toBeNull();
    expect(deckSize(deck)).toBe(1);
    expect([...deck.colors].sort()).toEqual(['G', 'U']);
  });

  test('a new commander starts alone — the old pairing no longer applies', () => {
    let deck = setPartner(setCommander(createDeck('Pair'), thrasios), tymna);
    deck = setCommander(deck, card('Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'));
    expect(deck.partner).toBeNull();
    expect(deck.colors).toEqual(['G']);
  });

  test('off-color checks use the combined identity', () => {
    let deck = setPartner(setCommander(createDeck('Pair'), thrasios), tymna);
    deck = addCard(deck, { ...card('Swords to Plowshares', 'Instant'), colorIdentity: ['W'] });
    deck = addCard(deck, { ...card('Lightning Bolt', 'Instant'), colorIdentity: ['R'] });
    expect(offColorCards(deck).map((c) => c.name)).toEqual(['Lightning Bolt']);
  });

  test('a partner needs a commander to stand beside', () => {
    const deck = createDeck('Empty');
    expect(setPartner(deck, tymna)).toBe(deck);
  });
});

describe('importLines (a pasted decklist)', () => {
  const PARTNER = 'Partner (You can have two commanders if both have partner.)';
  const legend = (
    name: string,
    identity: string[],
    oracleText: string,
    typeLine = 'Legendary Creature — Human',
  ): CardRecord => ({ ...card(name, typeLine), oracleText, colorIdentity: identity });
  const thrasios = legend('Thrasios, Triton Hero', ['G', 'U'], PARTNER);
  const tymna = legend('Tymna the Weaver', ['W', 'B'], PARTNER);
  const wilson = legend(
    'Wilson, Refined Grizzly',
    ['G'],
    'Choose a Background (You can have a Background as a second commander.)',
  );
  const raised = legend(
    'Raised by Giants',
    ['G'],
    'Commander creatures you own have base power and toughness 10/10.',
    'Legendary Enchantment — Background',
  );
  const lathril = legend('Lathril, Blade of the Elves', ['B', 'G'], 'Menace');
  const ring: CardRecord = { ...card('Sol Ring', 'Artifact'), colorIdentity: [] };
  const swords: CardRecord = { ...card('Swords to Plowshares', 'Instant'), colorIdentity: ['W'] };
  const cmdr = (c: CardRecord) => ({ card: c, count: 1, commander: true });
  const line = (c: CardRecord, count = 1) => ({ card: c, count, commander: false });

  test('two flagged commanders that may pair become the pair', () => {
    const { deck, added } = importLines(createDeck('Pair'), [cmdr(thrasios), cmdr(tymna), line(ring), line(swords)]);
    expect(deck.commander?.name).toBe('Thrasios, Triton Hero');
    expect(deck.partner?.name).toBe('Tymna the Weaver');
    expect([...deck.colors].sort()).toEqual(['B', 'G', 'U', 'W']);
    expect(offColorCards(deck)).toEqual([]); // Swords is in the pair's colors
    expect(deckSize(deck)).toBe(4);
    expect(added).toBe(4);
  });

  test('a Background listed before its commander still ends up second', () => {
    const { deck } = importLines(createDeck('Bg'), [cmdr(raised), cmdr(wilson)]);
    expect(deck.commander?.name).toBe('Wilson, Refined Grizzly');
    expect(deck.partner?.name).toBe('Raised by Giants');
  });

  test('a second flagged card that cannot pair is kept in the deck, not swapped in', () => {
    const { deck, added } = importLines(createDeck('Odd'), [cmdr(lathril), cmdr(thrasios)]);
    expect(deck.commander?.name).toBe('Lathril, Blade of the Elves');
    expect(deck.partner ?? null).toBeNull();
    expect(deck.cards.map((c) => c.name)).toEqual(['Thrasios, Triton Hero']);
    expect(added).toBe(2);
  });

  test('pasting the rest of a list keeps the pair the deck already has', () => {
    const pair = setPartner(setCommander(createDeck('Pair'), thrasios), tymna);
    const { deck, added } = importLines(pair, [cmdr(thrasios), line(ring), line(swords)]);
    expect(deck.commander?.name).toBe('Thrasios, Triton Hero');
    expect(deck.partner?.name).toBe('Tymna the Weaver');
    expect([...deck.colors].sort()).toEqual(['B', 'G', 'U', 'W']);
    expect(added).toBe(2); // the commander was already there
  });

  test('pasting the same pair again changes nothing', () => {
    const pair = setPartner(setCommander(createDeck('Pair'), thrasios), tymna);
    const { deck, added } = importLines(pair, [cmdr(tymna), cmdr(thrasios)]);
    expect(deck).toBe(pair);
    expect(added).toBe(0);
  });

  test('a different flagged commander takes over and starts alone', () => {
    const pair = setPartner(setCommander(createDeck('Pair'), thrasios), tymna);
    const { deck, added } = importLines(pair, [cmdr(lathril)]);
    expect(deck.commander?.name).toBe('Lathril, Blade of the Elves');
    expect(deck.partner ?? null).toBeNull();
    expect(deck.colors).toEqual(['B', 'G']);
    expect(added).toBe(1);
  });

  test('counts what the deck actually gained: a repeated line adds once, basics stack', () => {
    const forest = card('Forest', 'Basic Land — Forest');
    const { deck, added } = importLines(createDeck('Dupes'), [line(ring), line(ring), line(forest, 3)]);
    expect(deck.cards.find((c) => c.name === 'Sol Ring')?.count).toBe(1);
    expect(deck.cards.find((c) => c.name === 'Forest')?.count).toBe(3);
    expect(added).toBe(4);
  });
});

describe('groupCards', () => {
  test('buckets by type with creatures first and lands last', () => {
    let deck = createDeck('Mixed');
    deck = addCard(deck, card('Forest', 'Basic Land — Forest'));
    deck = addCard(deck, card('Llanowar Elves', 'Creature — Elf Druid'));
    deck = addCard(deck, card('Cultivate', 'Sorcery'));
    const groups = groupCards(deck.cards);
    expect(groups.map((g) => g.label)).toEqual(['Creatures', 'Sorceries', 'Lands']);
  });

  test('artifact creatures are creatures; artifact lands are lands', () => {
    const groups = groupCards([
      addCard(createDeck('x'), card('Ornithopter', 'Artifact Creature — Thopter')).cards[0],
      addCard(createDeck('x'), card('Darksteel Citadel', 'Artifact Land')).cards[0],
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Creatures', 'Lands']);
  });
});

describe('offColorCards', () => {
  test('flags cards whose identity leaves the commander colors', () => {
    let deck = setCommander(createDeck('x'), card('Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'));
    deck = addCard(deck, { ...card('Lightning Bolt', 'Instant'), colorIdentity: ['R'] });
    deck = addCard(deck, { ...card('Sol Ring', 'Artifact'), colorIdentity: [] });
    deck = addCard(deck, card('Llanowar Elves', 'Creature — Elf Druid'));
    expect(offColorCards(deck).map((c) => c.name)).toEqual(['Lightning Bolt']);
  });

  test('stays quiet without a commander or without identity data', () => {
    const noCommander = addCard(createDeck('x'), { ...card('Bolt', 'Instant'), colorIdentity: ['R'] });
    expect(offColorCards(noCommander)).toEqual([]);
    let deck = setCommander(createDeck('x'), card('Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'));
    deck = addCard(deck, { ...card('Mystery', 'Instant'), colorIdentity: undefined });
    expect(offColorCards(deck)).toEqual([]);
  });
});

describe('deckStats', () => {
  test('counts lands, ramp, draw, and removal from rules text', () => {
    const entries = [
      { typeLine: 'Basic Land — Forest', oracleText: '({T}: Add {G}.)', count: 30 },
      { typeLine: 'Creature — Elf Druid', oracleText: '{T}: Add {G}.', count: 2 },
      { typeLine: 'Sorcery', oracleText: 'Search your library for up to two basic land cards…', count: 1 },
      { typeLine: 'Enchantment', oracleText: 'At the beginning of your upkeep, draw a card.', count: 1 },
      { typeLine: 'Instant', oracleText: 'Destroy target artifact.', count: 3 },
      { typeLine: 'Creature — Beast', oracleText: 'Trample', count: 4 },
    ];
    const stats = deckStats(entries);
    expect(stats.lands).toBe(30);
    expect(stats.ramp).toBe(3); // dorks + land search, but not the Forests
    expect(stats.draw).toBe(1);
    expect(stats.removal).toBe(3);
  });
});

function record(name: string, typeLine: string, oracleText: string): CardRecord {
  return { ...card(name, typeLine), oracleText };
}

describe('colorBreakdown', () => {
  test('counts copies toward every color in their identity', () => {
    const counts = colorBreakdown([
      { count: 4, identity: ['G'] },
      { count: 2, identity: ['B', 'G'] },
      { count: 3, identity: [] },
      { count: 5, identity: undefined },
    ]);
    expect(counts.G).toBe(6);
    expect(counts.B).toBe(2);
    expect(counts.W).toBe(0);
    expect(counts.colorless).toBe(3);
    expect(counts.unknown).toBe(5);
  });
});

describe('compositionExtras', () => {
  test('surfaces equipment and auras out of their buckets', () => {
    const extras = compositionExtras([
      addCard(createDeck('x'), card('Skullclamp', 'Artifact — Equipment')).cards[0],
      addCard(createDeck('x'), card('Sol Ring', 'Artifact')).cards[0],
      { ...addCard(createDeck('x'), card('Rancor', 'Enchantment — Aura')).cards[0], count: 2 },
    ]);
    expect(extras.equipment).toBe(1);
    expect(extras.auras).toBe(2);
  });
});

describe('starRatings', () => {
  test('rates each card 0-5 against the commander, scaled to the best fit', () => {
    const commander = record(
      'Elf Queen',
      'Legendary Creature — Elf Noble',
      'Whenever an Elf you control attacks, create a 1/1 Elf token.',
    );
    const elves = record('Llanowar Elves', 'Creature — Elf Druid', '');
    const payoff = record(
      'Elvish Promenade',
      'Tribal Sorcery — Elf',
      'Create a 1/1 Elf token for each Elf you control.',
    );
    const forest = record('Forest', 'Basic Land — Forest', '');
    const stars = starRatings(commander, [
      { cardId: elves.id, record: elves },
      { cardId: payoff.id, record: payoff },
      { cardId: forest.id, record: forest },
    ]);
    expect(stars[payoff.id]).toBe(5); // tribe + tokens: the deck's best fit
    expect(stars[elves.id]).toBeGreaterThanOrEqual(1);
    expect(stars[elves.id]).toBeLessThan(5);
    expect(stars[forest.id]).toBe(0);
  });

  test('no commander or no themes rates nothing', () => {
    expect(starRatings(null, [])).toEqual({});
  });
});

describe('mana math', () => {
  test('manaValue sums generic and colored symbols', () => {
    expect(manaValue('{2}{G}{G}')).toBe(4);
    expect(manaValue('{G/W}{G/W}')).toBe(2);
    expect(manaValue('{X}{R}')).toBe(1);
    expect(manaValue('')).toBe(0);
  });

  test('manaCurve buckets nonland cards by mana value, weighted by count', () => {
    let deck = createDeck('Curve');
    deck = addCard(deck, card('Llanowar Elves', 'Creature — Elf Druid', '{G}'));
    deck = changeCardCount(deck, 'id-Llanowar Elves', 1); // 2 copies via stepper
    deck = addCard(deck, card('Craterhoof Behemoth', 'Creature — Beast', '{5}{G}{G}{G}'));
    deck = addCard(deck, card('Forest', 'Basic Land — Forest', ''));
    const curve = manaCurve(deck.cards);
    expect(curve[1]).toBe(2);
    expect(curve[7]).toBe(1); // 8-drop lands in the 7+ bucket
    expect(curve.reduce((a, b) => a + b, 0)).toBe(3);
  });
});
