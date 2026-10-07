import { describe, expect, test } from 'vitest';
import { applyCombat, outcomeDefeats } from './combat';
import {
  cardsRead,
  freeToAttack,
  freeToBlock,
  hasDefender,
  hasKeyword,
  isCreature,
  readSeat,
  readUnit,
  resolveCombat,
  type CardRecords,
} from './combatEngine';
import { createGame } from './game';
import type {
  BoardItem,
  CardInstance,
  CardRecord,
  CombatAttack,
  CombatUnit,
  GameConfig,
  GameState,
} from './types';

const NAMES = ['Nathan', 'Sam', 'Alex', 'Kim'];

function config(seats: number): GameConfig {
  return {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    mode: 'cards',
    profiles: NAMES.slice(0, seats).map((name, i) => ({
      id: `p${i}`,
      name,
      avatarUrl: null,
      commanderName: null,
    })),
  };
}

/** A card record as the database holds it. */
function rec(
  name: string,
  power: string | null,
  toughness: string | null,
  oracleText = '',
  typeLine = 'Creature — Test',
): CardRecord {
  return {
    id: `c-${name}`,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power,
    toughness,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

// Real cards, sizes and text as the card database stores them.
const BEAR = rec('Grizzly Bears', '2', '2');
const OGRE = rec('Gray Ogre', '2', '2');
const GIANT = rec('Hill Giant', '3', '3');
const AIR_ELEMENTAL = rec('Air Elemental', '4', '4', 'Flying');
const WURM = rec('Craw Wurm', '6', '4');
const RHINO = rec('Siege Rhino stand-in', '5', '5');
const WALL_OF_OMENS = rec('Wall of Omens', '0', '4', 'Defender\nWhen this creature enters, draw a card.');
const NIGHTHAWK = rec(
  'Vampire Nighthawk',
  '2',
  '3',
  'Flying\nDeathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nLifelink (Damage dealt by this creature also causes you to gain that much life.)',
);
const WURMCOIL = rec('Wurmcoil Engine', '6', '6', 'Deathtouch, lifelink\nWhen this creature dies, create two tokens.');
const SKITHIRYX = rec(
  'Skithiryx, the Blight Dragon',
  '4',
  '4',
  'Flying\nInfect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\n{B}: Skithiryx gains haste until end of turn.\n{B}{B}: Regenerate Skithiryx.',
  'Legendary Creature — Phyrexian Dragon Skeleton',
);
const CONTAMINATOR = rec(
  'Bloated Contaminator',
  '4',
  '4',
  'Trample\nToxic 1 (Players dealt combat damage by this creature also get a poison counter.)\nWhenever this creature deals combat damage to a player, proliferate.',
);
const BLIGHTSTEEL = rec('Blightsteel Colossus', '11', '11', 'Trample, infect, indestructible');
const DARKSTEEL = rec(
  'Darksteel Colossus',
  '11',
  '11',
  'Trample (This creature can deal excess combat damage to the player or planeswalker it\'s attacking.)\nIndestructible (Damage and effects that say "destroy" don\'t destroy this creature.)',
);
const ZETALPA = rec('Zetalpa, Primal Dawn', '4', '8', 'Flying, double strike, vigilance, trample, indestructible');
const SERRA_ANGEL = rec('Serra Angel', '4', '4', 'Flying, vigilance');
const TARMOGOYF = rec('Tarmogoyf', '*', '1+*', "Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.");
const ADELINE = rec('Adeline, Resplendent Cathar', '*', '4', "Vigilance\nAdeline's power is equal to the number of creatures you control.");
const GHAVE = rec('Ghave, Guru of Spores', '0', '0', 'Ghave enters with five +1/+1 counters on it.');
const WHIP = rec('Whip of Erebos', null, null, 'Creatures you control have lifelink.\n{2}{B}{B}, {T}: Return target creature card from your graveyard to the battlefield.', 'Legendary Enchantment Artifact');
const TRUE_CONVICTION = rec('True Conviction', null, null, 'Creatures you control have double strike and lifelink.', 'Enchantment');
const AVACYN = rec('Avacyn, Angel of Hope', '8', '8', 'Flying, vigilance, indestructible\nOther permanents you control have indestructible.', 'Legendary Creature — Angel');
const NYLEA = rec(
  'Nylea, God of the Hunt',
  '6',
  '6',
  "Indestructible\nAs long as your devotion to green is less than five, Nylea isn't a creature.\nOther creatures you control have trample.\n{3}{G}: Target creature gets +2/+2 until end of turn.",
  'Legendary Enchantment Creature — God',
);
const OHRAN_FROSTFANG = rec('Ohran Frostfang', '2', '6', 'Attacking creatures you control have deathtouch.\nWhenever a creature you control deals combat damage to a player, draw a card.');
const SOL_RING = rec('Sol Ring', null, null, '{T}: Add {C}{C}.', 'Artifact');
const FOREST = rec('Forest', null, null, '({T}: Add {G}.)', 'Basic Land — Forest');
const WESTVALE_ABBEY = rec('Westvale Abbey', null, null, '{T}: Add {C}.\n//\nFlying, lifelink, indestructible, haste', 'Land // Legendary Creature — Demon');
const WITCH_ENCHANTER = rec('Witch Enchanter', '2', '2', 'When this creature enters, destroy target artifact or enchantment an opponent controls.\n//\n{T}: Add {W}.', 'Creature — Human Warlock // Land');
const FABLE = rec('Fable of the Mirror-Breaker', null, null, 'I — Create a token.\n//\n{1}, {T}: Create a token.', 'Enchantment — Saga // Enchantment Creature — Goblin Shaman');
const COPTER = rec("Smuggler's Copter", '3', '3', 'Flying\nCrew 1', 'Artifact — Vehicle');
const FERVOR = rec('Fervor', null, null, 'Creatures you control have haste.', 'Enchantment');

const card = (id: string): CombatUnit => ({ kind: 'card', id });
const stack = (id: string): CombatUnit => ({ kind: 'stack', id });

function tokens(id: string, count: number, power: number | null, toughness: number | null, more: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    cardId: null,
    name: id,
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Token Creature',
    oracleText: '',
    basePower: power,
    baseToughness: toughness,
    count,
    counters: {},
    color: null,
    zone: 'board',
    ...more,
  };
}

/** What one seat has on the table: cards by instance id (a record, null for a card this device's
 * database does not hold, 'pending' for one whose lookup has not answered yet), and stacks. */
interface Side {
  cards?: Record<string, CardRecord | null | 'pending'>;
  /** Extra fields for those cards: counters, tapped, row, sick. */
  wear?: Record<string, Partial<CardInstance>>;
  stacks?: BoardItem[];
  /** No cards at all: a tracker seat. */
  tracker?: true;
}

/** A table with those sides, seat 0's turn, and the records this device has read. */
function table(...sides: Side[]): { g: GameState; records: CardRecords } {
  const base = createGame(config(sides.length));
  const records: CardRecords = {};
  const players = base.players.map((p, i) => {
    const side = sides[i];
    const battlefield: CardInstance[] = Object.entries(side.cards ?? {}).map(([iid, r]) => {
      const cardId = r && r !== 'pending' ? r.id : `c-${iid}`;
      if (r !== 'pending') records[cardId] = r;
      return { iid, cardId, name: r && r !== 'pending' ? r.name : iid, row: 'front' as const, ...side.wear?.[iid] };
    });
    return {
      ...p,
      board: side.stacks ?? [],
      ...(side.tracker
        ? {}
        : {
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
          }),
    };
  });
  return { g: { ...base, players }, records };
}

/** The fight at the damage step with these attacks, resolved. */
function fight(t: { g: GameState; records: CardRecords }, attacks: CombatAttack[]) {
  const g: GameState = {
    ...t.g,
    combat: { id: 'c1', turn: t.g.turnNumber, active: t.g.activePlayerIndex, step: 'damage', attacks },
  };
  return { g, result: resolveCombat(g, g.combat!, t.records) };
}

const deathsOf = (r: ReturnType<typeof resolveCombat>) =>
  r.outcome.deaths.map((d) => `${d.seat}:${d.unit.id}${d.n ? ` x${d.n}` : ''}${d.tapped ? ` (${d.tapped} tapped)` : ''}${d.toCommand ? ' home' : ''}`);
const playerOf = (r: ReturnType<typeof resolveCombat>, seat: number) => r.outcome.players.find((p) => p.seat === seat);

describe('who is what', () => {
  test('a card is a creature when the front of its type line says so, and only in the front row', () => {
    const t = table({
      cards: {
        bear: BEAR,
        ring: SOL_RING,
        abbey: WESTVALE_ABBEY, // "Land // Legendary Creature — Demon": a land
        fable: FABLE, // a Saga with a creature on its back
        witch: WITCH_ENCHANTER, // "Creature — Human Warlock // Land": played as a creature here
        witchLand: WITCH_ENCHANTER, // …and as its land here, on the shelf
        copter: COPTER, // a Vehicle has a size but is no creature
        forest: FOREST,
        strayForest: FOREST, // dragged into the front row: still a land
      },
      wear: { abbey: { row: 'lands' }, witchLand: { row: 'lands' }, forest: { row: 'lands' } },
    });
    const is = (iid: string) => isCreature(t.g, 0, card(iid), t.records);
    expect(is('bear')).toBe(true);
    expect(is('ring')).toBe(false);
    expect(is('forest')).toBe(false);
    expect(is('strayForest')).toBe(false);
    expect(is('abbey')).toBe(false);
    expect(is('fable')).toBe(false);
    expect(is('witch')).toBe(true);
    expect(is('witchLand')).toBe(false);
    expect(is('copter')).toBe(false);
    expect(is('nothing')).toBe(false);
  });

  test('a card this device cannot read may still be picked: what the app cannot read never blocks a play', () => {
    const t = table({ cards: { late: 'pending', lost: null, lostLand: null }, wear: { lostLand: { row: 'lands' } } });
    expect(isCreature(t.g, 0, card('late'), t.records)).toBe(true);
    expect(isCreature(t.g, 0, card('lost'), t.records)).toBe(true);
    expect(isCreature(t.g, 0, card('lostLand'), t.records)).toBe(false); // the lands shelf never fights
    expect(readUnit(t.g, 0, card('late'), t.records)).toMatchObject({ unread: true, power: 0, toughness: 0 });
  });

  test('a stack is a creature when it has both a power and a toughness, off the lands shelf', () => {
    const t = table({
      tracker: true,
      stacks: [
        tokens('soldiers', 3, 1, 1),
        tokens('treasure', 2, null, null),
        tokens('half', 1, 2, null),
        tokens('arbor', 1, 1, 1, { zone: 'lands' }),
      ],
    });
    const is = (id: string) => isCreature(t.g, 0, stack(id), t.records);
    expect([is('soldiers'), is('treasure'), is('half'), is('arbor'), is('gone')]).toEqual([true, false, false, false, false]);
  });

  test('size is the printed front-face size plus +1/+1 counters, and nothing else', () => {
    const t = table({
      cards: { bear: BEAR, big: BEAR, anthem: rec('Glorious Anthem', null, null, 'Creatures you control get +1/+1.', 'Enchantment') },
      wear: { big: { counters: { p1p1: 3, oil: 2 } } },
      stacks: [tokens('soldiers', 3, 1, 1, { counters: { p1p1: 2 } })],
    });
    expect(readUnit(t.g, 0, card('bear'), t.records)).toMatchObject({ power: 2, toughness: 2, unread: false });
    expect(readUnit(t.g, 0, card('big'), t.records)).toMatchObject({ power: 5, toughness: 5 });
    expect(readUnit(t.g, 0, stack('soldiers'), t.records)).toMatchObject({ power: 3, toughness: 3, count: 3 });
  });

  test('unread: a star, a size that is not a number, 0/0 without counters, a record that is missing or late', () => {
    const t = table({
      cards: { goyf: TARMOGOYF, adeline: ADELINE, ghave: GHAVE, late: 'pending', lost: null, x: rec('Hydra', 'X', 'X') },
      stacks: [tokens('germ', 1, 0, 0), tokens('half', 1, 2, null)],
    });
    for (const iid of ['goyf', 'adeline', 'ghave', 'late', 'lost', 'x']) {
      expect(readUnit(t.g, 0, card(iid), t.records)!.unread, iid).toBe(true);
    }
    expect(readUnit(t.g, 0, stack('germ'), t.records)!.unread).toBe(true);
    expect(readUnit(t.g, 0, stack('half'), t.records)!.unread).toBe(true);
    expect(readUnit(t.g, 0, card('nothing'), t.records)).toBeNull();
    expect(readUnit(t.g, 0, stack('nothing'), t.records)).toBeNull();
    expect(readUnit(t.g, 5, card('goyf'), t.records)).toBeNull();
  });

  test('a star reads as 0 underneath counters, so the real size can be typed in with the +1/+1 stepper', () => {
    const t = table({
      cards: { goyf: TARMOGOYF, adeline: ADELINE, ghave: GHAVE },
      wear: { goyf: { counters: { p1p1: 4 } }, adeline: { counters: { p1p1: 3 } }, ghave: { counters: { p1p1: 5 } } },
      stacks: [tokens('germ', 1, 0, 0, { counters: { p1p1: 2 } })],
    });
    expect(readUnit(t.g, 0, card('goyf'), t.records)).toMatchObject({ unread: false, power: 4, toughness: 4 });
    expect(readUnit(t.g, 0, card('adeline'), t.records)).toMatchObject({ unread: false, power: 3, toughness: 7 });
    expect(readUnit(t.g, 0, card('ghave'), t.records)).toMatchObject({ unread: false, power: 5, toughness: 5 });
    expect(readUnit(t.g, 0, stack('germ'), t.records)).toMatchObject({ unread: false, power: 2, toughness: 2 });
  });

  test('keywords: what is printed on it and what another permanent hands it are told apart', () => {
    const t = table({
      cards: { hawk: NIGHTHAWK, bear: BEAR, whip: WHIP, nylea: NYLEA, frostfang: OHRAN_FROSTFANG },
      stacks: [tokens('thopters', 2, 1, 1, { oracleText: 'Flying, Lifelink, Ward' })],
    });
    const hawk = readUnit(t.g, 0, card('hawk'), t.records)!;
    expect(hawk.printed).toEqual(['flying', 'deathtouch', 'lifelink']);
    expect(hawk.granted).toEqual(['trample']); // Nylea; the Whip's lifelink is already printed on it
    const bear = readUnit(t.g, 0, card('bear'), t.records)!;
    expect(bear.printed).toEqual([]);
    expect(bear.granted).toEqual(['lifelink', 'trample']); // no deathtouch: the Frostfang's is for attackers only, not read
    expect(hasKeyword(bear, 'trample')).toBe(true);
    expect(hasKeyword(bear, 'deathtouch')).toBe(false);
    const nylea = readUnit(t.g, 0, card('nylea'), t.records)!;
    expect(nylea.printed).toEqual(['indestructible']);
    expect(nylea.granted).toEqual(['lifelink']); // not her own trample
    const thopters = readUnit(t.g, 0, stack('thopters'), t.records)!;
    expect(thopters.printed).toEqual(['flying', 'lifelink']);
    expect(thopters.granted).toEqual(['trample']);
  });

  test('toxic carries its number', () => {
    const t = table({ cards: { beast: CONTAMINATOR, bear: BEAR } });
    expect(readUnit(t.g, 0, card('beast'), t.records)).toMatchObject({ toxic: 1 });
    expect(readUnit(t.g, 0, card('beast'), t.records)!.printed).toEqual(['trample', 'toxic']);
    expect(readUnit(t.g, 0, card('bear'), t.records)!.toxic).toBe(0);
  });

  test('a card that is not read hands out nothing; one that is read still hands to the unread', () => {
    const t = table({ cards: { whip: 'pending', late: 'pending', bear: BEAR } });
    expect(readUnit(t.g, 0, card('bear'), t.records)!.granted).toEqual([]);
    const read = table({ cards: { whip: WHIP, late: 'pending' } });
    expect(readUnit(read.g, 0, card('late'), read.records)!.granted).toEqual(['lifelink']);
  });
});

describe('picking: who may attack and who may block', () => {
  test('a creature attacks when it is untapped and not summoning sick', () => {
    const t = table({
      cards: { bear: BEAR, tapped: BEAR, fresh: BEAR, hasty: rec('Raging Goblin', '1', '1', 'Haste'), ring: SOL_RING },
      wear: { tapped: { tapped: true }, fresh: { sick: true }, hasty: { sick: true } },
    });
    const free = (iid: string) => freeToAttack(t.g, 0, card(iid), t.records);
    expect([free('bear'), free('tapped'), free('fresh'), free('hasty'), free('ring'), free('gone')]).toEqual([1, 0, 0, 1, 0, 0]);
  });

  test('haste handed out by the seat cures it — read generously, as the turn rules do', () => {
    const t = table({ cards: { fresh: BEAR, fervor: FERVOR }, wear: { fresh: { sick: true } } });
    expect(freeToAttack(t.g, 0, card('fresh'), t.records)).toBe(1);
  });

  test('a card that is not read yet is never held back as summoning sick', () => {
    const t = table({ cards: { late: 'pending' }, wear: { late: { sick: true } } });
    expect(freeToAttack(t.g, 0, card('late'), t.records)).toBe(1);
  });

  test('a stack offers the copies that could be both untapped and past their first turn', () => {
    const t = table({
      tracker: true,
      stacks: [
        tokens('soldiers', 5, 1, 1, { tapped: 1, sick: 2 }),
        tokens('goblins', 3, 1, 1, { sick: 3, oracleText: 'Haste' }),
        tokens('all tapped', 2, 1, 1, { tapped: 2 }),
        tokens('treasure', 4, null, null),
      ],
    });
    const free = (id: string) => freeToAttack(t.g, 0, stack(id), t.records);
    expect(free('soldiers')).toBe(3); // min(5 − 1, 5 − 2)
    expect(free('goblins')).toBe(3); // haste
    expect(free('all tapped')).toBe(0);
    expect(free('treasure')).toBe(0); // not a creature
  });

  test('blocking only asks for untapped: a creature that just arrived blocks fine', () => {
    const t = table({
      cards: { bear: BEAR, tapped: BEAR, fresh: BEAR, ring: SOL_RING },
      wear: { tapped: { tapped: true }, fresh: { sick: true } },
      stacks: [tokens('soldiers', 5, 1, 1, { tapped: 2, sick: 5 })],
    });
    const free = (u: CombatUnit) => freeToBlock(t.g, 0, u, t.records);
    expect([free(card('bear')), free(card('tapped')), free(card('fresh')), free(card('ring'))]).toEqual([1, 0, 1, 0]);
    expect(free(stack('soldiers'))).toBe(3);
  });

  test('defender is read off the card, for "all attack" to skip', () => {
    const t = table({ cards: { wall: WALL_OF_OMENS, bear: BEAR, late: 'pending' }, stacks: [tokens('plants', 2, 0, 1, { oracleText: 'Defender' })] });
    expect(hasDefender(t.g, 0, card('wall'), t.records)).toBe(true);
    expect(hasDefender(t.g, 0, card('bear'), t.records)).toBe(false);
    expect(hasDefender(t.g, 0, card('late'), t.records)).toBe(false);
    expect(hasDefender(t.g, 0, stack('plants'), t.records)).toBe(true);
    expect(freeToAttack(t.g, 0, card('wall'), t.records)).toBe(1); // a tap may still pick a Wall
  });

  test('cardsRead: every card of the seats in the fight has had its record answered — a record or a definite miss', () => {
    const attacks: CombatAttack[] = [{ unit: card('bear'), target: 1 }];
    const answered = table({ cards: { bear: BEAR, lost: null } }, { cards: { wall: WALL_OF_OMENS } });
    expect(cardsRead(answered.g, fight(answered, attacks).g.combat!, answered.records)).toBe(true);
    const attackerLate = table({ cards: { bear: 'pending' } }, { cards: { wall: WALL_OF_OMENS } });
    expect(cardsRead(attackerLate.g, fight(attackerLate, attacks).g.combat!, attackerLate.records)).toBe(false);
    const blockerLate = table({ cards: { bear: BEAR } }, { cards: { wall: 'pending' } });
    expect(cardsRead(blockerLate.g, fight(blockerLate, attacks).g.combat!, blockerLate.records)).toBe(false);
    // a card that is not fighting can still change the fight (the Whip hands out lifelink): it is waited for too
    const whipLate = table({ cards: { bear: BEAR, whip: 'pending' } }, { cards: { wall: WALL_OF_OMENS } });
    expect(cardsRead(whipLate.g, fight(whipLate, attacks).g.combat!, whipLate.records)).toBe(false);
    // a seat that is not in the fight is not waited for
    const bystander = table({ cards: { bear: BEAR } }, { cards: { wall: WALL_OF_OMENS } }, { cards: { late: 'pending' } });
    expect(cardsRead(bystander.g, fight(bystander, attacks).g.combat!, bystander.records)).toBe(true);
    // stacks carry their own text: nothing to wait for
    const tiles = table({ tracker: true, stacks: [tokens('soldiers', 2, 1, 1)] }, { tracker: true });
    expect(cardsRead(tiles.g, fight(tiles, [{ unit: stack('soldiers'), n: 2, target: 1 }]).g.combat!, tiles.records)).toBe(true);
  });

  test('readSeat gathers a seat once, for reading many of its units', () => {
    const t = table({ cards: { bear: BEAR, whip: WHIP } });
    const seat = readSeat(t.g, 0, t.records);
    expect(readUnit(t.g, 0, card('bear'), t.records, seat)).toEqual(readUnit(t.g, 0, card('bear'), t.records));
    expect(seat.texts).toEqual([WHIP.oracleText]);
  });
});

describe('damage', () => {
  test('unblocked: all of its damage to the defending player', () => {
    const { result } = fight(table({ cards: { giant: GIANT } }, { cards: { wall: WALL_OF_OMENS } }), [
      { unit: card('giant'), target: 1 },
    ]);
    expect(result.outcome).toEqual({ players: [{ seat: 1, life: -3 }], deaths: [] });
    expect(result.defenders).toEqual([{ seat: 1, commanders: [], other: 3, poison: 0 }]);
    expect(result.attacks[0]).toMatchObject({ name: 'Hill Giant', target: 1, blocked: 0, toPlayer: 3, dies: 0, n: 1 });
  });

  test('a chump block: the attacker deals ALL its power to the blocker, none to the player', () => {
    const { result } = fight(table({ cards: { wurm: WURM } }, { cards: { bear: BEAR } }), [
      { unit: card('wurm'), target: 1, blockers: [card('bear')] },
    ]);
    expect(result.outcome.players).toEqual([]);
    expect(deathsOf(result)).toEqual(['1:bear']);
    expect(result.attacks[0]).toMatchObject({ blocked: 1, toPlayer: 0, dies: 0 });
    expect(result.attacks[0].blockers[0]).toMatchObject({ name: 'Grizzly Bears', seat: 1, dies: 1 });
  });

  test('a gang block: lethal to each blocker in the order declared, the rest on the last, and every blocker hits back', () => {
    // 6/4 into a 2/2 and a 3/3: 2 to the first, 4 to the second; they deal 2 + 3 = 5 back
    const { result } = fight(table({ cards: { wurm: WURM } }, { cards: { bear: BEAR, giant: GIANT } }), [
      { unit: card('wurm'), target: 1, blockers: [card('bear'), card('giant')] },
    ]);
    expect(deathsOf(result).sort()).toEqual(['0:wurm', '1:bear', '1:giant']);
    expect(result.outcome.players).toEqual([]);
    // the other way round the order matters: 3 to the giant, 3 left on the bear
    const small = fight(table({ cards: { giant: GIANT } }, { cards: { rhino: RHINO, bear: BEAR } }), [
      { unit: card('giant'), target: 1, blockers: [card('rhino'), card('bear')] },
    ]);
    expect(deathsOf(small.result)).toEqual(['0:giant']); // all 3 went to the rhino first: lethal is 5
    const flipped = fight(table({ cards: { giant: GIANT } }, { cards: { rhino: RHINO, bear: BEAR } }), [
      { unit: card('giant'), target: 1, blockers: [card('bear'), card('rhino')] },
    ]);
    expect(deathsOf(flipped.result).sort()).toEqual(['0:giant', '1:bear']);
  });

  test('trample over two blockers: lethal to each, the rest to the player', () => {
    const trampler = rec('Trampler', '7', '7', 'Trample');
    const { result } = fight(table({ cards: { big: trampler } }, { cards: { bear: BEAR, giant: GIANT } }), [
      { unit: card('big'), target: 1, blockers: [card('bear'), card('giant')] },
    ]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -2 }]); // 7 − 2 − 3
    expect(deathsOf(result).sort()).toEqual(['1:bear', '1:giant']);
    expect(result.attacks[0].toPlayer).toBe(2);
  });

  test('deathtouch and trample: one point is lethal, the rest tramples over', () => {
    const basilisk = rec('Trampling Basilisk', '4', '4', 'Deathtouch, trample');
    const { result } = fight(table({ cards: { basilisk } }, { cards: { rhino: RHINO } }), [
      { unit: card('basilisk'), target: 1, blockers: [card('rhino')] },
    ]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -3 }]);
    expect(deathsOf(result).sort()).toEqual(['0:basilisk', '1:rhino']); // 1 deathtouch damage kills the 5/5
  });

  test('deathtouch without trample: any of its damage kills, whatever the toughness', () => {
    const { result } = fight(table({ cards: { hawk: NIGHTHAWK } }, { cards: { rhino: RHINO } }), [
      { unit: card('hawk'), target: 1, blockers: [card('rhino')] },
    ]);
    expect(deathsOf(result).sort()).toEqual(['0:hawk', '1:rhino']);
  });

  test('first strike kills before it is hit', () => {
    const knight = rec('White Knight', '2', '2', 'First strike');
    const { result } = fight(table({ cards: { knight } }, { cards: { bear: BEAR } }), [
      { unit: card('knight'), target: 1, blockers: [card('bear')] },
    ]);
    expect(deathsOf(result)).toEqual(['1:bear']); // the bear never got to deal its 2
    // and a first striker that does not kill is hit in the second step like anyone
    const into = fight(table({ cards: { knight } }, { cards: { giant: GIANT } }), [
      { unit: card('knight'), target: 1, blockers: [card('giant')] },
    ]);
    expect(deathsOf(into.result)).toEqual(['0:knight']);
    // a first-striking BLOCKER kills the attacker before it deals anything
    const blocked = fight(table({ cards: { bear: BEAR } }, { cards: { knight } }), [
      { unit: card('bear'), target: 1, blockers: [card('knight')] },
    ]);
    expect(deathsOf(blocked.result)).toEqual(['0:bear']);
  });

  test('double strike deals in both steps; unblocked that is twice its power', () => {
    const fencer = rec('Fencing Ace', '1', '1', 'Double strike');
    const { result } = fight(table({ cards: { fencer } }, { cards: {} }), [{ unit: card('fencer'), target: 1 }]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -2 }]);
  });

  test('double strike and trample into a bigger blocker: 3, then the 2 still missing, and 1 tramples over', () => {
    const striker = rec('Striker', '3', '3', 'Double strike, trample');
    const { result } = fight(table({ cards: { striker } }, { cards: { rhino: RHINO } }), [
      { unit: card('striker'), target: 1, blockers: [card('rhino')] },
    ]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -1 }]); // lethal in the second step counts what is marked
    expect(deathsOf(result).sort()).toEqual(['0:striker', '1:rhino']);
  });

  test('a blocker killed in the first step soaks nothing in the second: Zetalpa’s whole second strike tramples over', () => {
    const { result } = fight(table({ cards: { zetalpa: ZETALPA } }, { cards: { bear: BEAR } }), [
      { unit: card('zetalpa'), target: 1, blockers: [card('bear')] },
    ]);
    // first step: 2 on the bear, 2 over; second step: nobody left in the way, all 4 over
    expect(result.outcome).toEqual({ players: [{ seat: 1, life: -6 }], deaths: [{ seat: 1, unit: card('bear') }] });
    // without trample the second strike is simply lost: it is still a blocked creature
    const striker = rec('Striker', '4', '4', 'Double strike');
    const plain = fight(table({ cards: { striker } }, { cards: { bear: BEAR } }), [
      { unit: card('striker'), target: 1, blockers: [card('bear')] },
    ]);
    expect(plain.result.outcome).toEqual({ players: [], deaths: [{ seat: 1, unit: card('bear') }] });
  });

  test('a creature dead after the first step deals nothing in the second', () => {
    const striker = rec('Striker', '3', '3', 'Double strike');
    const knight = rec('Big Knight', '4', '4', 'First strike');
    const { result } = fight(table({ cards: { striker } }, { cards: { knight } }), [
      { unit: card('striker'), target: 1, blockers: [card('knight')] },
    ]);
    // both strike first: the striker takes 4 and dies with 3 dealt; its second strike never comes
    expect(deathsOf(result)).toEqual(['0:striker']);
  });

  test('an attacker killed in the first step is hit by nobody in the second: no damage, so no lifelink', () => {
    const knight = rec('White Knight', '2', '2', 'First strike');
    const { result } = fight(table({ cards: { bear: BEAR } }, { cards: { knight, hawk: NIGHTHAWK } }), [
      { unit: card('bear'), target: 1, blockers: [card('knight'), card('hawk')] },
    ]);
    // the knight kills the bear first; the Nighthawk's 2 are never dealt, and Sam gains nothing
    expect(result.outcome).toEqual({ players: [], deaths: [{ seat: 0, unit: card('bear') }] });
    expect(result.gains).toEqual([]);
  });

  test('handed-out double strike and lifelink (True Conviction): deals twice, gains every point', () => {
    const { result } = fight(
      table({ cards: { giant: GIANT, conviction: TRUE_CONVICTION } }, { cards: {} }),
      [{ unit: card('giant'), target: 1 }],
    );
    expect(result.outcome.players).toEqual([
      { seat: 1, life: -6 },
      { seat: 0, life: 6 },
    ]);
    expect(result.gains).toEqual([{ seat: 0, life: 6 }]);
  });

  test('lifelink counts every point dealt, to creatures as much as to players: a chump-blocked Wurmcoil gains 6', () => {
    const { result } = fight(table({ cards: { wurmcoil: WURMCOIL } }, { cards: { bear: BEAR } }), [
      { unit: card('wurmcoil'), target: 1, blockers: [card('bear')] },
    ]);
    expect(result.outcome.players).toEqual([{ seat: 0, life: 6 }]);
    expect(result.gains).toEqual([{ seat: 0, life: 6 }]);
  });

  test('lifelink handed out by the Whip of Erebos reaches attackers and counts all 5 dealt to a 2/2', () => {
    const { result } = fight(table({ cards: { rhino: RHINO, whip: WHIP } }, { cards: { bear: BEAR } }), [
      { unit: card('rhino'), target: 1, blockers: [card('bear')] },
    ]);
    expect(result.gains).toEqual([{ seat: 0, life: 5 }]);
  });

  test('lifelink on a blocker is its controller’s gain', () => {
    const { result } = fight(table({ cards: { rhino: RHINO } }, { cards: { hawk: NIGHTHAWK } }), [
      { unit: card('rhino'), target: 1, blockers: [card('hawk')] },
    ]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: 2 }]);
    expect(result.gains).toEqual([{ seat: 1, life: 2 }]);
    expect(deathsOf(result).sort()).toEqual(['0:rhino', '1:hawk']); // deathtouch on the way out
  });

  test('the player at 3 who takes 4 and gains 2 from a lifelink blocker lives at 1', () => {
    const t = table({ cards: { a: AIR_ELEMENTAL, b: AIR_ELEMENTAL } }, { cards: { hawk: NIGHTHAWK } });
    t.g = { ...t.g, players: t.g.players.map((p, i) => (i === 1 ? { ...p, life: 3 } : p)) };
    const { g, result } = fight(t, [
      { unit: card('a'), target: 1, blockers: [card('hawk')] },
      { unit: card('b'), target: 1 },
    ]);
    expect(playerOf(result, 1)).toEqual({ seat: 1, life: -2 }); // one net change: −4 and +2 together
    expect(outcomeDefeats(g, result.outcome)).toEqual([]);
    const after = applyCombat(g, 'c1', result.outcome);
    expect(after.players[1]).toMatchObject({ life: 1, eliminated: false });
  });

  test('indestructible survives lethal damage and deathtouch alike', () => {
    const { result } = fight(table({ cards: { colossus: DARKSTEEL } }, { cards: { hawk: NIGHTHAWK, wurmcoil: WURMCOIL } }), [
      { unit: card('colossus'), target: 1, blockers: [card('hawk'), card('wurmcoil')] },
    ]);
    expect(deathsOf(result).sort()).toEqual(['1:hawk', '1:wurmcoil']);
    expect(result.outcome.players).toEqual([
      { seat: 1, life: 6 }, // 2 tramples over (11 − 3 − 6); the blockers' lifelink gives 2 + 6
    ]);
  });

  test('indestructible handed out by Avacyn covers the others, and she has her own', () => {
    const { result } = fight(table({ cards: { bear: BEAR, avacyn: AVACYN } }, { cards: { rhino: RHINO, wurm: WURM } }), [
      { unit: card('bear'), target: 1, blockers: [card('rhino')] },
      { unit: card('avacyn'), target: 1, blockers: [card('wurm')] },
    ]);
    expect(deathsOf(result)).toEqual(['1:wurm']);
  });

  test('Nylea hands trample to the others, not to herself', () => {
    const { result } = fight(table({ cards: { nylea: NYLEA, rhino: RHINO } }, { cards: { bear: BEAR, ogre: OGRE } }), [
      { unit: card('nylea'), target: 1, blockers: [card('bear')] },
      { unit: card('rhino'), target: 1, blockers: [card('ogre')] },
    ]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -3 }]); // the rhino's 5 − 2; Nylea's 6 all stay on the bear
    expect(result.attacks.map((a) => a.toPlayer)).toEqual([0, 3]);
  });

  test('a creature with 0 toughness that is dealt nothing survives, and the app never kills what it reads below 1', () => {
    const savage = rec('Force of Savagery', '8', '0', 'Trample');
    const { result } = fight(table({ cards: { savage } }, { cards: { wall: WALL_OF_OMENS, bear: BEAR } }), [
      { unit: card('savage'), target: 1, blockers: [card('wall')] },
    ]);
    expect(deathsOf(result)).toEqual(['1:wall']); // dealt 0 by the wall: 0 >= 0 kills nothing
    const hit = fight(table({ cards: { savage } }, { cards: { bear: BEAR } }), [
      { unit: card('savage'), target: 1, blockers: [card('bear')] },
    ]);
    expect(deathsOf(hit.result)).toEqual(['1:bear']); // 2 damage on toughness 0: something keeps it alive that the app cannot see
  });

  test('negative power deals nothing', () => {
    const rumbler = rec('Char-Rumbler', '-1', '3', 'Double strike');
    const { result } = fight(table({ cards: { rumbler } }, { cards: {} }), [{ unit: card('rumbler'), target: 1 }]);
    expect(result.outcome).toEqual({ players: [], deaths: [] });
  });
});

