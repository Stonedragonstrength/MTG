import { describe, expect, test } from 'vitest';
import type { CardRecords } from './combatEngine';
import {
  castPrice,
  castSources,
  castWays,
  changedCost,
  costTable,
  cycleWays,
  graveKey,
  helpsOf,
  overloaded,
  wayOf,
} from './costs';
import { counteredTo } from './counterspells';
import { createGame } from './game';
import { affordable, planPayment, type PayCost } from './pay';
import { effectOf, planEffect, spellPrompts } from './spellEffects';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState, StackSpell } from './types';

const rec = (
  id: string,
  name: string,
  typeLine: string,
  manaCost: string,
  oracleText: string,
  more: Partial<CardRecord> = {},
): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText,
  manaCost,
  power: null,
  toughness: null,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: typeLine.startsWith('Basic'),
  ...more,
});

const RECORDS: CardRecords = {
  island: rec('island', 'Island', 'Basic Land — Island', '', '({T}: Add {U}.)'),
  mountain: rec('mountain', 'Mountain', 'Basic Land — Mountain', '', '({T}: Add {R}.)'),
  forest: rec('forest', 'Forest', 'Basic Land — Forest', '', '({T}: Add {G}.)'),
  ruby: rec('ruby', 'Ruby Medallion', 'Artifact', '{2}', 'Red spells you cast cost {1} less to cast.'),
  thalia: rec('thalia', 'Thalia, Guardian of Thraben', 'Legendary Creature — Human Soldier', '{1}{W}', 'First strike\nNoncreature spells cost {1} more to cast.', { power: '2', toughness: '1', colors: ['W'] }),
  sphere: rec('sphere', 'Sphere of Resistance', 'Artifact', '{2}', 'Spells cost {1} more to cast.'),
  arbiter: rec(
    'arbiter',
    'Grand Arbiter Augustin IV',
    'Legendary Creature — Human Advisor',
    '{2}{W}{U}',
    'White spells you cast cost {1} less to cast.\nBlue spells you cast cost {1} less to cast.\nSpells your opponents cast cost {1} more to cast.',
    { power: '2', toughness: '3' },
  ),
  horn: rec(
    'horn',
    "Herald's Horn",
    'Artifact',
    '{3}',
    "As Herald's Horn enters, choose a creature type.\nCreature spells you cast of the chosen type cost {1} less to cast.\nAt the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.",
  ),
  electromancer: rec('electromancer', 'Goblin Electromancer', 'Creature — Goblin Wizard', '{R}{R}', 'Instant and sorcery spells you cast cost {1} less to cast.', { power: '2', toughness: '2', colors: ['R'] }),
  giant: rec('giant', 'Hill Giant', 'Creature — Giant', '{3}{R}', '', { power: '3', toughness: '3', colors: ['R'] }),
  bears: rec('bears', 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '', { power: '2', toughness: '2', colors: ['G'] }),
  elves: rec('elves', 'Llanowar Elves', 'Creature — Elf Druid', '{G}', '{T}: Add {G}.', { power: '1', toughness: '1', colors: ['G'] }),
  divination: rec('divination', 'Divination', 'Sorcery', '{2}{U}', 'Draw two cards.', { colors: ['U'] }),
  act: rec('act', 'Blasphemous Act', 'Sorcery', '{8}{R}', 'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.', { colors: ['R'] }),
  thoughtcast: rec('thoughtcast', 'Thoughtcast', 'Sorcery', '{4}{U}', 'Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nDraw two cards.', { colors: ['U'] }),
  ghalta: rec('ghalta', 'Ghalta, Primal Hunger', 'Legendary Creature — Dinosaur', '{10}{G}{G}', 'This spell costs {X} less to cast, where X is the total power of creatures you control.\nTrample', { power: '12', toughness: '12', colors: ['G'] }),
  guardianship: rec('guardianship', 'Fierce Guardianship', 'Instant', '{2}{U}', 'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.', { colors: ['U'] }),
  rift: rec(
    'rift',
    'Cyclonic Rift',
    'Instant',
    '{1}{U}',
    'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")',
    { colors: ['U'] },
  ),
  looting: rec('looting', 'Faithless Looting', 'Sorcery', '{R}', 'Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)', { colors: ['R'] }),
  cruise: rec('cruise', 'Treasure Cruise', 'Sorcery', '{7}{U}', 'Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\nDraw three cards.', { colors: ['U'] }),
  chord: rec(
    'chord',
    'Chord of Calling',
    'Instant',
    '{X}{G}{G}{G}',
    "Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\nSearch your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.",
    { colors: ['G'] },
  ),
  cannoneer: rec('cannoneer', 'Kappa Cannoneer', 'Artifact Creature — Turtle Warrior', '{5}{U}', 'Improvise (Your artifacts can help cast this spell. Each artifact you tap after you\'re done activating mana abilities pays for {1}.)\nWard {4}', { power: '4', toughness: '4', colors: ['U'] }),
  cave: rec('cave', 'Forgotten Cave', 'Land', '', 'Forgotten Cave enters tapped.\n{T}: Add {R}.\nCycling {R} ({R}, Discard this card: Draw a card.)'),
  abomination: rec('abomination', 'Twisted Abomination', 'Creature — Zombie Mutant', '{5}{B}', '{B}: Regenerate Twisted Abomination.\nSwampcycling {2} ({2}, Discard this card: Search your library for a Swamp card, reveal it, put it into your hand, then shuffle.)'),
  ash: rec('ash', 'Ash Barrens', 'Land', '', '{T}: Add {C}.\nBasic landcycling {1} ({1}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.)'),
  krosan: rec('krosan', 'Krosan Tusker', 'Creature — Boar Beast', '{5}{G}{G}', 'Cycling {2}{G} ({2}{G}, Discard this card: Draw a card.)\nWhen you cycle this card, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle.'),
  shark: rec('shark', 'Shark Typhoon', 'Enchantment', '{5}{U}', 'Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell\'s mana value.\nCycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, create an X/X blue Shark creature token with flying.'),
  solring: rec('solring', 'Sol Ring', 'Artifact', '{1}', '{T}: Add {C}{C}.'),
  cmd: rec('cmd', 'Atraxa', 'Legendary Creature — Phyrexian Angel Horror', '{G}{W}{U}{B}', 'Flying', { power: '4', toughness: '4' }),
};

