import { describe, expect, test } from 'vitest';
import { moveCard, returnBorrowed, returnStolen, stealCard } from './cards';
import { createGame } from './game';
import { effectOf, planEffect, spellPrompts } from './spellEffects';
import type { CardInstance, CardRecord, GameState, SeatCards } from './types';

const seat = (battlefield: CardInstance[] = []): SeatCards => ({
  library: [],
  hand: [],
  battlefield,
  graveyard: [],
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'D',
});

function table(mine: CardInstance[], theirs: CardInstance[]): GameState {
  const g = createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    mode: 'cards',
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });
  return { ...g, players: g.players.map((p, i) => ({ ...p, cards: seat(i === 0 ? mine : theirs) })) };
}

const bear: CardInstance = { iid: 'bear', cardId: 'bears', name: 'Grizzly Bears', tapped: true };
const sword: CardInstance = { iid: 'sword', cardId: 'sword', name: 'Bonesplitter', on: { seat: 1, kind: 'card', id: 'bear' } };
const field = (g: GameState, s: number) => g.players[s].cards!.battlefield;

describe('taking control', () => {
  test('the card crosses the table remembering whose it is; what is on it follows', () => {
    const g = stealCard(table([], [bear, sword]), 1, 'bear', 0, { until: { turn: 1, active: 0 } });
    expect(field(g, 1).map((c) => c.iid)).toEqual(['sword']);
    expect(field(g, 0)).toEqual([{ ...bear, sick: true, stolen: { owner: 1, until: { turn: 1, active: 0 } } }]);
    expect(field(g, 1)[0].on).toEqual({ seat: 0, kind: 'card', id: 'bear' });
  });

  test('given back, it is simply its owner’s again', () => {
    const taken = stealCard(table([], [bear]), 1, 'bear', 0);
    const back = returnStolen(taken, 0, 'bear');
    expect(field(back, 0)).toEqual([]);
    expect(field(back, 1)[0].stolen).toBeUndefined();
  });

  test('dying, it goes to its owner’s graveyard', () => {
    const taken = stealCard(table([], [bear]), 1, 'bear', 0);
    const dead = moveCard(taken, 0, 'bear', 'battlefield', 'graveyard');
    expect(dead.players[0].cards!.graveyard).toEqual([]);
    expect(dead.players[1].cards!.graveyard.map((c) => c.iid)).toEqual(['bear']);
    expect(dead.players[1].cards!.graveyard[0].stolen).toBeUndefined();
  });

  test('held by an Aura: when the Aura leaves, the creature goes home', () => {
    const magic: CardInstance = { iid: 'magic', cardId: 'magic', name: 'Control Magic' };
    let g = stealCard(table([magic], [bear]), 1, 'bear', 0, { by: 'magic' });
    expect(field(g, 0).map((c) => c.iid)).toEqual(['magic', 'bear']);
    g = moveCard(g, 0, 'magic', 'battlefield', 'graveyard');
    expect(field(g, 0)).toEqual([]);
    expect(field(g, 1).map((c) => c.iid)).toEqual(['bear']);
  });

  test('when the turn ends, what was taken for the turn goes back, and only that', () => {
    const elf: CardInstance = { iid: 'elf', cardId: 'elves', name: 'Llanowar Elves' };
    let g = stealCard(table([], [bear, elf]), 1, 'bear', 0, { until: { turn: 1, active: 0 } });
    g = stealCard(g, 1, 'elf', 0);
    g = returnBorrowed(g);
    expect(field(g, 0).map((c) => c.iid)).toEqual(['elf']);
    expect(field(g, 1).map((c) => c.iid)).toEqual(['bear']);
  });
});

const rec = (name: string, typeLine: string, oracleText: string): CardRecord => ({
  id: name,
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
});

describe('reading a steal off a spell', () => {
  test('Act of Treason and Threaten: for the turn; a plain "gain control": for good', () => {
    const treason = spellPrompts(rec('Act of Treason', 'Sorcery', 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.'));
    expect(treason).toMatchObject([{ kind: 'steal', until: true, label: 'Take a creature for the turn…' }]);
    const threaten = spellPrompts(rec('Threaten', 'Sorcery', 'Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn.'));
    expect(threaten.find((p) => p.kind === 'steal')).toMatchObject({ until: true });
    const forGood = spellPrompts(rec('Steal Artifact', 'Sorcery', 'Gain control of target artifact.'));
    expect(forGood).toMatchObject([{ kind: 'steal', until: false, label: 'Take an artifact…' }]);
  });

  test('carried out: the caster has it, untapped and with haste for the turn', () => {
    const [prompt] = spellPrompts(rec('Act of Treason', 'Sorcery', 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.'));
    const g = table([], [bear]);
    const effect = effectOf(prompt, 0, { seat: 1, kind: 'card', id: 'bear' })!;
    const plan = planEffect(g, 0, 'Act of Treason', effect, { bears: rec('Grizzly Bears', 'Creature — Bear', '') })!;
    expect(plan.text).toBe('Nathan’s Act of Treason: Nathan gains control of Sam’s Grizzly Bears until end of turn');
    const after = plan.apply(g);
    const taken = field(after, 0)[0];
    expect(taken.tapped).toBeUndefined();
    expect(taken.boost?.keywords).toEqual(['haste']);
    expect(taken.stolen).toMatchObject({ owner: 1 });
  });

  test('one’s own creature, or a token stack, is not taken', () => {
    const [prompt] = spellPrompts(rec('Act of Treason', 'Sorcery', 'Gain control of target creature until end of turn.'));
    expect(effectOf(prompt, 0, { seat: 0, kind: 'card', id: 'x' })).toBeNull();
    expect(effectOf(prompt, 0, { seat: 1, kind: 'stack', id: 'x' })).toBeNull();
  });
});