describe('poison', () => {
  test('infect: its damage to a player is that many poison counters and no life', () => {
    const { result } = fight(table({ cards: { colossus: BLIGHTSTEEL } }, { cards: {} }), [
      { unit: card('colossus'), target: 1 },
    ]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: 0, poison: 11 }]);
    expect(result.defenders).toEqual([{ seat: 1, commanders: [], other: 0, poison: 11 }]);
    expect(result.infectOnCreatures).toBe(false);
  });

  test('an infect commander: poison and the gauge, no life', () => {
    const t = table({ cards: { skithiryx: SKITHIRYX } }, { cards: {} });
    t.g = { ...t.g, players: t.g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, cmd: { skithiryx: 0 } } } : p)) };
    const { g, result } = fight(t, [{ unit: card('skithiryx'), target: 1 }]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: 0, commander: { p0: 4 }, poison: 4 }]);
    expect(result.defenders).toEqual([{ seat: 1, commanders: [{ key: 'p0', damage: 4, life: 0 }], other: 0, poison: 4 }]);
    const after = applyCombat(g, 'c1', result.outcome);
    expect(after.players[1]).toMatchObject({ life: 40, commanderDamage: { p0: 4 } });
    expect(after.players[1].counters.poison).toBe(4);
  });

  test('infect damage to creatures is treated as ordinary damage, and flagged so the screen can say so', () => {
    const { result } = fight(table({ cards: { skithiryx: SKITHIRYX } }, { cards: { rhino: RHINO } }), [
      { unit: card('skithiryx'), target: 1, blockers: [card('rhino')] },
    ]);
    expect(result.infectOnCreatures).toBe(true);
    expect(deathsOf(result)).toEqual(['0:skithiryx']); // 4 on a 5/5: it lives, at full size
    expect(result.outcome.players).toEqual([]);
  });

  test('toxic: N poison on top of the normal damage, only when it dealt damage to the player', () => {
    const unblocked = fight(table({ cards: { beast: CONTAMINATOR } }, { cards: {} }), [{ unit: card('beast'), target: 1 }]);
    expect(unblocked.result.outcome.players).toEqual([{ seat: 1, life: -4, poison: 1 }]);
    const soaked = fight(table({ cards: { beast: CONTAMINATOR } }, { cards: { rhino: RHINO } }), [
      { unit: card('beast'), target: 1, blockers: [card('rhino')] },
    ]);
    expect(soaked.result.outcome.players).toEqual([]); // 4 into a 5/5: nothing tramples over, no poison
    const over = fight(table({ cards: { beast: CONTAMINATOR } }, { cards: { bear: BEAR } }), [
      { unit: card('beast'), target: 1, blockers: [card('bear')] },
    ]);
    expect(over.result.outcome.players).toEqual([{ seat: 1, life: -2, poison: 1 }]);
  });

  test('toxic on a stack: every copy that connects gives its poison', () => {
    const { result } = fight(
      table({ tracker: true, stacks: [tokens('mites', 3, 1, 1, { oracleText: 'Toxic 1' })] }, { tracker: true }),
      [{ unit: stack('mites'), n: 3, target: 1 }],
    );
    expect(result.outcome.players).toEqual([{ seat: 1, life: -3, poison: 3 }]);
  });
});