function config(): GameConfig {
  return {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    mode: 'cards',
    profiles: ['Nathan', 'Sam'].map((name, i) => ({ id: `p${i}`, name, avatarUrl: null, commanderName: null })),
  };
}

/** Two seats; each side's battlefield by instance id → record id; Nathan's graveyard and board. */
function table(
  mine: Record<string, string>,
  theirs: Record<string, string> = {},
  more: { graveyard?: string[]; board?: BoardItem[]; cmd?: string[]; wear?: Record<string, Partial<CardInstance>> } = {},
): GameState {
  const base = createGame(config());
  const side = (cards: Record<string, string>): CardInstance[] =>
    Object.entries(cards).map(([iid, id]) => ({ iid, cardId: id, name: RECORDS[id]!.name, row: /Land/.test(RECORDS[id]!.typeLine) ? 'lands' : 'front', ...more.wear?.[iid] }));
  return {
    ...base,
    players: base.players.map((p, i) => ({
      ...p,
      board: i === 0 ? (more.board ?? []) : [],
      cards: {
        library: [],
        hand: [],
        battlefield: side(i === 0 ? mine : theirs),
        graveyard: i === 0 ? (more.graveyard ?? []).map((id, k) => ({ iid: `g${k}`, cardId: id, name: RECORDS[id]!.name })) : [],
        exile: [],
        command: [],
        mulligans: 0,
        deckName: 'Test',
        ...(i === 0 && more.cmd ? { cmd: Object.fromEntries(more.cmd.map((iid) => [iid, 0])) } : {}),
      },
    })),
  };
}

