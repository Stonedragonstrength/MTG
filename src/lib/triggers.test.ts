import { expect, test } from 'vitest';
import { createGame } from './game';
import { confirmAttackers, finishBlocks, setAttack, setBlock, startCombat } from './combat';
import {
  actsOf,
  arrivalsBetween,
  entersTriggers,
  firedBy,
  happeningsBetween,
  readTriggers,
  stillHappened,
  type Arrival,
  type Happening,
} from './triggers';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from './types';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

function rec(id: string, name: string, typeLine: string, oracleText = '', more: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
    ...more,
  };
}

const RECORDS: Record<string, CardRecord> = {
  storm: rec('storm', 'Encroaching Dragonstorm', 'Enchantment', "When this enchantment enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.\nWhen a Dragon you control enters, return this enchantment to its owner's hand."),
  dragon: rec('dragon', 'Shivan Dragon', 'Creature — Dragon', 'Flying', { colors: ['R'] }),
  bear: rec('bear', 'Grizzly Bears', 'Creature — Bear', '', { colors: ['G'] }),
  warden: rec('warden', 'Soul Warden', 'Creature — Human Cleric', 'Whenever another creature enters, you gain 1 life.'),
  visionary: rec('visionary', 'Elvish Visionary', 'Creature — Elf Shaman', 'When this creature enters, draw a card.'),
  forest: rec('forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  mystic: rec('mystic', 'Lotus Cobra', 'Creature — Snake', 'Landfall — Whenever a land you control enters, add one mana of any color.'),
  jaddi: rec('jaddi', 'Jaddi Offshoot', 'Creature — Plant', 'Defender\nLandfall — Whenever a land you control enters, you gain 1 life.'),
  priest: rec('priest', 'Suture Priest', 'Creature — Phyrexian Cleric', 'Whenever another creature you control enters, you may gain 1 life.\nWhenever a creature an opponent controls enters, you may have that player lose 1 life.'),
};

const seat = (battlefield: CardInstance[]) => ({
  library: [],
  hand: [],
  battlefield,
  graveyard: [],
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'Test',
});
const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });
const soldiers = (count: number, id = 'soldiers'): BoardItem => ({
  id,
  cardId: null,
  name: 'Soldier',
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature — Soldier',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count,
  counters: {},
  color: null,
  zone: 'board',
});

function table(mine: CardInstance[], theirs: CardInstance[] = [], board: BoardItem[] = []): GameState {
  const g = createGame(config);
  g.players[0] = { ...g.players[0], cards: seat(mine), board };
  g.players[1] = { ...g.players[1], cards: seat(theirs) };
  return g;
}

// ---- what has entered ----

test('a card that was not on the battlefield before has entered', () => {
  const before = table([card('f1', 'forest')]);
  const after = table([card('f1', 'forest'), card('d1', 'dragon')]);
  expect(arrivalsBetween(before, after)).toEqual([
    { seat: 0, kind: 'card', id: 'd1', cardId: 'dragon', name: 'Shivan Dragon', n: 1 },
  ]);
  expect(arrivalsBetween(after, before)).toEqual([]); // leaving is not entering
  expect(arrivalsBetween(after, after)).toEqual([]);
});

test('a stack that gained copies has that many arrivals; a new stack, all of its copies', () => {
  const none = table([]);
  const two = table([], [], [soldiers(2)]);
  const five = table([], [], [soldiers(5)]);
  expect(arrivalsBetween(none, two).map((a) => [a.kind, a.id, a.n, a.typeLine])).toEqual([
    ['stack', 'soldiers', 2, 'Token Creature — Soldier'],
  ]);
  expect(arrivalsBetween(two, five).map((a) => a.n)).toEqual([3]);
  expect(arrivalsBetween(five, two)).toEqual([]);
});

test('a stack split in two has gained nothing', () => {
  const whole = table([], [], [soldiers(5)]);
  const split = table([], [], [soldiers(3), soldiers(2, 'more')]);
  expect(arrivalsBetween(whole, split)).toEqual([]);
  // …but split AND one more is one arrival.
  const grown = table([], [], [soldiers(3), soldiers(3, 'more')]);
  expect(arrivalsBetween(whole, grown).map((a) => a.n)).toEqual([1]);
});

