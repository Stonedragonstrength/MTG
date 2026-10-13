import { describe, expect, test } from 'vitest';
import { draftSize, draftWords, opponentsOf, tappedToAttack } from './attackDraft';
import { useUpTap } from './cards';
import { createGame } from './game';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from './types';

const config = (seats: number): GameConfig => ({
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: ['Nathan', 'Sam', 'Alex', 'Jo'].slice(0, seats).map((name, i) => ({
    id: `p${i}`,
    name,
    avatarUrl: null,
    commanderName: null,
  })),
});

function rec(id: string, name: string, typeLine: string, oracleText = ''): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: '2',
    toughness: '2',
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  bear: rec('bear', 'Grizzly Bears', 'Creature — Bear'),
  elf: rec('elf', 'Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.'),
  goblin: rec('goblin', 'Raging Goblin', 'Creature — Goblin', 'Haste'),
  ring: rec('ring', 'Sol Ring', 'Artifact', '{T}: Add {C}{C}.'),
  flip: rec('flip', 'Innocent Traveler // Malicious Invader', 'Creature — Human // Creature — Vampire'),
  rites: rec('rites', 'Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun', 'Legendary Enchantment // Legendary Land'),
};

const card = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name: RECORDS[cardId]?.name ?? cardId,
  row: 'front',
  ...more,
});

const stack = (id: string, name: string, count: number, more: Partial<BoardItem> = {}): BoardItem => ({
  id,
  cardId: null,
  name,
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count,
  counters: {},
  color: null,
  zone: 'board',
  ...more,
});

function game(battlefield: CardInstance[], board: BoardItem[] = [], seats = 2): GameState {
  const g = createGame(config(seats));
  g.turnNumber = 3;
  g.players[0] = {
    ...g.players[0],
    board,
    cards: {
      library: [],
      hand: [],
      battlefield,
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Test',
    },
  };
  return g;
}

const ids = (g: GameState) => tappedToAttack(g, RECORDS).map((p) => `${p.unit.id}×${p.n}`);

describe('tappedToAttack', () => {
  test('the active player’s tapped creatures are the attack; untapped ones are not', () => {
    const g = game([card('b1', 'bear', { tapped: true }), card('b2', 'bear'), card('e1', 'elf', { tapped: true })]);
    expect(ids(g)).toEqual(['b1×1', 'e1×1']);
    expect(draftSize(tappedToAttack(g, RECORDS))).toBe(2);
  });

  test('nothing tapped, nothing offered', () => {
    expect(ids(game([card('b1', 'bear')]))).toEqual([]);
  });

  test('a creature whose tap paid for something was tapped for mana — and one that already attacked is used up', () => {
    const g = game([card('e1', 'elf', { tapped: true, spent: 1 }), card('b1', 'bear', { tapped: true })]);
    expect(ids(g)).toEqual(['b1×1']);
    // After it attacks, a hand-tapped creature's tap is marked used up: it is not offered again.
    expect(ids(useUpTap(g, 0, 'b1'))).toEqual([]);
  });

  test('a creature that arrived this turn is not offered, unless it has haste', () => {
    const g = game([
      card('b1', 'bear', { tapped: true, sick: true }),
      card('g1', 'goblin', { tapped: true, sick: true }),
    ]);
    expect(ids(g)).toEqual(['g1×1']);
  });

  test('only creatures, by their front face; never the lands shelf; never a card that cannot be read', () => {
    const g = game([
      card('r1', 'ring', { tapped: true }),
      card('f1', 'flip', { tapped: true }), // a creature on both faces
      card('i1', 'rites', { tapped: true }), // an enchantment that is a land on the back
      card('b1', 'bear', { tapped: true, row: 'lands' }),
      card('m1', 'unknown-card', { tapped: true }),
    ]);
    expect(tappedToAttack(g, RECORDS).map((p) => p.name)).toEqual(['Innocent Traveler']);
  });

  test('a stack offers its tapped copies, less the ones that only just arrived', () => {
    const g = game(
      [],
      [
        stack('soldiers', 'Soldier', 4, { tapped: 3 }),
        stack('fresh', 'Zombie', 3, { tapped: 3, sick: 2 }),
        stack('treasure', 'Treasure', 2, { tapped: 2, basePower: null, baseToughness: null }),
        stack('forest', 'Forest', 5, { tapped: 5, zone: 'lands' }),
        stack('idle', 'Elf', 2),
      ],
    );
    expect(ids(g)).toEqual(['soldiers×3', 'fresh×1']);
    expect(draftWords(tappedToAttack(g, RECORDS))).toBe('3 Soldier and Zombie');
  });

  test('no offer while a fight is on, on a defeated player’s turn, or for anyone but the active player', () => {
    const g = game([card('b1', 'bear', { tapped: true })]);
    const fighting: GameState = { ...g, combat: { id: 'c1', turn: 3, active: 0, step: 'attackers' } };
    expect(ids(fighting)).toEqual([]);
    const defeated: GameState = { ...g, players: [{ ...g.players[0], eliminated: true }, g.players[1]] };
    expect(ids(defeated)).toEqual([]);
    expect(ids({ ...g, activePlayerIndex: 1 })).toEqual([]); // seat 1 has nothing tapped
    // A fight that is over this turn does not stand in the way of the next offer.
    const done: GameState = { ...g, combat: { id: 'c1', turn: 3, active: 0, step: 'done' } };
    expect(ids(done)).toEqual(['b1×1']);
  });
});

describe('draftWords', () => {
  test('one, two and several', () => {
    const pick = (name: string, n = 1) => ({ unit: { kind: 'card' as const, id: name }, n, name });
    expect(draftWords([pick('Bear')])).toBe('Bear');
    expect(draftWords([pick('Bear'), pick('Giant')])).toBe('Bear and Giant');
    expect(draftWords([pick('Bear'), pick('Giant'), pick('Soldier', 2)])).toBe('Bear, Giant and 2 Soldier');
  });
});

describe('opponentsOf', () => {
  test('every other living player, in turn order after the active one', () => {
    const g = game([], [], 4);
    expect(opponentsOf(g)).toEqual([1, 2, 3]);
    expect(opponentsOf({ ...g, activePlayerIndex: 2 })).toEqual([3, 0, 1]);
    const out = { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, eliminated: true } : p)) };
    expect(opponentsOf(out)).toEqual([2, 3]);
  });
});

describe('useUpTap', () => {
  test('marks a hand-tapped card’s mana as gone, once; leaves an untapped or already-spent one alone', () => {
    const g = game([card('e1', 'elf', { tapped: true }), card('b1', 'bear'), card('e2', 'elf', { tapped: true, spent: 1 })]);
    const used = useUpTap(g, 0, 'e1');
    expect(used.players[0].cards!.battlefield[0].spent).toBeGreaterThan(100);
    expect(useUpTap(used, 0, 'e1')).toBe(used);
    expect(useUpTap(g, 0, 'b1')).toBe(g);
    expect(useUpTap(g, 0, 'e2')).toBe(g);
    expect(useUpTap(g, 0, 'nope')).toBe(g);
  });
});