const price = (g: GameState, id: string, ask: Parameters<typeof castPrice>[1] = { from: 'hand' }) =>
  castPrice(RECORDS[id], ask, costTable(g, 0, RECORDS));
const plain = (c: PayCost) => ({ generic: c.generic, pips: c.pips });

describe('what the permanents on the table do to a spell’s price', () => {
  test('Ruby Medallion: my red spells cost one less — not somebody else’s Medallion, not a blue spell', () => {
    expect(plain(price(table({ r: 'ruby' }), 'giant').faces[0])).toEqual({ generic: 2, pips: [['R']] });
    expect(price(table({ r: 'ruby' }), 'giant').changes).toEqual([{ n: -1, why: 'Ruby Medallion' }]);
    expect(price(table({}, { r: 'ruby' }), 'giant').faces[0].generic).toBe(3);
    expect(price(table({ r: 'ruby' }), 'divination').faces[0].generic).toBe(2);
  });

  test('Thalia makes noncreature spells cost one more, whoever controls her; Sphere every spell', () => {
    expect(price(table({}, { t: 'thalia' }), 'divination').faces[0].generic).toBe(3);
    expect(price(table({ t: 'thalia' }), 'divination').faces[0].generic).toBe(3);
    expect(price(table({}, { t: 'thalia' }), 'giant').faces[0].generic).toBe(3);
    expect(price(table({ s: 'sphere' }), 'giant').faces[0].generic).toBe(4);
  });

  test('Grand Arbiter: his controller’s white and blue spells cost less, the others’ spells more', () => {
    expect(price(table({ a: 'arbiter' }), 'divination').faces[0].generic).toBe(1);
    expect(price(table({}, { a: 'arbiter' }), 'divination').faces[0].generic).toBe(3);
  });

  test('a reduction it cannot read ("of the chosen type") changes nothing; "instant and sorcery" reads', () => {
    expect(price(table({ h: 'horn' }), 'bears').faces[0].generic).toBe(1);
    expect(price(table({ e: 'electromancer' }), 'divination').faces[0].generic).toBe(1);
    expect(price(table({ e: 'electromancer' }), 'giant').faces[0].generic).toBe(3);
  });

  test('more is added before less comes off, and never below nothing', () => {
    expect(changedCost({ generic: 1, pips: [] }, [{ n: -3, why: 'a' }, { n: 1, why: 'b' }]).generic).toBe(0);
    expect(changedCost({ generic: 0, pips: [['R']] }, [{ n: -1, why: 'a' }])).toEqual({ generic: 0, pips: [['R']] });
  });
});

describe('a spell’s own words about its price', () => {
  test('Blasphemous Act costs one less for each creature on the battlefield, everyone’s', () => {
    const p = price(table({ b: 'bears', e: 'elves' }, { g: 'giant', t: 'thalia' }), 'act');
    // 9 − 4 creatures, + 1 for Thalia.
    expect(p.faces[0].generic).toBe(5);
    expect(p.changes).toContainEqual({ n: -4, why: '4 creatures' });
  });

  test('affinity for artifacts: one less for each artifact I control', () => {
    const p = price(table({ r: 'ruby', s: 'solring', c: 'cannoneer' }), 'thoughtcast');
    expect(plain(p.faces[0])).toEqual({ generic: 1, pips: [['U']] });
    expect(p.changes[0].why).toBe('affinity: 3 artifacts');
  });

  test('Ghalta costs the total power of my creatures less', () => {
    expect(price(table({ b: 'bears', g: 'giant' }), 'ghalta').faces[0].generic).toBe(5);
    expect(price(table({}, { g: 'giant' }), 'ghalta').faces[0].generic).toBe(10);
  });

  test('Fierce Guardianship is free with my commander out — and Thalia still adds hers', () => {
    expect(plain(price(table({}), 'guardianship').faces[0])).toEqual({ generic: 2, pips: [['U']] });
    const out = table({ c: 'cmd' }, {}, { cmd: ['c'] });
    expect(price(out, 'guardianship').free).toBe('you control a commander');
    expect(plain(price(out, 'guardianship').faces[0])).toEqual({ generic: 0, pips: [] });
    const taxed = table({ c: 'cmd' }, { t: 'thalia' }, { cmd: ['c'] });
    expect(plain(price(taxed, 'guardianship').faces[0])).toEqual({ generic: 1, pips: [] });
    // A commander at home is not one I control.
    expect(price(table({}, {}, { cmd: ['c'] }), 'guardianship').free).toBeNull();
  });
});