describe('what the app cannot read', () => {
  test('an unread attacker deals nothing by itself, is never killed, and is named', () => {
    const { result } = fight(table({ cards: { goyf: TARMOGOYF, late: 'pending', lost: null, ghave: GHAVE } }, { cards: { rhino: RHINO } }), [
      { unit: card('goyf'), target: 1 },
      { unit: card('late'), target: 1 },
      { unit: card('lost'), target: 1 },
      { unit: card('ghave'), target: 1, blockers: [card('rhino')] },
    ]);
    expect(result.outcome).toEqual({ players: [], deaths: [] }); // Ghave took 5 on "0 toughness" and is not killed
    expect(result.unread.map((u) => u.name)).toEqual(['Tarmogoyf', 'late', 'lost', 'Ghave, Guru of Spores']);
    expect(result.attacks.every((a) => a.unread)).toBe(true);
  });

  test('an unread blocker neither kills nor dies, and soaks up what reaches it — even from a trampler', () => {
    const trampler = rec('Trampler', '7', '7', 'Trample');
    const { result } = fight(table({ cards: { big: trampler } }, { cards: { goyf: TARMOGOYF } }), [
      { unit: card('big'), target: 1, blockers: [card('goyf')] },
    ]);
    expect(result.outcome).toEqual({ players: [], deaths: [] }); // its toughness is unknown: nothing can be called excess
    expect(result.unread).toEqual([{ seat: 1, unit: card('goyf'), name: 'Tarmogoyf' }]);
    // deathtouch needs no toughness: one point is lethal, the rest tramples — but the unread blocker is still not killed
    const basilisk = rec('Trampling Basilisk', '4', '4', 'Deathtouch, trample');
    const touch = fight(table({ cards: { basilisk } }, { cards: { goyf: TARMOGOYF } }), [
      { unit: card('basilisk'), target: 1, blockers: [card('goyf')] },
    ]);
    expect(touch.result.outcome).toEqual({ players: [{ seat: 1, life: -3 }], deaths: [] });
  });

  test('unread is about trust, not about zeros: a known toughness under a star power is not killed either', () => {
    // Adeline is */4: the app knows the 4 and still cannot say what she is
    const { result } = fight(table({ cards: { adeline: ADELINE } }, { cards: { rhino: RHINO } }), [
      { unit: card('adeline'), target: 1, blockers: [card('rhino')] },
    ]);
    expect(result.outcome).toEqual({ players: [], deaths: [] }); // 5 damage on "toughness 4": Review decides
    expect(result.unread.map((u) => u.name)).toEqual(['Adeline, Resplendent Cathar']);
  });

  test('…and a known power beside a toughness the app cannot read deals nothing by itself', () => {
    const odd = rec('Half-Read', '3', '*');
    const { result } = fight(table({ cards: { odd, other: odd } }, { cards: { bear: BEAR } }), [
      { unit: card('odd'), target: 1 },
      { unit: card('other'), target: 1, blockers: [card('bear')] },
    ]);
    expect(result.outcome).toEqual({ players: [], deaths: [] });
    expect(result.attacks[0]).toMatchObject({ unread: true, power: 3, toPlayer: 0 });
  });

  test('typed in with counters, the same card fights at that size', () => {
    const t = table({ cards: { goyf: TARMOGOYF }, wear: { goyf: { counters: { p1p1: 4 } } } }, { cards: { bear: BEAR } });
    const { result } = fight(t, [{ unit: card('goyf'), target: 1, blockers: [card('bear')] }]);
    expect(deathsOf(result)).toEqual(['1:bear']);
    expect(result.unread).toEqual([]);
  });

  test('a stack with no size that was sent in anyway is unread too', () => {
    const { result } = fight(table({ tracker: true, stacks: [tokens('treasure', 2, null, null)] }, { tracker: true }), [
      { unit: stack('treasure'), n: 2, target: 1 },
    ]);
    expect(result.outcome).toEqual({ players: [], deaths: [] });
    expect(result.unread.map((u) => u.name)).toEqual(['treasure']);
  });

  test('a card that is no creature but was sent in anyway fights with its printed size: a crewed Vehicle', () => {
    const { result } = fight(table({ cards: { copter: COPTER } }, { cards: {} }), [{ unit: card('copter'), target: 1 }]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -3 }]);
  });

  test('a combat that makes no sense resolves to nothing instead of throwing', () => {
    const t = table({ cards: { bear: BEAR } }, { cards: {} });
    for (const attacks of [
      undefined,
      [null],
      [{ unit: null, target: 1 }],
      [{ unit: card('bear'), target: 9 }],
      [{ unit: card('bear'), target: 1, blockers: [null] }],
      [{ unit: card('bear'), target: 1, n: -3 }],
    ]) {
      const g = { ...t.g, combat: { id: 'c1', turn: 1, active: 0, step: 'damage', attacks } } as unknown as GameState;
      expect(() => resolveCombat(g, g.combat!, t.records)).not.toThrow();
    }
    expect(resolveCombat(t.g, null as never, t.records).outcome).toEqual({ players: [], deaths: [] });
  });
});