// ---- what a card waits for ----

test('"When this creature enters" waits for the card itself', () => {
  expect(entersTriggers(RECORDS.visionary)).toEqual([
    { text: 'When this creature enters, draw a card.', event: 'enters', self: true, other: null, unsure: false, may: false, effect: 'draw a card.' },
  ]);
});

test('a card that names itself, in full or by its first name, is waiting for itself', () => {
  const full = rec('a', 'Atraxa, Grand Unifier', 'Legendary Creature', 'When Atraxa, Grand Unifier enters, you gain 2 life.');
  const first = rec('k', 'Kenrith, the Returned King', 'Legendary Creature', 'When Kenrith enters the battlefield, draw a card.');
  expect(entersTriggers(full)[0]).toMatchObject({ self: true, other: null });
  expect(entersTriggers(first)[0]).toMatchObject({ self: true, other: null });
});

test('"When a Dragon you control enters" waits for something else, of yours, of that kind', () => {
  const [search, dragon] = entersTriggers(RECORDS.storm);
  expect(search).toMatchObject({ self: true, other: null });
  expect(dragon).toMatchObject({
    self: false,
    other: { whose: 'you', kinds: [['dragon']], another: false },
    unsure: false,
    may: false,
  });
});

test('whose it has to be: yours, an opponent’s, or anybody’s', () => {
  expect(entersTriggers(RECORDS.warden)[0].other).toEqual({ whose: 'any', kinds: [['creature']], another: true, once: false });
  const [mine, theirs] = entersTriggers(RECORDS.priest);
  expect(mine.other).toEqual({ whose: 'you', kinds: [['creature']], another: true, once: false });
  expect(mine.may).toBe(true);
  expect(theirs.other).toEqual({ whose: 'opponent', kinds: [['creature']], another: false, once: false });
  const old = rec('o', 'Old', 'Enchantment', 'Whenever a creature enters the battlefield under your control, you gain 1 life.');
  expect(entersTriggers(old)[0].other?.whose).toBe('you');
});

test('an ability word in front, several kinds, "enters or attacks": all read', () => {
  expect(entersTriggers(RECORDS.jaddi)[0].other).toEqual({ whose: 'you', kinds: [['land']], another: false, once: false });
  const either = rec('e', 'Either', 'Enchantment', 'Whenever an artifact or nontoken creature you control enters, draw a card.');
  expect(entersTriggers(either)[0].other?.kinds).toEqual([['artifact'], ['nontoken', 'creature']]);
  const both = rec('c', 'Grim Guardian', 'Enchantment Creature', 'Constellation — Whenever this creature or another enchantment you control enters, you gain 2 life.');
  expect(entersTriggers(both)[0]).toMatchObject({ self: true, other: { whose: 'you', kinds: [['enchantment']], another: true } });
  const attacks = rec('t', 'Raider', 'Creature', 'Whenever this creature enters or attacks, create a Treasure token.');
  expect(entersTriggers(attacks)[0]).toMatchObject({ self: true, effect: 'create a Treasure token.' });
});

test('a condition the table cannot check makes it unsure; reminder text is not part of the ability', () => {
  const big = rec('b', 'Big', 'Enchantment', 'Whenever a creature you control with power 4 or greater enters, draw a card.');
  expect(entersTriggers(big)[0]).toMatchObject({ unsure: true, other: { kinds: [['creature']] } });
  const iff = rec('i', 'Iff', 'Creature', 'When this creature enters, if you control another Elf, draw a card.');
  expect(entersTriggers(iff)[0].unsure).toBe(true);
  const reminded = rec('r', 'Reminded', 'Creature', 'When this creature enters, you gain 3 life. (If it helps.)');
  expect(entersTriggers(reminded)[0]).toMatchObject({ text: 'When this creature enters, you gain 3 life.', unsure: false });
});