describe('other ways to cast: overload, flashback', () => {
  test('Cyclonic Rift overloaded costs {6}{U} and returns each nonland permanent', () => {
    expect(castWays(RECORDS.rift!)).toEqual([{ kind: 'overload', label: 'Overload {6}{U}', cost: { generic: 6, pips: [['U']] } }]);
    expect(plain(price(table({}), 'rift', { from: 'hand', way: 'overload' }).faces[0])).toEqual({ generic: 6, pips: [['U']] });
    const text = overloaded(RECORDS.rift!.oracleText);
    expect(text).toBe("Return each nonland permanent you don't control to its owner's hand.");
    expect(spellPrompts({ ...RECORDS.rift!, oracleText: text }).length).toBeGreaterThan(0);
  });

  test('the overloaded Rift returns every nonland permanent its caster does not control — and nothing of theirs', () => {
    const g = table({ b: 'bears', r: 'ruby', i: 'island' }, { g: 'giant', s: 'sphere', m: 'mountain' });
    const prompt = spellPrompts({ ...RECORDS.rift!, oracleText: overloaded(RECORDS.rift!.oracleText) })[0];
    expect(prompt).toMatchObject({ kind: 'sweep', how: 'bounce', kinds: ['nonland'], theirs: true, pick: null });
    const plan = planEffect(g, 0, 'Cyclonic Rift', effectOf(prompt, 0)!, RECORDS)!;
    const after = plan.apply(g);
    expect(after.players[1].cards!.battlefield.map((c) => c.iid)).toEqual(['m']);
    expect(after.players[1].cards!.hand.map((c) => c.iid).sort()).toEqual(['g', 's']);
    expect(after.players[0].cards!.battlefield.map((c) => c.iid)).toEqual(['b', 'r', 'i']);
  });

  test('Faithless Looting flashes back for {2}{R} from the graveyard, and a medallion helps that too', () => {
    expect(wayOf(RECORDS.looting, 'flashback')?.label).toBe('Flashback {2}{R}');
    const p = price(table({ r: 'ruby' }), 'looting', { from: 'graveyard', way: 'flashback' });
    expect(plain(p.faces[0])).toEqual({ generic: 1, pips: [['R']] });
    expect(p.faces[0].on?.from).toBe('graveyard');
  });

  test('a countered flashback spell stays in exile', () => {
    const g = table({});
    const spell: StackSpell = { id: 's', seat: 0, iid: 'x', cardId: 'looting', name: 'Faithless Looting', to: 'exile', from: 'graveyard', turn: 1, active: 0 };
    expect(counteredTo(g, spell, 'graveyard')).toBe('exile');
    expect(counteredTo(g, { ...spell, from: undefined }, 'graveyard')).toBe('graveyard');
  });
});

describe('cycling', () => {
  test('reads cycling, typecycling and basic landcycling; leaves out an X it cannot price', () => {
    expect(cycleWays(RECORDS.cave)).toEqual([{ label: 'Cycling {R}', cost: { generic: 0, pips: [['R']] } }]);
    expect(cycleWays(RECORDS.abomination)).toEqual([{ label: 'Swampcycling {2}', cost: { generic: 2, pips: [] }, find: 'a Swamp card' }]);
    expect(cycleWays(RECORDS.ash)[0]).toMatchObject({ label: 'Basic landcycling {1}', find: 'a basic land card' });
    expect(cycleWays(RECORDS.krosan)[0]).toMatchObject({ label: 'Cycling {2}{G}' });
    expect(cycleWays(RECORDS.shark)).toEqual([]);
    expect(cycleWays({ oracleText: 'Islandcycling {2}' })[0].find).toBe('an Island card');
    expect(cycleWays({ oracleText: 'Cycling—Pay 2 life.' })[0]).toMatchObject({ life: 2, cost: { generic: 0, pips: [] } });
  });
});