describe('stacks', () => {
  /** Nathan: five 1/1 soldiers. Sam: a bear and three 1/1 saprolings. */
  const soldiersVs = () => table({ tracker: true, stacks: [tokens('soldiers', 5, 1, 1, { tapped: 5 })] }, { cards: { bear: BEAR }, stacks: [tokens('saprolings', 3, 1, 1)] });

  test('five attack, two are blocked by a card and a stack copy, two die: the right count and the right taps', () => {
    const { g, result } = fight(soldiersVs(), [
      { unit: stack('soldiers'), n: 5, target: 1, tapped: 5, blockers: [card('bear'), stack('saprolings')] },
    ]);
    // each blocker takes its own soldier: the bear kills one and lives, the saproling trades with one
    expect(result.outcome.players).toEqual([{ seat: 1, life: -3 }]);
    expect(result.outcome.deaths).toEqual([
      { seat: 0, unit: stack('soldiers'), n: 2, tapped: 2 },
      { seat: 1, unit: stack('saprolings'), n: 1 },
    ]);
    expect(result.attacks[0]).toMatchObject({ n: 5, blocked: 2, toPlayer: 3, dies: 2 });
    expect(result.attacks[0].blockers.map((b) => [b.name, b.n, b.dies])).toEqual([
      ['Grizzly Bears', 1, 0],
      ['saprolings', 1, 1],
    ]);
    const after = applyCombat(g, 'c1', result.outcome);
    expect(after.players[0].board[0]).toMatchObject({ count: 3, tapped: 3 }); // the three that got through
    expect(after.players[1].board[0]).toMatchObject({ count: 2 });
  });

  test('attackers with vigilance die untapped: nothing comes off the tapped count', () => {
    const t = table({ tracker: true, stacks: [tokens('soldiers', 5, 1, 1, { tapped: 1 })] }, { cards: { bear: BEAR } });
    const { result } = fight(t, [{ unit: stack('soldiers'), n: 3, target: 1, blockers: [card('bear')] }]);
    expect(result.outcome.deaths).toEqual([{ seat: 0, unit: stack('soldiers'), n: 1 }]);
  });

  test('several copies of one stack blocking one card all hit it, and die one by one', () => {
    const { result } = fight(table({ cards: { giant: GIANT } }, { tracker: true, stacks: [tokens('saprolings', 4, 1, 1)] }), [
      { unit: card('giant'), target: 1, blockers: [{ kind: 'stack', id: 'saprolings', n: 4 }] },
    ]);
    // 3 power: one each to the first two, the rest on the last one it reaches… lethal to each in turn
    expect(result.outcome.deaths).toEqual([
      { seat: 0, unit: card('giant') },
      { seat: 1, unit: stack('saprolings'), n: 3 },
    ]);
  });

  test('one stack attacking two players is two attacks, and its dead are counted together', () => {
    const t = table({ tracker: true, stacks: [tokens('soldiers', 5, 1, 1, { tapped: 5 })] }, { cards: { bear: BEAR } }, { cards: { ogre: OGRE } });
    const { result } = fight(t, [
      { unit: stack('soldiers'), n: 3, target: 1, tapped: 3, blockers: [card('bear')] },
      { unit: stack('soldiers'), n: 2, target: 2, tapped: 2, blockers: [card('ogre')] },
    ]);
    expect(result.outcome.players).toEqual([
      { seat: 1, life: -2 },
      { seat: 2, life: -1 },
    ]);
    expect(result.outcome.deaths).toEqual([{ seat: 0, unit: stack('soldiers'), n: 2, tapped: 2 }]);
  });

  test('a stack that shrank mid-combat has lost its unblocked copies first, and is flagged', () => {
    const t = soldiersVs();
    t.g = { ...t.g, players: t.g.players.map((p, i) => (i === 0 ? { ...p, board: [tokens('soldiers', 3, 1, 1, { tapped: 3 })] } : p)) };
    const { result } = fight(t, [
      { unit: stack('soldiers'), n: 5, target: 1, tapped: 5, blockers: [card('bear'), stack('saprolings')] },
    ]);
    // three are left: the two that were blocked, and one that got through
    expect(result.attacks[0]).toMatchObject({ n: 3, blocked: 2, toPlayer: 1, check: true });
    expect(result.outcome.players).toEqual([{ seat: 1, life: -1 }]);
    expect(result.check).toEqual([{ seat: 0, unit: stack('soldiers'), name: 'soldiers' }]);
    expect(result.outcome.deaths).toEqual([
      { seat: 0, unit: stack('soldiers'), n: 2, tapped: 2 },
      { seat: 1, unit: stack('saprolings'), n: 1 },
    ]);
  });

  test('a stack that shrank below its blocked copies loses the last-blocked ones, whose blockers then fight nobody', () => {
    const t = soldiersVs();
    t.g = { ...t.g, players: t.g.players.map((p, i) => (i === 0 ? { ...p, board: [tokens('soldiers', 1, 1, 1, { tapped: 1 })] } : p)) };
    const { result } = fight(t, [
      { unit: stack('soldiers'), n: 5, target: 1, tapped: 5, blockers: [card('bear'), stack('saprolings')] },
    ]);
    expect(result.attacks[0]).toMatchObject({ n: 1, blocked: 1, toPlayer: 0, check: true });
    expect(result.outcome.deaths).toEqual([{ seat: 0, unit: stack('soldiers'), n: 1, tapped: 1 }]); // the bear got it; the saproling is fine
  });

  test('a stack attacking two players that shrank loses its unblocked copies first, wherever they are', () => {
    // 3 at Sam, nobody in their way; 2 at Alex, both blocked. Two soldiers have left since.
    const t = table(
      { tracker: true, stacks: [tokens('soldiers', 3, 1, 1, { tapped: 3 })] },
      { tracker: true },
      { cards: { bear: BEAR, ogre: OGRE } },
    );
    const { result } = fight(t, [
      { unit: stack('soldiers'), n: 3, target: 1, tapped: 3 },
      { unit: stack('soldiers'), n: 2, target: 2, tapped: 2, blockers: [card('bear'), card('ogre')] },
    ]);
    expect(result.attacks.map((a) => [a.n, a.blocked, a.toPlayer])).toEqual([
      [1, 0, 1], // two of the three that were getting through are the ones that left
      [2, 2, 0], // the blocked ones are still there, and still blocked
    ]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -1 }]);
    expect(result.outcome.deaths).toEqual([{ seat: 0, unit: stack('soldiers'), n: 2, tapped: 2 }]);
    expect(result.attacks.every((a) => a.check)).toBe(true);
  });

  test('…then the copies a paper card stopped, and only then the ones a blocker on the tablet took', () => {
    // 2 at Sam, stopped by a paper blocker; 2 at Alex, both blocked on the tablet. One is left.
    const t = table(
      { tracker: true, stacks: [tokens('soldiers', 1, 1, 1)] },
      { tracker: true },
      { cards: { bear: BEAR, ogre: OGRE } },
    );
    const { result } = fight(t, [
      { unit: stack('soldiers'), n: 2, target: 1, blocked: true },
      { unit: stack('soldiers'), n: 2, target: 2, blockers: [card('bear'), card('ogre')] },
    ]);
    expect(result.attacks.map((a) => [a.n, a.blocked])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(result.outcome.deaths).toEqual([{ seat: 0, unit: stack('soldiers'), n: 1 }]); // the bear's
  });

  test('a stack that keeps enough copies is not touched: the ones that left stayed home', () => {
    const t = table({ tracker: true, stacks: [tokens('soldiers', 4, 1, 1)] }, { tracker: true });
    const { result } = fight(t, [{ unit: stack('soldiers'), n: 3, target: 1 }]);
    expect(result.attacks[0].check).toBeUndefined();
    expect(result.check).toEqual([]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -3 }]);
  });

  test('a blocking stack that shrank loses its last-declared blocks; what it was blocking stays blocked', () => {
    const t = table({ cards: { bear: BEAR, ogre: OGRE } }, { tracker: true, stacks: [tokens('saprolings', 1, 1, 1)] });
    const { result } = fight(t, [
      { unit: card('bear'), target: 1, blockers: [stack('saprolings')] },
      { unit: card('ogre'), target: 1, blockers: [stack('saprolings')] },
    ]);
    expect(result.outcome.players).toEqual([]); // the ogre was blocked when blockers were declared: nothing gets through
    expect(result.outcome.deaths).toEqual([{ seat: 1, unit: stack('saprolings'), n: 1 }]);
    expect(result.check).toEqual([{ seat: 1, unit: stack('saprolings'), name: 'saprolings' }]);
    expect(result.attacks.map((a) => a.blockers[0].n)).toEqual([1, 0]);
  });

  test('the copies of a stack that says "other creatures you control have …" hand it to each other', () => {
    const lords = tokens('lords', 2, 2, 2, { oracleText: 'Other creatures you control have trample.' });
    const { result } = fight(table({ tracker: true, stacks: [lords] }, { cards: { wall: WALL_OF_OMENS } }), [
      { unit: stack('lords'), n: 1, target: 1, blockers: [card('wall')] },
    ]);
    expect(result.attacks[0].granted).toEqual(['trample']);
    const alone = fight(table({ tracker: true, stacks: [{ ...lords, count: 1 }] }, { cards: { wall: WALL_OF_OMENS } }), [
      { unit: stack('lords'), n: 1, target: 1, blockers: [card('wall')] },
    ]);
    expect(alone.result.attacks[0].granted).toEqual([]);
  });
});