test('a card named by the start of its name is waiting for itself', () => {
  const rosie = rec('r', 'Rosie Cotton of South Lane', 'Legendary Creature', 'When Rosie Cotton enters, create a Food token.');
  expect(entersTriggers(rosie)[0]).toMatchObject({ self: true, other: null });
  const fili = rec('f', 'Fíli the Pathfinder', 'Legendary Creature', 'Whenever Fíli or another nontoken Dwarf you control enters, create a 2/2 red Dwarf creature token.');
  expect(entersTriggers(fili)[0]).toMatchObject({ self: true, other: { kinds: [['nontoken', 'dwarf']], another: true } });
});

test('what happens later, or a number worked out, is never done unasked', () => {
  const later = rec('v', 'Vampirism', 'Enchantment — Aura', "When this Aura enters, draw a card at the beginning of the next turn's upkeep.");
  expect(actsOf(entersTriggers(later)[0])).toMatchObject([{ label: 'Draw 1', auto: false }]);
  const worked = rec('m', 'Moldgraf Millipede', 'Creature', 'When this creature enters, mill three cards, then put a +1/+1 counter on this creature for each creature card in your graveyard.');
  expect(actsOf(entersTriggers(worked)[0])).toEqual([]);
  const plain = rec('u', 'Urborg Scavengers', 'Creature', 'Whenever this creature enters or attacks, exile target card from a graveyard. Put a +1/+1 counter on this creature.');
  expect(actsOf(entersTriggers(plain)[0])).toMatchObject([{ kind: 'grow', n: 1, auto: true }]);
  const chosen = rec('b', 'Bloodline Pretender', 'Artifact Creature', 'Whenever another creature you control of the chosen type enters, put a +1/+1 counter on this creature.');
  expect(entersTriggers(chosen)[0].unsure).toBe(true);
});

test('only a draw that is plainly its own player’s happens by itself', () => {
  const theirs = rec('c', 'Communal Brewing', 'Enchantment', 'When this enchantment enters, any number of target opponents each draw a card.');
  expect(actsOf(entersTriggers(theirs)[0]).every((a) => !a.auto)).toBe(true);
  const looter = rec('l', 'Looter', 'Creature', 'When this creature enters, discard two cards, then draw two cards.');
  expect(actsOf(entersTriggers(looter)[0])).toMatchObject([{ label: 'Draw 2', auto: true }]);
  const pays = rec('p', 'Payer', 'Creature', 'When this creature enters, you draw a card and you lose 1 life.');
  expect(actsOf(entersTriggers(pays)[0]).map((a) => a.auto)).toEqual([true, true]);
});

test('"one or more … enter" goes off once, however many came in together', () => {
  const swarm = rec('s', 'Cloakwood Swarmkeeper', 'Creature', 'Gathered Swarm — Whenever one or more tokens you control enter, put a +1/+1 counter on this creature.');
  const g = table([{ iid: 'k1', cardId: 's', name: 'Cloakwood Swarmkeeper' }], [], [soldiers(3)]);
  const tokens: Arrival = { seat: 0, kind: 'stack', id: 'soldiers', cardId: null, name: 'Soldier', n: 3, typeLine: 'Token Creature — Soldier' };
  const [fired] = firedBy(g, enters([tokens]), { s: swarm });
  expect(fired.times).toBe(1);
  expect(actsOf(fired.trigger, fired.times)).toMatchObject([{ kind: 'grow', n: 1 }]);
});

test('abilities that are not about entering are not read', () => {
  expect(entersTriggers(RECORDS.dragon)).toEqual([]);
  expect(entersTriggers(rec('x', 'X', 'Creature', 'This creature enters tapped.\nWhenever this creature attacks, draw a card.'))).toEqual([]);
  expect(entersTriggers(rec('y', 'Y', 'Creature', 'Whenever you cast a spell, draw a card.'))).toEqual([]);
  expect(entersTriggers(null)).toEqual([]);
});

// ---- what it does ----

test('the card returning to its owner’s hand needs no choice: it happens by itself', () => {
  const [, dragon] = entersTriggers(RECORDS.storm);
  expect(actsOf(dragon)).toEqual([{ key: 'return', label: 'Return it to hand', kind: 'return', auto: true }]);
});

test('the search a card makes as it enters is not offered here: its list already comes up when it is played', () => {
  const [search] = entersTriggers(RECORDS.storm);
  expect(actsOf(search)).toEqual([]);
});