describe('convoke, improvise, delve', () => {
  test('which a card has', () => {
    expect(helpsOf(RECORDS.chord)).toEqual(['convoke']);
    expect(helpsOf(RECORDS.cannoneer)).toEqual(['improvise']);
    expect(helpsOf(RECORDS.cruise)).toEqual(['delve']);
    expect(helpsOf(RECORDS.giant)).toEqual([]);
  });

  test('Chord of Calling: my creatures pay — a summoning-sick one too, each for its color', () => {
    const g = table({ f: 'forest', b1: 'bears', b2: 'bears', e: 'elves' }, {}, { wear: { b2: { sick: true }, e: { sick: true } } });
    const sources = castSources(g, 0, RECORDS, RECORDS.chord, 'h');
    const chord = price(g, 'chord', { from: 'hand', x: 1 }).faces[0];
    // {1}{G}{G}{G}: a Forest, and three green creatures — one only just arrived.
    expect(affordable(chord, sources)).toBe(true);
    const plan = planPayment(chord, sources)!;
    expect(Object.keys(plan.spend).sort()).toEqual(['b1', 'b2', 'e', 'f']);
    // Without convoke, the creatures are no help.
    expect(affordable(chord, castSources(g, 0, RECORDS, RECORDS.giant))).toBe(false);
  });

  test('convoke with a token stack: its untapped copies', () => {
    const saprolings: BoardItem = {
      id: 'sap',
      cardId: null,
      name: 'Saproling',
      imageNormal: null,
      imageArtCrop: null,
      typeLine: 'Token Creature — Saproling',
      oracleText: '',
      basePower: 1,
      baseToughness: 1,
      count: 3,
      tapped: 1,
      counters: {},
      color: null,
      zone: 'board',
    };
    const g = table({ f1: 'forest', f2: 'forest', f3: 'forest' }, {}, { board: [saprolings] });
    const sources = castSources(g, 0, RECORDS, RECORDS.chord);
    expect(sources.filter((s) => s.key === 'sap')).toHaveLength(2);
    const plan = planPayment(price(g, 'chord', { from: 'hand', x: 2 }).faces[0], sources)!;
    expect(plan.boardTaps).toEqual({ sap: 2 });
  });

  test('improvise: artifacts pay generic mana, never a colored one', () => {
    const g = table({ i: 'island', r: 'ruby', s2: 'sphere' }, {});
    const sources = castSources(g, 0, RECORDS, RECORDS.cannoneer);
    const cost = price(g, 'cannoneer').faces[0];
    // {5}{U} + Sphere's 1 = 6 generic: Island for the {U}, but only two artifacts.
    expect(cost.generic).toBe(6);
    expect(affordable(cost, sources)).toBe(false);
    expect(affordable({ generic: 2, pips: [['U']] }, sources)).toBe(true);
    expect(affordable({ generic: 0, pips: [['U'], ['U']] }, sources)).toBe(false);
  });

  test('delve: the graveyard pays first, one card for each {1}', () => {
    const g = table({ i: 'island', i2: 'island' }, {}, { graveyard: ['giant', 'bears', 'act', 'looting', 'divination', 'elves', 'ruby'] });
    const sources = castSources(g, 0, RECORDS, RECORDS.cruise);
    const cruise = price(g, 'cruise').faces[0];
    const plan = planPayment(cruise, sources)!;
    expect(plan).not.toBeNull();
    // Seven cards exiled, one Island for the {U}: the other Island stays untapped.
    expect(Object.keys(plan.spend).filter((k) => k.startsWith('grave:'))).toHaveLength(7);
    expect(plan.spend[graveKey('g0')]).toBe(1);
    expect(Object.keys(plan.spend).filter((k) => !k.startsWith('grave:'))).toHaveLength(1);
  });
});