describe('blocked by what is not there', () => {
  test('the paper mark: nothing to the player, nothing dies', () => {
    const { result } = fight(table({ cards: { giant: GIANT } }, { tracker: true }), [
      { unit: card('giant'), target: 1, blocked: true },
    ]);
    expect(result.outcome).toEqual({ players: [], deaths: [] });
    expect(result.attacks[0]).toMatchObject({ blocked: 1, paper: true, toPlayer: 0 });
  });

  test('the paper mark stops a trampler too: the app cannot know how much is excess', () => {
    const trampler = rec('Trampler', '7', '7', 'Trample');
    const { result } = fight(table({ cards: { big: trampler } }, { tracker: true }), [
      { unit: card('big'), target: 1, blocked: true },
    ]);
    expect(result.outcome).toEqual({ players: [], deaths: [] });
  });

  test('on a stack attack the paper mark stops every copy the tablet’s blockers did not take', () => {
    const { result } = fight(table({ tracker: true, stacks: [tokens('soldiers', 4, 1, 1)] }, { cards: { bear: BEAR } }), [
      { unit: stack('soldiers'), n: 4, target: 1, blocked: true, blockers: [card('bear')] },
    ]);
    expect(result.outcome.players).toEqual([]);
    expect(result.outcome.deaths).toEqual([{ seat: 0, unit: stack('soldiers'), n: 1 }]);
    expect(result.attacks[0]).toMatchObject({ blocked: 4, paper: true });
  });

  test('a blocker that left: the attacker is still blocked — nothing without trample, everything with it', () => {
    const plain = fight(table({ cards: { giant: GIANT } }, { cards: {} }), [
      { unit: card('giant'), target: 1, blockers: [card('sacrificed')] },
    ]);
    expect(plain.result.outcome).toEqual({ players: [], deaths: [] });
    expect(plain.result.attacks[0]).toMatchObject({ blocked: 1, toPlayer: 0 });
    expect(plain.result.attacks[0].blockers[0]).toMatchObject({ present: false, dies: 0 });
    const trampler = rec('Trampler', '7', '7', 'Trample');
    const over = fight(table({ cards: { big: trampler } }, { cards: {} }), [
      { unit: card('big'), target: 1, blockers: [card('sacrificed')] },
    ]);
    expect(over.result.outcome.players).toEqual([{ seat: 1, life: -7 }]);
  });

  test('one of two blockers left: the other takes it all', () => {
    const { result } = fight(table({ cards: { wurm: WURM } }, { cards: { giant: GIANT } }), [
      { unit: card('wurm'), target: 1, blockers: [card('sacrificed'), card('giant')] },
    ]);
    expect(deathsOf(result)).toEqual(['1:giant']); // 6 on the giant, 3 back on a 6/4
  });

  test('an attacker that left is skipped, and so is the blocker that was in its way', () => {
    const { result } = fight(table({ cards: { giant: GIANT } }, { cards: { bear: BEAR } }), [
      { unit: card('bounced'), target: 1, blockers: [card('bear')] },
      { unit: card('giant'), target: 1 },
    ]);
    expect(result.outcome).toEqual({ players: [{ seat: 1, life: -3 }], deaths: [] });
    expect(result.attacks[0]).toMatchObject({ present: false, toPlayer: 0 });
    expect(result.attacks[0].blockers[0]).toMatchObject({ present: true, dies: 0 });
  });
});