test('life, cards and counters on the card itself happen by themselves; "you may" and targets wait for a tap', () => {
  expect(actsOf(entersTriggers(RECORDS.visionary)[0])).toMatchObject([{ kind: 'prompt', label: 'Draw 1', auto: true }]);
  expect(actsOf(entersTriggers(RECORDS.warden)[0])).toMatchObject([{ kind: 'prompt', label: 'Gain 1 life', auto: true }]);
  expect(actsOf(entersTriggers(RECORDS.priest)[0])).toMatchObject([{ label: 'Gain 1 life', auto: false }]); // you may
  const grows = rec('g', 'Grower', 'Creature', 'Whenever another creature you control enters, put a +1/+1 counter on this creature.');
  expect(actsOf(entersTriggers(grows)[0])).toEqual([{ key: 'grow', label: 'Put a +1/+1 counter on it', kind: 'grow', n: 1, auto: true }]);
  const kills = rec('k', 'Killer', 'Creature', 'When this creature enters, destroy target artifact or enchantment.');
  expect(actsOf(entersTriggers(kills)[0])).toMatchObject([{ kind: 'prompt', auto: false, prompt: { kind: 'remove' } }]);
  const unsure = rec('u', 'Unsure', 'Creature', 'When this creature enters, if you control a Forest, you gain 4 life.');
  expect(actsOf(entersTriggers(unsure)[0])).toMatchObject([{ label: 'Gain 4 life', auto: false }]);
});

test('three things entering at once is the effect three times over', () => {
  const [gain] = actsOf(entersTriggers(RECORDS.warden)[0], 3);
  expect(gain).toMatchObject({ label: 'Gain 3 life', auto: true, prompt: { n: 3 } });
  const grows = rec('g', 'Grower', 'Creature', 'Whenever another creature you control enters, put a +1/+1 counter on this creature.');
  expect(actsOf(entersTriggers(grows)[0], 2)[0]).toMatchObject({ kind: 'grow', n: 2, label: 'Put 2 +1/+1 counters on it' });
});

// ---- which cards an arrival sets off ----

const enters = (things: Arrival[]): Happening => ({ kind: 'enters', things });
const arrive = (g: GameState, seatIdx: number, iid: string): Arrival => {
  const c = g.players[seatIdx].cards!.battlefield.find((x) => x.iid === iid)!;
  return { seat: seatIdx, kind: 'card', id: iid, cardId: c.cardId, name: c.name, n: 1 };
};

test('a Dragon entering sets off the Dragonstorm; a bear does not', () => {
  const g = table([card('s1', 'storm'), card('d1', 'dragon'), card('b1', 'bear')]);
  const fired = firedBy(g, enters([arrive(g, 0, 'd1')]), RECORDS);
  expect(fired).toHaveLength(1);
  expect(fired[0]).toMatchObject({
    seat: 0,
    source: { iid: 's1', name: 'Encroaching Dragonstorm' },
    times: 1,
    because: 'Shivan Dragon entered',
    own: false,
  });
  expect(firedBy(g, enters([arrive(g, 0, 'b1')]), RECORDS)).toEqual([]);
});

test('"you control" is the card’s own side: an opponent’s Dragon does not set it off', () => {
  const g = table([card('s1', 'storm')], [card('d9', 'dragon')]);
  expect(firedBy(g, enters([arrive(g, 1, 'd9')]), RECORDS)).toEqual([]);
});

test('a card entering sets off its own "when this enters", and only its own entering', () => {
  const g = table([card('v1', 'visionary'), card('v2', 'visionary')]);
  const fired = firedBy(g, enters([arrive(g, 0, 'v2')]), RECORDS);
  expect(fired.map((f) => [f.source.iid, f.own])).toEqual([['v2', true]]);
});

test('"another creature" never counts the card itself; anybody’s creature counts where the text says so', () => {
  const g = table([card('w1', 'warden'), card('b1', 'bear')], [card('b9', 'bear')]);
  expect(firedBy(g, enters([arrive(g, 0, 'w1')]), RECORDS)).toEqual([]);
  expect(firedBy(g, enters([arrive(g, 0, 'b1')]), RECORDS).map((f) => f.source.iid)).toEqual(['w1']);
  expect(firedBy(g, enters([arrive(g, 1, 'b9')]), RECORDS).map((f) => f.source.iid)).toEqual(['w1']);
});

