import { describe, expect, test } from 'vitest';
import { attachedTo, boostOf, hostChoices, hostKind, hostName, hostOf, isAttached, isAura, isEquipment } from './attach';
import { attachCard, moveCard, type Host } from './cards';
import { createGame } from './game';
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

function rec(id: string, name: string, typeLine: string, oracleText = '', pt: string | null = null): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: pt,
    toughness: pt,
    colors: [],
    imageNormal: `${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  bear: rec('bear', 'Grizzly Bears', 'Creature — Bear', '', '2'),
  giant: rec('giant', 'Hill Giant', 'Creature — Giant', '', '3'),
  forest: rec('forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  fear: rec('fear', 'Fear', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has fear.'),
  rancor: rec('rancor', 'Rancor', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.'),
  might: rec('might', "Giant's Might", 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2.'),
  growth: rec('growth', 'Wild Growth', 'Enchantment — Aura', 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.'),
  curse: rec('curse', 'Curse of Opulence', 'Enchantment — Aura Curse', 'Enchant player\nWhenever enchanted player is attacked, create a Gold token.'),
  greaves: rec('greaves', 'Lightning Greaves', 'Artifact — Equipment', 'Equipped creature has haste and shroud.\nEquip {0}'),
  sword: rec('sword', 'Bonesplitter Plus', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}'),
  ring: rec('ring', 'Sol Ring', 'Artifact', '{T}: Add {C}{C}.'),
};

const card = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name: RECORDS[cardId].name,
  row: 'front',
  ...more,
});

const soldiers: BoardItem = {
  id: 'soldiers',
  cardId: null,
  name: 'Soldier',
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature — Soldier',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count: 3,
  counters: {},
  color: null,
  zone: 'board',
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

/** Nathan: a bear, a giant, a Forest, Greaves, Giant's Might and Fear. Sam: a bear and three soldiers. */
function table(): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: seat([
      card('bear', 'bear'),
      card('giant', 'giant'),
      card('forest', 'forest', { row: 'lands' }),
      card('greaves', 'greaves'),
      card('might', 'might'),
      card('fear', 'fear'),
    ]),
  };
  g.players[1] = { ...g.players[1], board: [soldiers], cards: seat([card('sbear', 'bear')]) };
  return g;
}

const onField = (g: GameState, s: number, iid: string) => g.players[s].cards!.battlefield.find((c) => c.iid === iid)!;
const BEAR: Host = { seat: 0, kind: 'card', id: 'bear' };
const GIANT: Host = { seat: 0, kind: 'card', id: 'giant' };
const THEIRS: Host = { seat: 1, kind: 'card', id: 'sbear' };
const STACK: Host = { seat: 1, kind: 'stack', id: 'soldiers' };

describe('reading the cards', () => {
  test('Auras and Equipment are told by their type', () => {
    expect(isAura(RECORDS.fear)).toBe(true);
    expect(isEquipment(RECORDS.greaves)).toBe(true);
    expect(isAura(RECORDS.greaves)).toBe(false);
    expect(isEquipment(RECORDS.ring)).toBe(false);
    expect(isAura(null)).toBe(false);
  });

  test('an Aura says what it enchants; an Equipment goes on creatures', () => {
    expect(hostKind(RECORDS.fear)).toBe('creature');
    expect(hostKind(RECORDS.growth)).toBe('land');
    expect(hostKind(RECORDS.curse)).toBe('player');
    expect(hostKind(RECORDS.greaves)).toBe('creature');
    expect(hostKind(rec('x', 'Darksteel Mutation', 'Enchantment — Aura', 'Enchant permanent'))).toBe('permanent');
  });

  test('only a plain +N/+N is a boost the table can show as counters', () => {
    expect(boostOf(RECORDS.might)).toBe(2);
    expect(boostOf(RECORDS.sword)).toBe(1);
    expect(boostOf(RECORDS.rancor)).toBe(0); // +2/+0
    expect(boostOf(RECORDS.fear)).toBe(0);
    expect(boostOf(rec('x', 'Blanchwood Armor', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each Forest you control.'))).toBe(0);
  });
});

describe('attachCard', () => {
  test('puts a card on a host of its own seat, another seat’s card, or a stack', () => {
    let g = attachCard(table(), 0, 'greaves', BEAR);
    expect(onField(g, 0, 'greaves').on).toEqual(BEAR);
    g = attachCard(g, 0, 'fear', THEIRS); // a hostile Aura sits on the other side of the table
    expect(onField(g, 0, 'fear').on).toEqual(THEIRS);
    g = attachCard(g, 0, 'might', STACK);
    expect(onField(g, 0, 'might').on).toEqual(STACK);
    expect(attachedTo(g, BEAR).map((a) => a.card.iid)).toEqual(['greaves']);
    expect(attachedTo(g, THEIRS)).toEqual([{ seat: 0, card: onField(g, 0, 'fear') }]);
    expect(hostName(g, THEIRS)).toBe('Grizzly Bears');
    expect(hostName(g, STACK)).toBe('Soldier');
  });

  test('asking for what is already so changes nothing; nor does a host that is not there, or the card itself', () => {
    const g = attachCard(table(), 0, 'greaves', BEAR);
    expect(attachCard(g, 0, 'greaves', BEAR)).toBe(g);
    expect(attachCard(g, 0, 'greaves', { seat: 0, kind: 'card', id: 'nope' })).toBe(g);
    expect(attachCard(g, 0, 'greaves', { seat: 0, kind: 'card', id: 'greaves' })).toBe(g);
    expect(attachCard(g, 0, 'nope', BEAR)).toBe(g);
    const bare = table();
    expect(attachCard(bare, 0, 'greaves', null)).toBe(bare); // nothing to take off
  });

  test('moving it to another host lets go of the first; null takes it off', () => {
    let g = attachCard(table(), 0, 'greaves', BEAR);
    g = attachCard(g, 0, 'greaves', GIANT);
    expect(attachedTo(g, BEAR)).toEqual([]);
    expect(attachedTo(g, GIANT).map((a) => a.card.iid)).toEqual(['greaves']);
    g = attachCard(g, 0, 'greaves', null);
    expect('on' in onField(g, 0, 'greaves')).toBe(false);
  });

  test('a boost goes on the host as +1/+1 counters, and comes off with the attachment', () => {
    let g = attachCard(table(), 0, 'might', BEAR, 2);
    expect(onField(g, 0, 'bear').counters).toEqual({ p1p1: 2 });
    expect(onField(g, 0, 'might').on).toEqual({ ...BEAR, plus: 2 });
    g = attachCard(g, 0, 'might', GIANT, 2); // moved: the bear loses them, the giant gets them
    expect(onField(g, 0, 'bear').counters).toBeUndefined();
    expect(onField(g, 0, 'giant').counters).toEqual({ p1p1: 2 });
    g = attachCard(g, 0, 'might', null);
    expect(onField(g, 0, 'giant').counters).toBeUndefined();
  });

  test('counters the creature had of its own are left alone', () => {
    let g = table();
    g = { ...g, players: [{ ...g.players[0], cards: { ...g.players[0].cards!, battlefield: g.players[0].cards!.battlefield.map((c) => (c.iid === 'bear' ? { ...c, counters: { p1p1: 1, shield: 1 } } : c)) } }, g.players[1]] };
    g = attachCard(g, 0, 'might', BEAR, 2);
    expect(onField(g, 0, 'bear').counters).toEqual({ p1p1: 3, shield: 1 });
    g = attachCard(g, 0, 'might', null);
    expect(onField(g, 0, 'bear').counters).toEqual({ p1p1: 1, shield: 1 });
  });

  test('a stack takes no counters from an attachment: they would be on every copy', () => {
    const g = attachCard(table(), 0, 'might', STACK, 2);
    expect(onField(g, 0, 'might').on).toEqual(STACK);
    expect(g.players[1].board[0].counters).toEqual({});
  });
});

describe('leaving the battlefield', () => {
  test('an attachment that leaves takes its counters off the host and forgets where it was', () => {
    let g = attachCard(table(), 0, 'might', BEAR, 2);
    g = moveCard(g, 0, 'might', 'battlefield', 'graveyard');
    expect(onField(g, 0, 'bear').counters).toBeUndefined();
    expect('on' in g.players[0].cards!.graveyard[0]).toBe(false);
  });

  test('when the host leaves, what was on it is unattached — on every seat — and stays that way if the host returns', () => {
    let g = attachCard(table(), 0, 'fear', THEIRS);
    g = attachCard(g, 1, 'sbear', null); // (nothing: it is not attached to anything)
    g = moveCard(g, 1, 'sbear', 'battlefield', 'hand'); // Sam's bear is bounced
    expect('on' in onField(g, 0, 'fear')).toBe(false);
    expect(hostOf(g, onField(g, 0, 'fear'))).toBeNull();
    g = moveCard(g, 1, 'sbear', 'hand', 'battlefield', { row: 'front' }); // …and replayed
    expect(attachedTo(g, THEIRS)).toEqual([]);
  });

  test('a card that only changes shelf keeps what it is attached to', () => {
    let g = attachCard(table(), 0, 'greaves', BEAR);
    g = moveCard(g, 0, 'greaves', 'battlefield', 'battlefield', { row: 'side' });
    expect(onField(g, 0, 'greaves').on).toEqual(BEAR);
    g = moveCard(g, 0, 'bear', 'battlefield', 'battlefield', { row: 'field' });
    expect(attachedTo(g, BEAR).map((a) => a.card.iid)).toEqual(['greaves']);
  });

  test('a stack that is gone simply leaves its attachment unattached', () => {
    let g = attachCard(table(), 0, 'might', STACK);
    expect(isAttached(g, onField(g, 0, 'might'))).toBe(true);
    g = { ...g, players: [g.players[0], { ...g.players[1], board: [] }] };
    expect(isAttached(g, onField(g, 0, 'might'))).toBe(false);
    expect(hostOf(g, onField(g, 0, 'might'))).toBeNull();
  });
});

describe('hostChoices', () => {
  const names = (g: GameState, s: number, cardId: string, self?: { seat: number; iid: string }) =>
    hostChoices(g, s, RECORDS[cardId], RECORDS, self).map((h) => h.name);

  test('an Aura that enchants creatures is offered creatures: cards with their size, then stacks', () => {
    expect(names(table(), 0, 'fear')).toEqual(['Grizzly Bears', 'Hill Giant']);
    expect(hostChoices(table(), 0, RECORDS.fear, RECORDS)[0]).toMatchObject({ seat: 0, kind: 'card', id: 'bear', size: '2/2', art: 'bear.jpg' });
    expect(names(table(), 1, 'fear')).toEqual(['Grizzly Bears', 'Soldier ×3']);
  });

  test('an Aura that enchants lands is offered lands; one that enchants a player, nothing on the board', () => {
    expect(names(table(), 0, 'growth')).toEqual(['Forest']);
    expect(names(table(), 0, 'curse')).toEqual([]);
  });

  test('never itself, and never another attachment that sits on something', () => {
    const g = attachCard(table(), 0, 'greaves', BEAR);
    const permanent = rec('x', 'Darksteel Mutation', 'Enchantment — Aura', 'Enchant permanent');
    const mine = hostChoices(g, 0, permanent, RECORDS, { seat: 0, iid: 'fear' }).map((h) => h.id);
    expect(mine).toContain('bear');
    expect(mine).toContain('might'); // an Aura lying unattached is still a permanent
    expect(mine).not.toContain('fear'); // itself
    expect(mine).not.toContain('greaves'); // on the bear
  });

  test('a card that cannot be read is offered: what the app cannot read never blocks a play', () => {
    const g = table();
    g.players[0] = { ...g.players[0], cards: seat([{ iid: 'm1', cardId: 'unknown', name: 'Mystery' }]) };
    expect(hostChoices(g, 0, RECORDS.fear, RECORDS).map((h) => h.name)).toEqual(['Mystery']);
  });
});