describe('commander damage', () => {
  test('a partner pair: each commander’s damage goes to its own key, handed out by instance id', () => {
    // dealt Thrasios first, but "aa-tymna" sorts before "zz-thrasios": she has the plain key
    const t = table({ cards: { 'zz-thrasios': rec('Thrasios, Triton Hero', '1', '3'), 'aa-tymna': rec('Tymna the Weaver', '2', '2'), bear: BEAR } }, { cards: {} });
    const seat = (cmd: Record<string, number>) => ({
      ...t.g,
      players: t.g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, cmd } } : p)),
    });
    for (const g of [seat({ 'zz-thrasios': 0, 'aa-tymna': 0 }), seat({ 'aa-tymna': 0, 'zz-thrasios': 0 })]) {
      const { result } = fight({ g, records: t.records }, [
        { unit: card('zz-thrasios'), target: 1 },
        { unit: card('aa-tymna'), target: 1 },
        { unit: card('bear'), target: 1 },
      ]);
      expect(result.outcome.players).toEqual([{ seat: 1, life: -5, commander: { 'p0#2': 1, p0: 2 } }]);
      expect(result.defenders).toEqual([
        {
          seat: 1,
          commanders: [
            { key: 'p0#2', damage: 1, life: 1 },
            { key: 'p0', damage: 2, life: 2 },
          ],
          other: 2,
          poison: 0,
        },
      ]);
      expect(result.attacks.map((a) => a.commander)).toEqual(['p0#2', 'p0', null]);
    }
  });

  test('a dying commander goes home by default; any other creature of that seat dies an ordinary death', () => {
    const t = table({ cards: { cmd: BEAR, other: BEAR } }, { cards: { a: GIANT, b: GIANT } });
    t.g = { ...t.g, players: t.g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, cmd: { cmd: 0 } } } : p)) };
    const { g, result } = fight(t, [
      { unit: card('cmd'), target: 1, blockers: [card('a')] },
      { unit: card('other'), target: 1, blockers: [card('b')] },
    ]);
    expect(result.outcome.deaths).toEqual([
      { seat: 0, unit: card('cmd'), toCommand: true },
      { seat: 0, unit: card('other') },
    ]);
    const after = applyCombat(g, 'c1', result.outcome);
    expect(after.players[0].cards!.command.map((c) => c.iid)).toEqual(['cmd']);
    expect(after.players[0].cards!.cmd).toEqual({ cmd: 1 });
    expect(after.players[0].cards!.graveyard.map((c) => c.iid)).toEqual(['other']);
  });

  test('a tracker seat: the tile named like the profile’s commander deals commander damage, and goes home when it dies', () => {
    const base = table({ tracker: true, stacks: [tokens('Atraxa, Praetors’ Voice', 1, 4, 4), tokens('soldiers', 2, 1, 1)] }, { tracker: true, stacks: [tokens('wall', 1, 0, 9), tokens('ogres', 1, 5, 5)] });
    const g0: GameState = {
      ...base.g,
      config: {
        ...base.g.config,
        profiles: base.g.config.profiles.map((p, i) => (i === 0 ? { ...p, commanderName: 'Atraxa, Praetors’ Voice' } : p)),
      },
    };
    const hit = fight({ g: g0, records: base.records }, [
      { unit: stack('Atraxa, Praetors’ Voice'), target: 1 },
      { unit: stack('soldiers'), n: 2, target: 1 },
    ]);
    expect(hit.result.outcome.players).toEqual([{ seat: 1, life: -6, commander: { p0: 4 } }]);
    expect(hit.result.defenders[0]).toEqual({ seat: 1, commanders: [{ key: 'p0', damage: 4, life: 4 }], other: 2, poison: 0 });
    const dies = fight({ g: g0, records: base.records }, [
      { unit: stack('Atraxa, Praetors’ Voice'), target: 1, tapped: 1, blockers: [stack('ogres')] },
    ]);
    expect(dies.result.outcome.deaths).toEqual([{ seat: 0, unit: stack('Atraxa, Praetors’ Voice'), n: 1, tapped: 1, toCommand: true }]);
    const after = applyCombat(dies.g, 'c1', dies.result.outcome);
    expect(after.players[0].board.map((it) => it.name)).toEqual(['soldiers']);
    expect(after.players[0].commanderDeaths).toBe(1);
  });

  test('commander damage that would be lethal shows in what the outcome defeats', () => {
    const t = table({ cards: { cmd: rec('Big Commander', '21', '21') } }, { cards: {} });
    t.g = { ...t.g, players: t.g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, cmd: { cmd: 0 } } } : p)) };
    const { g, result } = fight(t, [{ unit: card('cmd'), target: 1 }]);
    expect(result.outcome.players).toEqual([{ seat: 1, life: -21, commander: { p0: 21 } }]);
    expect(outcomeDefeats(g, result.outcome)).toEqual([1]); // 19 life left, and out
  });
});

describe('a pod', () => {
  test('each defender gets their own split, and life gained is per seat', () => {
    const t = table(
      { cards: { hawk: NIGHTHAWK, giant: GIANT, wurmcoil: WURMCOIL } },
      { cards: { bear: BEAR } },
      { cards: { angel: SERRA_ANGEL } },
      { tracker: true },
    );
    const { result } = fight(t, [
      { unit: card('hawk'), target: 1 },
      { unit: card('giant'), target: 2, blockers: [card('angel')] },
      { unit: card('wurmcoil'), target: 3 },
    ]);
    expect(result.defenders).toEqual([
      { seat: 1, commanders: [], other: 2, poison: 0 },
      { seat: 2, commanders: [], other: 0, poison: 0 },
      { seat: 3, commanders: [], other: 6, poison: 0 },
    ]);
    expect(result.gains).toEqual([{ seat: 0, life: 8 }]);
    expect(result.outcome.players).toEqual([
      { seat: 1, life: -2 },
      { seat: 3, life: -6 },
      { seat: 0, life: 8 },
    ]);
    expect(deathsOf(result)).toEqual(['0:giant']);
  });
});