test('"a creature an opponent controls" is set off by the other side only', () => {
  const g = table([card('p1', 'priest'), card('b1', 'bear')], [card('b9', 'bear')]);
  const mine = firedBy(g, enters([arrive(g, 0, 'b1')]), RECORDS);
  expect(mine.map((f) => f.trigger.other?.whose)).toEqual(['you']);
  const theirs = firedBy(g, enters([arrive(g, 1, 'b9')]), RECORDS);
  expect(theirs.map((f) => f.trigger.other?.whose)).toEqual(['opponent']);
});

test('tokens entering count one by one; a land played is a landfall', () => {
  const g = table([card('w1', 'warden'), card('j1', 'jaddi'), card('f1', 'forest')], [], [soldiers(3)]);
  const tokens: Arrival = { seat: 0, kind: 'stack', id: 'soldiers', cardId: null, name: 'Soldier', n: 3, typeLine: 'Token Creature — Soldier' };
  const fired = firedBy(g, enters([tokens]), RECORDS);
  expect(fired.map((f) => [f.source.iid, f.times, f.because])).toEqual([['w1', 3, 'Soldier ×3 entered']]);
  expect(firedBy(g, enters([arrive(g, 0, 'f1')]), RECORDS).map((f) => f.source.iid)).toEqual(['j1']);
});

test('"nontoken creature" is not set off by a token, and a color has to be known', () => {
  const picky = rec('picky', 'Picky', 'Enchantment', 'Whenever a nontoken creature you control enters, you gain 1 life.\nWhenever a red creature you control enters, you gain 2 life.');
  const records = { ...RECORDS, picky };
  const g = table([{ iid: 'k1', cardId: 'picky', name: 'Picky' }, card('d1', 'dragon'), card('b1', 'bear')], [], [soldiers(1)]);
  const tokens: Arrival = { seat: 0, kind: 'stack', id: 'soldiers', cardId: null, name: 'Soldier', n: 1, typeLine: 'Token Creature — Soldier' };
  expect(firedBy(g, enters([tokens]), records)).toEqual([]);
  expect(firedBy(g, enters([arrive(g, 0, 'b1')]), records).map((f) => f.trigger.other?.kinds)).toEqual([[['nontoken', 'creature']]]);
  expect(firedBy(g, enters([arrive(g, 0, 'd1')]), records)).toHaveLength(2);
});

test('a card this device cannot read waits for nothing and sets nothing off', () => {
  const g = table([card('s1', 'storm'), card('d1', 'dragon')]);
  expect(firedBy(g, enters([arrive(g, 0, 'd1')]), { storm: RECORDS.storm })).toEqual([]);
  expect(firedBy(g, enters([arrive(g, 0, 'd1')]), { dragon: RECORDS.dragon })).toEqual([]);
});

// ---- more than entering: deaths, attacks, casts, the turn ----

const R = (id: string, name: string, typeLine: string, oracleText: string) => rec(id, name, typeLine, oracleText);
// Known to the card helper as well: these sit on the table in the tests below.
const MORE: Record<string, CardRecord> = Object.assign(RECORDS, {
  artist: R('artist', 'Zulaport Cutthroat', 'Creature — Human Rogue', 'Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.'),
  arena: R('arena', 'Phyrexian Arena', 'Enchantment', 'At the beginning of your upkeep, you draw a card and you lose 1 life.'),
  tithe: R('tithe', 'Tithe Taker', 'Creature', "At the beginning of each opponent's end step, create a 1/1 white Spirit creature token with flying."),
  pillager: R('pillager', 'Goblin Rabblemaster', 'Creature — Goblin', 'At the beginning of combat on your turn, create a 1/1 red Goblin creature token.'),
  raider: R('raider', 'Raid Bombardment', 'Enchantment', 'Whenever a creature you control attacks, each opponent loses 1 life.'),
  war: R('war', 'Hellrider', 'Creature', 'Whenever you attack, each opponent loses 1 life.'),
  scavenger: R('scavenger', 'Urborg Scavengers', 'Creature', 'Whenever this creature enters or attacks, put a +1/+1 counter on this creature.'),
  monk: R('monk', 'Monastery Mentor', 'Creature — Human Monk', 'Whenever you cast a noncreature spell, create a 1/1 white Monk creature token.'),
  wizard: R('wizard', 'Archmage Emeritus', 'Creature — Human Wizard', 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.'),
  bolt: R('bolt', 'Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.'),
  bomb: R('bomb', 'Dying Wish', 'Creature', "When this creature dies, return it to its owner's hand."),
});

test('deaths, attacks, casts and the steps of a turn are read, each for the event it waits for', () => {
  expect(readTriggers(MORE.artist).map((t) => [t.event, t.self, t.other?.whose, t.other?.another])).toEqual([['dies', true, 'you', true]]);
  expect(readTriggers(MORE.arena).map((t) => [t.event, t.other?.whose])).toEqual([['upkeep', 'you']]);
  expect(readTriggers(MORE.tithe).map((t) => [t.event, t.other?.whose])).toEqual([['end', 'opponent']]);
  expect(readTriggers(MORE.pillager).map((t) => [t.event, t.other?.whose])).toEqual([['combat', 'you']]);
  expect(readTriggers(MORE.raider).map((t) => [t.event, t.other?.kinds])).toEqual([['attacks', [['creature']]]]);
  expect(readTriggers(MORE.war).map((t) => [t.event, t.other?.once])).toEqual([['attacks', true]]);
  expect(readTriggers(MORE.scavenger).map((t) => t.event)).toEqual(['enters', 'attacks']);
  expect(readTriggers(MORE.monk).map((t) => [t.event, t.other?.kinds])).toEqual([['cast', [['noncreature']]]]);
  expect(readTriggers(MORE.wizard).map((t) => [t.event, t.other?.kinds])).toEqual([['cast', [['instant'], ['sorcery']]]]);
  // A dead card takes no counters; it can go back to hand from its graveyard.
  expect(actsOf(readTriggers(MORE.bomb)[0])).toEqual([{ key: 'return', label: 'Return it to hand', kind: 'return', auto: true }]);
});

test('a creature put into its graveyard has died; one sent to exile has not — both have left the battlefield', () => {
  const before = table([card('b1', 'bear'), card('b2', 'bear')]);
  const after = structuredClone(before);
  const [b1] = after.players[0].cards!.battlefield.splice(0, 1);
  after.players[0].cards!.graveyard.push(b1);
  const [b2] = after.players[0].cards!.battlefield.splice(0, 1);
  after.players[0].cards!.exile.push(b2);
  const bear = (id: string) => ({ seat: 0, kind: 'card', id, cardId: 'bear', name: 'Grizzly Bears', n: 1 });
  expect(happeningsBetween(before, after)).toEqual([
    { kind: 'dies', things: [bear('b1')] },
    { kind: 'leaves', things: [bear('b1'), bear('b2')] },
  ]);
});

test('a creature dying sets off its own "when this dies" and the cards watching deaths — the dead card too', () => {
  const g = table([card('z1', 'artist'), card('b1', 'bear')]);
  const died = (iid: string, cardId: string): Happening => ({ kind: 'dies', things: [{ seat: 0, kind: 'card', id: iid, cardId, name: 'x', n: 1 }] });
  expect(firedBy(g, died('b1', 'bear'), MORE).map((f) => [f.source.iid, f.because])).toEqual([['z1', 'x died']]);
  // The Cutthroat itself died: it was waiting for that too.
  const gone = structuredClone(g);
  gone.players[0].cards!.battlefield = gone.players[0].cards!.battlefield.filter((c) => c.iid !== 'z1');
  expect(firedBy(gone, died('z1', 'artist'), MORE).map((f) => [f.source.iid, f.because, f.own])).toEqual([['z1', 'It died', true]]);
});

test('passing the turn is the end of one player’s turn and the start of the next one’s', () => {
  const g = table([card('a1', 'arena')], [card('t9', 'tithe')]);
  const passed: GameState = { ...g, activePlayerIndex: 1, turnNumber: g.turnNumber + 1 };
  const [turn] = happeningsBetween(g, passed);
  expect(turn).toEqual({ kind: 'turn', ended: 0, began: 1, turn: passed.turnNumber });
  // Nathan's turn ended: Sam's Tithe Taker (an opponent's end step). Sam's upkeep: not Nathan's Arena.
  expect(firedBy(passed, turn, MORE).map((f) => [f.source.iid, f.because])).toEqual([['t9', 'Nathan’s turn ended']]);
  const back: GameState = { ...passed, activePlayerIndex: 0, turnNumber: passed.turnNumber + 1 };
  const [mine] = happeningsBetween(passed, back);
  expect(firedBy(back, mine, MORE).map((f) => [f.source.iid, f.because])).toEqual([['a1', 'Nathan’s turn began']]);
  expect(actsOf(readTriggers(MORE.arena)[0]).map((a) => [a.label, a.auto])).toEqual([
    ['Draw 1', true],
    ['Lose 1 life', true],
  ]);
});

test('an attack declared sets off the cards watching attacks; "whenever you attack" once, however many', () => {
  const g = table([card('r1', 'raider'), card('w1', 'war'), card('b1', 'bear'), card('b2', 'bear'), card('p1', 'pillager')]);
  const stamp = { id: 'f1', turn: g.turnNumber, active: 0 };
  let fight = startCombat(g, stamp);
  fight = setAttack(fight, 'f1', { kind: 'card', id: 'b1' }, 1, 1);
  fight = setAttack(fight, 'f1', { kind: 'card', id: 'b2' }, 1, 1);
  const declared = confirmAttackers(fight, 'f1', { cards: [], stacks: {} });
  const events = happeningsBetween(g, declared);
  expect(events.map((e) => e.kind)).toEqual(['combat', 'attacks']);
  expect(firedBy(declared, events[0], MORE).map((f) => f.source.iid)).toEqual(['p1']);
  const fired = firedBy(declared, events[1], MORE);
  expect(fired.map((f) => [f.source.iid, f.times, f.because])).toEqual([
    ['r1', 2, 'Grizzly Bears, Grizzly Bears attacked'],
    ['w1', 1, 'Nathan attacked'],
  ]);
  // Only declaring is attacking: picking attackers before Confirm is not.
  expect(happeningsBetween(g, fight).map((e) => e.kind)).toEqual(['combat']);
  expect(stillHappened(declared, events[1])).toBe(true);
  expect(stillHappened(fight, events[1])).toBe(false); // an Undo back to picking
});

test('a spell cast sets off the cards waiting for that kind of spell, its caster’s', () => {
  const g = table([card('m1', 'monk'), card('a1', 'wizard')], [card('m9', 'monk')]);
  const cast: Happening = { kind: 'cast', seat: 0, spell: { seat: 0, kind: 'card', id: 'h1', cardId: 'bolt', name: 'Lightning Bolt', n: 1 } };
  expect(firedBy(g, cast, MORE).map((f) => [f.source.iid, f.because])).toEqual([
    ['m1', 'Lightning Bolt was cast'],
    ['a1', 'Lightning Bolt was cast'],
  ]);
  const creature: Happening = { kind: 'cast', seat: 0, spell: { seat: 0, kind: 'card', id: 'h2', cardId: 'bear', name: 'Grizzly Bears', n: 1 } };
  expect(firedBy(g, creature, MORE)).toEqual([]);
});

// ---- combat damage, life gained, blocks ----

Object.assign(RECORDS, {
  sword: rec('sword', 'Sword of Fire and Ice', 'Artifact — Equipment', 'Equipped creature gets +2/+2 and has protection from red and from blue.\nWhenever equipped creature deals combat damage to a player, Sword of Fire and Ice deals 2 damage to any target and you draw a card.\nEquip {2}'),
  curiosity: rec('curiosity', 'Curiosity', 'Enchantment — Aura', 'Enchant creature\nWhenever enchanted creature deals damage to an opponent, you may draw a card.'),
  ninja: rec('ninja', 'Ninja of the Deep Hours', 'Creature — Human Ninja', 'Ninjutsu {1}{U}\nWhenever this creature deals combat damage to a player, you may return it to its owner’s hand.'),
  piracy: rec('piracy', 'Coastal Piracy', 'Enchantment', 'Whenever a creature you control deals combat damage to an opponent, you may draw a card.'),
  pridemate: rec('pridemate', "Ajani's Pridemate", 'Creature — Cat Soldier', 'Whenever you gain life, put a +1/+1 counter on this creature.'),
  wall: rec('wall', 'Wall of Junk', 'Creature — Wall', 'Whenever this creature blocks, you gain 2 life.'),
});

test('combat damage to a player, life gained and blocks are read; "equipped creature" is what the card is on', () => {
  const [hits] = readTriggers(RECORDS.sword);
  expect(hits).toMatchObject({ event: 'damage', host: true, self: false, other: null });
  expect(actsOf(hits).map((a) => [a.label, a.auto])).toEqual([
    ['Deal 2 damage…', false],
    ['Draw 1', true],
  ]);
  expect(readTriggers(RECORDS.curiosity)[0]).toMatchObject({ event: 'damage', host: true, may: true });
  expect(readTriggers(RECORDS.ninja)[0]).toMatchObject({ event: 'damage', self: true });
  expect(readTriggers(RECORDS.piracy)[0]).toMatchObject({ event: 'damage', other: { whose: 'you', kinds: [['creature']] } });
  expect(readTriggers(RECORDS.pridemate)[0]).toMatchObject({ event: 'gain', other: { whose: 'you' } });
  expect(actsOf(readTriggers(RECORDS.pridemate)[0])).toMatchObject([{ kind: 'grow', n: 1, auto: true }]);
  expect(readTriggers(RECORDS.wall)[0]).toMatchObject({ event: 'blocks', self: true });
});

test('a hit sets off the Equipment on the creature that hit, and the cards watching hits', () => {
  const g = table([card('b1', 'bear'), card('b2', 'bear'), card('p1', 'piracy'), { ...card('s1', 'sword'), on: { seat: 0, kind: 'card', id: 'b1' } }]);
  const hit = (iid: string): Happening => ({ kind: 'damage', combat: 'f1', things: [{ seat: 0, kind: 'card', id: iid, cardId: 'bear', name: 'Grizzly Bears', n: 1 }] });
  expect(firedBy(g, hit('b1'), RECORDS).map((f) => [f.source.iid, f.because])).toEqual([
    ['p1', 'Grizzly Bears dealt combat damage to a player'],
    ['s1', 'Grizzly Bears dealt combat damage to a player'],
  ]);
  expect(firedBy(g, hit('b2'), RECORDS).map((f) => f.source.iid)).toEqual(['p1']);
});

test('life gained sets off "whenever you gain life", once for the gain, the gainer’s own cards only', () => {
  const g = table([card('a1', 'pridemate')], [card('a9', 'pridemate')]);
  const gained: Happening = { kind: 'life', seat: 0, n: 3 };
  expect(firedBy(g, gained, RECORDS).map((f) => [f.source.iid, f.times, f.because])).toEqual([['a1', 1, 'Nathan gained 3 life']]);
  expect(firedBy(g, { kind: 'life', seat: 0, n: -2 }, RECORDS)).toEqual([]);
});

test('every defender done blocking: the blocks stand, and the blockers are what blocked', () => {
  const g = table([card('b1', 'bear')], [card('w9', 'wall')]);
  let fight = startCombat(g, { id: 'f1', turn: g.turnNumber, active: 0 });
  fight = setAttack(fight, 'f1', { kind: 'card', id: 'b1' }, 1, 1);
  fight = confirmAttackers(fight, 'f1', { cards: [], stacks: {} });
  const blocked = finishBlocks(setBlock(fight, 'f1', 1, { kind: 'card', id: 'b1' }, { kind: 'card', id: 'w9' }, 1), 'f1', 1);
  const [blocks] = happeningsBetween(fight, blocked).filter((e) => e.kind === 'blocks');
  expect(blocks).toEqual({ kind: 'blocks', combat: 'f1', things: [{ seat: 1, kind: 'card', id: 'w9', cardId: 'wall', name: 'Wall of Junk', n: 1 }] });
  expect(firedBy(blocked, blocks, RECORDS).map((f) => [f.source.iid, f.because])).toEqual([['w9', 'It blocked']]);
});
