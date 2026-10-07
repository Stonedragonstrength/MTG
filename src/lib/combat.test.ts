import { describe, expect, test } from 'vitest';
import { tapItem } from './board';
import { tapCard } from './cards';
import {
  actingSeat,
  applyCombat,
  attackLine,
  blockLine,
  boardSeat,
  cancelCombat,
  confirmAttackers,
  dropCombat,
  finishBlocks,
  liveCombat,
  outcomeDefeats,
  outcomeLine,
  sameAttacks,
  sameBlocks,
  sameDefender,
  sameLiveCombat,
  sameRecord,
  sameStep,
  setAttack,
  setBlock,
  setBlocked,
  startCombat,
  type CombatOutcome,
} from './combat';
import { adjustLife, createGame, passTurn } from './game';
import type { BoardItem, CardInstance, CombatUnit, GameConfig, GameState } from './types';

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

const card = (id: string): CombatUnit => ({ kind: 'card', id });
const stack = (id: string): CombatUnit => ({ kind: 'stack', id });

/** A card that has been in the front row a while. */
const onField = (iid: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId: `c-${iid}`,
  name: iid,
  row: 'front',
  ...more,
});

/** A stack of creature tokens. */
const tokens = (id: string, count: number, more: Partial<BoardItem> = {}): BoardItem => ({
  id,
  cardId: null,
  name: id,
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
  ...more,
});

/** Gives a seat its battlefield and its stacks. Cards make it a cards seat. */
function seat(g: GameState, idx: number, cards: CardInstance[] | null, board: BoardItem[] = []): GameState {
  return {
    ...g,
    players: g.players.map((p, i) =>
      i !== idx
        ? p
        : {
            ...p,
            board,
            ...(cards
              ? {
                  cards: {
                    library: [],
                    hand: [],
                    battlefield: cards,
                    graveyard: [],
                    exile: [],
                    command: [],
                    mulligans: 0,
                    deckName: 'Test',
                  },
                }
              : {}),
          },
    ),
  };
}

/** Four seats, Nathan's turn. Nathan: a bear, a wolf, a hawk and five soldiers. Sam: a wall,
 * an ogre and three saprolings. Alex: a knight. Kim: a tracker seat with nothing on the tablet. */
function pod(): GameState {
  let g = createGame(config(4));
  g = seat(g, 0, [onField('bear'), onField('wolf'), onField('hawk')], [tokens('soldiers', 5)]);
  g = seat(g, 1, [onField('wall'), onField('ogre')], [tokens('saprolings', 3)]);
  g = seat(g, 2, [onField('knight')]);
  return g;
}

const STAMP = { id: 'c1', turn: 1, active: 0 };
const NO_TAPS = { cards: [], stacks: {} };
const started = (g: GameState = pod()) => startCombat(g, STAMP);
const attacksOf = (g: GameState) => g.combat?.attacks ?? [];
const fieldCard = (g: GameState, idx: number, iid: string) =>
  g.players[idx].cards!.battlefield.find((c) => c.iid === iid);
const item = (g: GameState, idx: number, id: string) => g.players[idx].board.find((it) => it.id === id);

/** Nathan sends the bear at Sam, the wolf at Alex and three soldiers at Sam; nothing has vigilance. */
function declared(): GameState {
  let g = started();
  g = setAttack(g, 'c1', card('bear'), 1, 1);
  g = setAttack(g, 'c1', card('wolf'), 2, 1);
  g = setAttack(g, 'c1', stack('soldiers'), 1, 3);
  return g;
}
const confirmed = (g: GameState = declared()) =>
  confirmAttackers(g, 'c1', { cards: ['bear', 'wolf'], stacks: { soldiers: 3 } });
/** …and both defenders are through: the fight waits at damage. */
function atDamage(g: GameState = confirmed()): GameState {
  return finishBlocks(finishBlocks(g, 'c1', 1), 'c1', 2);
}

describe('liveCombat', () => {
  test('no fight, no combat', () => {
    expect(liveCombat(pod())).toBeNull();
  });

  test('a fight declared this turn is the live one', () => {
    const g = started();
    expect(liveCombat(g)).toEqual({ id: 'c1', turn: 1, active: 0, step: 'attackers' });
    expect(liveCombat(g)).toBe(g.combat);
  });

  test('a finished one is not: the marker it leaves is nobody’s fight', () => {
    const done = cancelCombat(started(), 'c1');
    expect(done.combat).toEqual({ id: 'c1', turn: 1, active: 0, step: 'done' });
    expect(liveCombat(done)).toBeNull();
  });

  test('a stale one is not: the turn moved on under it', () => {
    const g = declared();
    expect(liveCombat({ ...g, turnNumber: 2 })).toBeNull();
    expect(liveCombat({ ...g, activePlayerIndex: 1 })).toBeNull();
    expect(liveCombat(passTurn(g))).toBeNull(); // a pass from a build that does not drop it
  });

  test('a fight whose attacker has been defeated is over', () => {
    expect(liveCombat(adjustLife(declared(), 0, -40))).toBeNull();
  });

  test('boardSeat: the big board is the active player’s, except while a defender chooses blockers', () => {
    expect(boardSeat(pod())).toBe(0);
    expect(boardSeat(declared())).toBe(0); // picking attackers
    const blocking = confirmed();
    expect(liveCombat(blocking)?.defender).toBe(1);
    expect(boardSeat(blocking)).toBe(1); // Sam's turn to block
    const next = finishBlocks(blocking, 'c1', 1);
    expect(boardSeat(next)).toBe(2); // then Alex's
    expect(boardSeat(atDamage())).toBe(0); // back to the attacker for the damage
    expect(boardSeat(cancelCombat(blocking, 'c1'))).toBe(0); // called off
    expect(boardSeat({ ...blocking, turnNumber: 2 })).toBe(0); // a stale fight moves nothing
    // a defender who was defeated while choosing keeps the board until Done is pressed for them
    expect(boardSeat(adjustLife(blocking, 1, -40))).toBe(1);
  });

  test('actingSeat: whose bar it is — the attacker’s, or the defender’s while they block', () => {
    expect(actingSeat(liveCombat(declared())!)).toBe(0);
    expect(actingSeat(liveCombat(confirmed())!)).toBe(1);
    expect(actingSeat(liveCombat(atDamage())!)).toBe(0);
  });
});

describe('startCombat', () => {
  test('opens at the attackers step with the stamp it was given, and nothing else', () => {
    const g = started();
    expect(g.combat).toEqual({ id: 'c1', turn: 1, active: 0, step: 'attackers' });
    expect('attacks' in g.combat!).toBe(false); // empty lists stay off the wire
  });

  test('does nothing once the turn it was pressed in is over', () => {
    const g = pod();
    const later = passTurn(g); // Sam's turn
    expect(startCombat(later, STAMP)).toBe(later);
    const round = { ...g, turnNumber: 2 };
    expect(startCombat(round, STAMP)).toBe(round);
  });

  test('does nothing while a fight is live', () => {
    const g = declared();
    expect(startCombat(g, { ...STAMP, id: 'c2' })).toBe(g);
    expect(startCombat(g, STAMP)).toBe(g);
  });

  test('a start replayed after its fight finished meets its own id and does nothing', () => {
    const done = applyCombat(atDamage(), 'c1', { players: [], deaths: [] });
    expect(done.combat?.step).toBe('done');
    expect(startCombat(done, STAMP)).toBe(done); // the whole declaration must not come back to life
    const called = cancelCombat(declared(), 'c1');
    expect(startCombat(called, STAMP)).toBe(called);
  });

  test('a second fight in the same turn starts under a new id', () => {
    const done = cancelCombat(declared(), 'c1');
    const again = startCombat(done, { ...STAMP, id: 'c2' });
    expect(again.combat).toEqual({ id: 'c2', turn: 1, active: 0, step: 'attackers' });
    expect(liveCombat(again)?.id).toBe('c2');
  });

  test('takes the place of a record left by an earlier turn', () => {
    const stale = { ...declared(), turnNumber: 2 };
    const fresh = startCombat(stale, { id: 'c9', turn: 2, active: 0 });
    expect(fresh.combat).toEqual({ id: 'c9', turn: 2, active: 0, step: 'attackers' });
  });

  test('a defeated player starts nothing', () => {
    const g = adjustLife(pod(), 0, -40);
    expect(startCombat(g, STAMP)).toBe(g);
  });
});

describe('setAttack', () => {
  test('a card attacks a player: one entry, no count written', () => {
    const g = setAttack(started(), 'c1', card('bear'), 1, 1);
    expect(attacksOf(g)).toEqual([{ unit: card('bear'), target: 1 }]);
  });

  test('a card pointed at another player is re-pointed, not doubled, and keeps its place', () => {
    let g = setAttack(started(), 'c1', card('bear'), 1, 1);
    g = setAttack(g, 'c1', card('wolf'), 1, 1);
    g = setAttack(g, 'c1', card('bear'), 2, 1);
    expect(attacksOf(g)).toEqual([
      { unit: card('bear'), target: 2 },
      { unit: card('wolf'), target: 1 },
    ]);
  });

  test('a card is always one attacker, whatever number is asked for', () => {
    expect(attacksOf(setAttack(started(), 'c1', card('bear'), 1, 4))).toEqual([{ unit: card('bear'), target: 1 }]);
  });

  test('zero takes it back, whichever player the call names', () => {
    const g = setAttack(started(), 'c1', card('bear'), 1, 1);
    const back = setAttack(g, 'c1', card('bear'), 2, 0);
    expect(attacksOf(back)).toEqual([]);
    expect('attacks' in back.combat!).toBe(false);
  });

  test('the same pick twice, or taking back what is not attacking, changes nothing', () => {
    const g = setAttack(started(), 'c1', card('bear'), 1, 1);
    expect(setAttack(g, 'c1', card('bear'), 1, 1)).toBe(g);
    expect(setAttack(g, 'c1', card('wolf'), 1, 0)).toBe(g);
    expect(setAttack(g, 'c1', stack('soldiers'), 1, 0)).toBe(g);
  });

  test('a stack sends copies: a number per player, left out when it is one', () => {
    let g = setAttack(started(), 'c1', stack('soldiers'), 1, 3);
    expect(attacksOf(g)).toEqual([{ unit: stack('soldiers'), n: 3, target: 1 }]);
    g = setAttack(g, 'c1', stack('soldiers'), 2, 1); // one more of them at Alex
    expect(attacksOf(g)).toEqual([
      { unit: stack('soldiers'), n: 3, target: 1 },
      { unit: stack('soldiers'), target: 2 },
    ]);
    g = setAttack(g, 'c1', stack('soldiers'), 1, 2); // set, not add
    expect(attacksOf(g)[0]).toEqual({ unit: stack('soldiers'), n: 2, target: 1 });
  });

  test('a stack never sends more copies than it holds, over all its targets together', () => {
    let g = setAttack(started(), 'c1', stack('soldiers'), 1, 9);
    expect(attacksOf(g)[0].n).toBe(5);
    g = setAttack(g, 'c1', stack('soldiers'), 1, 3);
    g = setAttack(g, 'c1', stack('soldiers'), 2, 4); // only two are left
    expect(attacksOf(g).map((a) => a.n ?? 1)).toEqual([3, 2]);
    expect(setAttack(g, 'c1', stack('soldiers'), 3, 1)).toBe(g); // none left for Kim
    g = setAttack(g, 'c1', stack('soldiers'), 1, 5); // raising one target stops at what the other leaves
    expect(attacksOf(g).map((a) => a.n ?? 1)).toEqual([3, 2]);
  });

  test('zero for a stack takes back that player’s copies only', () => {
    let g = setAttack(started(), 'c1', stack('soldiers'), 1, 3);
    g = setAttack(g, 'c1', stack('soldiers'), 2, 2);
    g = setAttack(g, 'c1', stack('soldiers'), 1, 0);
    expect(attacksOf(g)).toEqual([{ unit: stack('soldiers'), n: 2, target: 2 }]);
  });

  test('nothing happens for the wrong fight, the wrong step or a target that cannot be attacked', () => {
    const g = started();
    expect(setAttack(g, 'other', card('bear'), 1, 1)).toBe(g); // wrong id
    expect(setAttack(g, 'c1', card('bear'), 0, 1)).toBe(g); // yourself
    expect(setAttack(g, 'c1', card('bear'), 7, 1)).toBe(g); // nobody sits there
    expect(setAttack(g, 'c1', card('bear'), 1.5, 1)).toBe(g);
    expect(setAttack(g, 'c1', card('bear'), 1, Number.NaN)).toBe(g);
    const samOut = adjustLife(g, 1, -40);
    expect(setAttack(samOut, 'c1', card('bear'), 1, 1)).toBe(samOut); // a defeated player
    const blockers = confirmed();
    expect(setAttack(blockers, 'c1', card('hawk'), 1, 1)).toBe(blockers); // attackers are declared
    const idle = pod();
    expect(setAttack(idle, 'c1', card('bear'), 1, 1)).toBe(idle); // no fight at all
  });

  test('nothing happens for a unit that is not on the attacker’s side of the table', () => {
    const g = started();
    expect(setAttack(g, 'c1', card('ghost'), 1, 1)).toBe(g);
    expect(setAttack(g, 'c1', stack('ghosts'), 1, 2)).toBe(g);
    expect(setAttack(g, 'c1', card('wall'), 2, 1)).toBe(g); // Sam's wall
    expect(setAttack(g, 'c1', stack('saprolings'), 2, 1)).toBe(g); // Sam's tokens
    expect(setAttack(g, 'c1', { kind: 'spirit', id: 'bear' } as unknown as CombatUnit, 1, 1)).toBe(g);
    expect(setAttack(g, 'c1', null as unknown as CombatUnit, 1, 1)).toBe(g);
  });

  test('an attacker that has left can still be taken back', () => {
    let g = setAttack(started(), 'c1', card('bear'), 1, 1);
    g = seat(g, 0, [onField('wolf')], [tokens('soldiers', 5)]); // the bear died meanwhile
    expect(attacksOf(setAttack(g, 'c1', card('bear'), 1, 0))).toEqual([]);
  });
});

describe('confirmAttackers', () => {
  test('with nobody attacking the fight simply ends', () => {
    const g = confirmAttackers(started(), 'c1', NO_TAPS);
    expect(g.combat).toEqual({ id: 'c1', turn: 1, active: 0, step: 'done' });
    expect(liveCombat(g)).toBeNull();
  });

  test('taps the listed attackers with their mana used up, and notes what it tapped', () => {
    const g = confirmed();
    expect(fieldCard(g, 0, 'bear')).toMatchObject({ tapped: true });
    expect(fieldCard(g, 0, 'bear')!.spent).toBeGreaterThan(50); // nothing left floating
    expect(fieldCard(g, 0, 'wolf')!.tapped).toBe(true);
    expect(fieldCard(g, 0, 'hawk')!.tapped).toBeUndefined(); // stayed home
    expect(item(g, 0, 'soldiers')!.tapped).toBe(3);
    expect(attacksOf(g)).toEqual([
      { unit: card('bear'), target: 1, tapped: 1 },
      { unit: card('wolf'), target: 2, tapped: 1 },
      { unit: stack('soldiers'), n: 3, target: 1, tapped: 3 },
    ]);
  });

  test('an attacker with vigilance is not listed: it stays untapped and carries no note', () => {
    const g = confirmAttackers(declared(), 'c1', { cards: ['wolf'], stacks: {} });
    expect(fieldCard(g, 0, 'bear')!.tapped).toBeUndefined();
    expect(item(g, 0, 'soldiers')!.tapped ?? 0).toBe(0);
    expect(attacksOf(g)).toEqual([
      { unit: card('bear'), target: 1 },
      { unit: card('wolf'), target: 2, tapped: 1 },
      { unit: stack('soldiers'), n: 3, target: 1 },
    ]);
  });

  test('an attacker that was tapped already is left as it was, and the note says the declaration did not tap it', () => {
    const floating = tapCard(declared(), 0, 'bear', true); // tapped by hand before ("attack anyway")
    const g = confirmed(floating);
    expect(fieldCard(g, 0, 'bear')).toEqual(fieldCard(floating, 0, 'bear'));
    expect(attacksOf(g)[0]).toEqual({ unit: card('bear'), target: 1 });
  });

  test('a stack’s copies are tapped up to the copies that are free, shared out over its targets in order', () => {
    let g = started(seat(pod(), 0, [onField('bear')], [tokens('soldiers', 5, { tapped: 2 })]));
    g = setAttack(g, 'c1', stack('soldiers'), 1, 2);
    g = setAttack(g, 'c1', stack('soldiers'), 2, 3); // all five, two of them tapped already
    g = confirmAttackers(g, 'c1', { cards: [], stacks: { soldiers: 5 } });
    expect(item(g, 0, 'soldiers')!.tapped).toBe(5);
    expect(attacksOf(g).map((a) => a.tapped ?? 0)).toEqual([2, 1]); // only three were stood up to begin with
  });

  test('a listed card or stack that is not attacking is not tapped', () => {
    const g = confirmAttackers(declared(), 'c1', { cards: ['bear', 'hawk'], stacks: { soldiers: 5, ghosts: 2 } });
    expect(fieldCard(g, 0, 'hawk')!.tapped).toBeUndefined();
    expect(item(g, 0, 'soldiers')!.tapped).toBe(3); // three attack, however many were listed
  });

  test('blocking starts with the first attacked player in turn order after the attacker', () => {
    const g = confirmed();
    expect(g.combat).toMatchObject({ step: 'blockers', defender: 1 });
    // Alex attacks Nathan and Kim: after Alex comes Kim, then Nathan
    let alex = seat({ ...pod(), activePlayerIndex: 2 }, 3, null, [tokens('thopters', 2)]);
    alex = startCombat(alex, { id: 'c1', turn: 1, active: 2 });
    alex = setAttack(alex, 'c1', card('knight'), 0, 1);
    alex = confirmAttackers(alex, 'c1', NO_TAPS);
    expect(alex.combat).toMatchObject({ step: 'blockers', defender: 0 }); // Kim is not attacked
    let both = startCombat(seat({ ...pod(), activePlayerIndex: 2 }, 3, null, [tokens('thopters', 2)]), {
      id: 'c1',
      turn: 1,
      active: 2,
    });
    both = seat(both, 2, [onField('knight'), onField('squire')]);
    both = setAttack(both, 'c1', card('knight'), 0, 1);
    both = setAttack(both, 'c1', card('squire'), 3, 1);
    both = confirmAttackers(both, 'c1', NO_TAPS);
    expect(both.combat).toMatchObject({ step: 'blockers', defender: 3 }); // Kim before Nathan
  });

  test('a player with nothing on the tablet to block with is not asked', () => {
    let g = started();
    g = setAttack(g, 'c1', card('bear'), 3, 1); // Kim: a tracker seat with an empty board
    g = setAttack(g, 'c1', card('wolf'), 2, 1);
    g = confirmAttackers(g, 'c1', NO_TAPS);
    expect(g.combat).toMatchObject({ step: 'blockers', defender: 2 }); // straight to Alex
    // lands, and stacks without a size, are nothing to block with
    let lands = seat(pod(), 3, [onField('forest', { row: 'lands' })], [
      tokens('treasure', 2, { basePower: null, baseToughness: null }),
      tokens('dryad arbor', 1, { zone: 'lands' }),
    ]);
    lands = setAttack(started(lands), 'c1', card('bear'), 3, 1);
    lands = confirmAttackers(lands, 'c1', NO_TAPS);
    expect(lands.combat).toMatchObject({ step: 'damage' });
    // one front-row card is enough, whatever it is: the reducers cannot read card types
    let rock = seat(pod(), 3, [onField('sol ring')]);
    rock = confirmAttackers(setAttack(started(rock), 'c1', card('bear'), 3, 1), 'c1', NO_TAPS);
    expect(rock.combat).toMatchObject({ step: 'blockers', defender: 3 });
    // and so is a stack with power and toughness, on a seat without cards
    let tracker = seat(pod(), 3, null, [tokens('thopters', 1)]);
    tracker = confirmAttackers(setAttack(started(tracker), 'c1', card('bear'), 3, 1), 'c1', NO_TAPS);
    expect(tracker.combat).toMatchObject({ step: 'blockers', defender: 3 });
  });

  test('with nobody to ask it goes straight to damage, and carries no defender', () => {
    let g = started();
    g = setAttack(g, 'c1', card('bear'), 3, 1);
    g = confirmAttackers(g, 'c1', { cards: ['bear'], stacks: {} });
    expect(g.combat!.step).toBe('damage');
    expect('defender' in g.combat!).toBe(false);
    expect(fieldCard(g, 0, 'bear')!.tapped).toBe(true); // the attack still happened
  });

  test('nothing happens for the wrong fight or once attackers are declared', () => {
    const g = declared();
    expect(confirmAttackers(g, 'nope', NO_TAPS)).toBe(g);
    const once = confirmed();
    expect(confirmed(once)).toBe(once); // a second press taps nothing more
    const idle = pod();
    expect(confirmAttackers(idle, 'c1', NO_TAPS)).toBe(idle);
  });

  test('a tap list that makes no sense taps nothing and breaks nothing', () => {
    const g = confirmAttackers(declared(), 'c1', { cards: 'bear', stacks: null } as never);
    expect(g.combat!.step).toBe('blockers');
    expect(fieldCard(g, 0, 'bear')!.tapped).toBeUndefined();
    const g2 = confirmAttackers(declared(), 'c1', undefined as never);
    expect(g2.combat!.step).toBe('blockers');
  });
});

describe('setBlock', () => {
  test('a card stands in the way of an attacker, and a second one joins it in the order declared', () => {
    let g = setBlock(confirmed(), 'c1', 1, card('bear'), card('wall'), 1);
    expect(attacksOf(g)[0].blockers).toEqual([card('wall')]);
    g = setBlock(g, 'c1', 1, card('bear'), card('ogre'), 1);
    expect(attacksOf(g)[0].blockers).toEqual([card('wall'), card('ogre')]);
  });

  test('a card blocks one attack only: pointing it at another takes it out of the first', () => {
    let g = setBlock(confirmed(), 'c1', 1, card('bear'), card('wall'), 1);
    g = setBlock(g, 'c1', 1, stack('soldiers'), card('wall'), 1);
    expect('blockers' in attacksOf(g)[0]).toBe(false); // gone, and the empty list with it
    expect(attacksOf(g)[2].blockers).toEqual([card('wall')]);
  });

  test('zero takes a blocker back; the same block twice changes nothing', () => {
    const g = setBlock(confirmed(), 'c1', 1, card('bear'), card('wall'), 1);
    expect(setBlock(g, 'c1', 1, card('bear'), card('wall'), 1)).toBe(g);
    const back = setBlock(g, 'c1', 1, card('bear'), card('wall'), 0);
    expect('blockers' in attacksOf(back)[0]).toBe(false);
    expect(setBlock(back, 'c1', 1, card('bear'), card('wall'), 0)).toBe(back);
  });

  test('a stack sends copies to block, and never more than it has untapped over all the attacks', () => {
    let g = seat(confirmed(), 1, [onField('wall')], [tokens('saprolings', 3, { tapped: 1 })]);
    g = setBlock(g, 'c1', 1, card('bear'), stack('saprolings'), 5);
    expect(attacksOf(g)[0].blockers).toEqual([{ kind: 'stack', id: 'saprolings', n: 2 }]); // two are untapped
    g = setBlock(g, 'c1', 1, card('bear'), stack('saprolings'), 1);
    expect(attacksOf(g)[0].blockers).toEqual([stack('saprolings')]); // one: no count written
    g = setBlock(g, 'c1', 1, stack('soldiers'), stack('saprolings'), 3);
    expect(attacksOf(g)[2].blockers).toEqual([stack('saprolings')]); // only one was left
    const full = g;
    g = setBlock(g, 'c1', 1, card('bear'), stack('saprolings'), 2);
    expect(g).toBe(full); // the other one is busy
  });

  test('blockers on a stack attack never outnumber the copies attacking', () => {
    let g = setBlock(confirmed(), 'c1', 1, stack('soldiers'), stack('saprolings'), 3); // 3 soldiers attack
    g = setBlock(g, 'c1', 1, stack('soldiers'), card('wall'), 1);
    expect(attacksOf(g)[2].blockers).toEqual([{ kind: 'stack', id: 'saprolings', n: 3 }]); // no copy left for the wall
    g = setBlock(g, 'c1', 1, stack('soldiers'), stack('saprolings'), 2);
    g = setBlock(g, 'c1', 1, stack('soldiers'), card('wall'), 1);
    expect(attacksOf(g)[2].blockers).toEqual([{ kind: 'stack', id: 'saprolings', n: 2 }, card('wall')]);
    const full = g;
    expect(setBlock(g, 'c1', 1, stack('soldiers'), card('ogre'), 1)).toBe(full);
    expect(setBlock(g, 'c1', 1, stack('soldiers'), stack('saprolings'), 3)).toBe(full); // the wall has the third
  });

  test('a card that finds no room on a stack attack keeps the block it had', () => {
    let g = setBlock(confirmed(), 'c1', 1, card('bear'), card('wall'), 1);
    g = setBlock(g, 'c1', 1, stack('soldiers'), stack('saprolings'), 3);
    const before = g;
    expect(setBlock(g, 'c1', 1, stack('soldiers'), card('wall'), 1)).toBe(before);
  });

  test('only the player whose turn it is to block may block, and only what is coming at them', () => {
    const g = confirmed(); // Sam is up; Alex is next
    expect(setBlock(g, 'c1', 2, card('wolf'), card('knight'), 1)).toBe(g); // Alex: not yet
    expect(setBlock(g, 'c1', 1, card('wolf'), card('wall'), 1)).toBe(g); // the wolf is Alex's problem
    expect(setBlock(g, 'c1', 1, card('hawk'), card('wall'), 1)).toBe(g); // the hawk stayed home
    expect(setBlock(g, 'c1', 1, card('bear'), card('knight'), 1)).toBe(g); // Alex's knight is not Sam's
    expect(setBlock(g, 'c1', 1, card('bear'), card('ghost'), 1)).toBe(g);
    expect(setBlock(g, 'c1', 1, card('bear'), stack('ghosts'), 1)).toBe(g);
    expect(setBlock(g, 'c1', 1, card('bear'), stack('soldiers'), 1)).toBe(g); // Nathan's own soldiers
  });

  test('nothing happens for the wrong fight or outside the blockers step', () => {
    const g = confirmed();
    expect(setBlock(g, 'nope', 1, card('bear'), card('wall'), 1)).toBe(g);
    expect(setBlock(g, 'c1', 1, card('bear'), card('wall'), Number.NaN)).toBe(g);
    const picking = declared();
    expect(setBlock(picking, 'c1', 1, card('bear'), card('wall'), 1)).toBe(picking);
    const damage = atDamage();
    expect(setBlock(damage, 'c1', 1, card('bear'), card('wall'), 1)).toBe(damage);
  });

  test('a tapped card may still be put in the way: that refusal is the screen’s, with its "block anyway"', () => {
    const g = seat(confirmed(), 1, [onField('wall', { tapped: true })]);
    expect(attacksOf(setBlock(g, 'c1', 1, card('bear'), card('wall'), 1))[0].blockers).toEqual([card('wall')]);
  });
});

describe('setBlocked', () => {
  test('marks an attack as stopped by something that is not on the tablet, and takes the mark back', () => {
    const g = setBlocked(confirmed(), 'c1', 1, card('bear'), true);
    expect(attacksOf(g)[0]).toEqual({ unit: card('bear'), target: 1, tapped: 1, blocked: true });
    expect(setBlocked(g, 'c1', 1, card('bear'), true)).toBe(g);
    const cleared = setBlocked(g, 'c1', 1, card('bear'), false);
    expect('blocked' in attacksOf(cleared)[0]).toBe(false); // left out, never written as false
    expect(setBlocked(cleared, 'c1', 1, card('bear'), false)).toBe(cleared);
  });

  test('only for the player who is blocking now, and only on an attack coming at them', () => {
    const g = confirmed();
    expect(setBlocked(g, 'c1', 2, card('wolf'), true)).toBe(g); // Alex is not up yet
    expect(setBlocked(g, 'c1', 1, card('wolf'), true)).toBe(g);
    expect(setBlocked(g, 'c1', 1, card('hawk'), true)).toBe(g);
    expect(setBlocked(g, 'nope', 1, card('bear'), true)).toBe(g);
    expect(setBlocked(g, 'c1', 1, card('bear'), 'yes' as never)).toBe(g);
    const damage = atDamage();
    expect(setBlocked(damage, 'c1', 1, card('bear'), true)).toBe(damage);
  });
});

describe('finishBlocks', () => {
  test('hands the blocking on to the next attacked player, then to damage', () => {
    const sam = confirmed();
    const alex = finishBlocks(sam, 'c1', 1);
    expect(alex.combat).toMatchObject({ step: 'blockers', defender: 2 });
    const damage = finishBlocks(alex, 'c1', 2);
    expect(damage.combat!.step).toBe('damage');
    expect('defender' in damage.combat!).toBe(false);
    expect(damage.combat!.attacks).toEqual(sam.combat!.attacks); // the declaration came through untouched
  });

  test('names the player who is done: a second "done" for the same player skips nobody', () => {
    const alex = finishBlocks(confirmed(), 'c1', 1);
    expect(finishBlocks(alex, 'c1', 1)).toBe(alex); // Sam's phone and the tablet both pressed it
    expect(alex.combat).toMatchObject({ step: 'blockers', defender: 2 });
  });

  test('works the next player out from the table it lands on', () => {
    const alexOut = adjustLife(confirmed(), 2, -40); // Alex was defeated while Sam was blocking
    expect(finishBlocks(alexOut, 'c1', 1).combat!.step).toBe('damage');
    const nothingLeft = seat(confirmed(), 2, []); // or lost the only thing he could block with
    expect(finishBlocks(nothingLeft, 'c1', 1).combat!.step).toBe('damage');
  });

  test('nothing happens for a player who is not up, the wrong fight or the wrong step', () => {
    const g = confirmed();
    expect(finishBlocks(g, 'c1', 2)).toBe(g);
    expect(finishBlocks(g, 'c1', 0)).toBe(g);
    expect(finishBlocks(g, 'nope', 1)).toBe(g);
    const picking = declared();
    expect(finishBlocks(picking, 'c1', 1)).toBe(picking);
    const damage = atDamage();
    expect(finishBlocks(damage, 'c1', 2)).toBe(damage);
  });
});

describe('cancelCombat', () => {
  test('before the attack is confirmed there is nothing to stand back up', () => {
    const g = declared();
    const off = cancelCombat(g, 'c1');
    expect(off.combat).toEqual({ id: 'c1', turn: 1, active: 0, step: 'done' });
    expect(off.players).toBe(g.players);
  });

  test('stands back up exactly what the declaration tapped', () => {
    // The wolf was tapped by hand before; two soldiers were tapped before; the hawk has vigilance.
    let g = seat(pod(), 0, [onField('bear'), onField('wolf', { tapped: true }), onField('hawk')], [
      tokens('soldiers', 5, { tapped: 2 }),
    ]);
    g = started(g);
    g = setAttack(g, 'c1', card('bear'), 1, 1);
    g = setAttack(g, 'c1', card('wolf'), 1, 1);
    g = setAttack(g, 'c1', card('hawk'), 1, 1);
    g = setAttack(g, 'c1', stack('soldiers'), 1, 2);
    g = confirmAttackers(g, 'c1', { cards: ['bear', 'wolf'], stacks: { soldiers: 2 } });
    expect(item(g, 0, 'soldiers')!.tapped).toBe(4);
    for (const at of [g, finishBlocks(g, 'c1', 1)]) {
      // from the blockers step and from the damage step alike
      const off = cancelCombat(at, 'c1');
      expect(off.combat).toEqual({ id: 'c1', turn: 1, active: 0, step: 'done' });
      expect(fieldCard(off, 0, 'bear')).toEqual(onField('bear')); // untapped, its mana started over
      expect(fieldCard(off, 0, 'wolf')!.tapped).toBe(true); // it was tapped before the attack
      expect(fieldCard(off, 0, 'hawk')!.tapped).toBeUndefined();
      expect(item(off, 0, 'soldiers')!.tapped).toBe(2); // back to the two that were tapped before
    }
  });

  test('a card that is no longer tapped, or no longer there, is left alone', () => {
    const g = confirmed();
    const untapped = tapCard(g, 0, 'bear', false); // stood up by hand meanwhile
    expect(fieldCard(cancelCombat(untapped, 'c1'), 0, 'bear')).toEqual(fieldCard(untapped, 0, 'bear'));
    const gone = seat(g, 0, [onField('wolf', { tapped: true })], []); // bear and soldiers both left
    const off = cancelCombat(gone, 'c1');
    expect(off.combat!.step).toBe('done');
    expect(fieldCard(off, 0, 'wolf')!.tapped).toBeUndefined();
    expect(off.players[0].board).toEqual([]);
  });

  test('a stack that was untapped meanwhile does not go below zero', () => {
    const g = tapItem(confirmed(), 0, 'soldiers', -2); // one tapped left of the three
    expect(item(cancelCombat(g, 'c1'), 0, 'soldiers')!.tapped).toBe(0);
  });

  test('nothing happens for the wrong fight, or one that is already over', () => {
    const g = confirmed();
    expect(cancelCombat(g, 'nope')).toBe(g);
    const off = cancelCombat(g, 'c1');
    expect(cancelCombat(off, 'c1')).toBe(off);
    const idle = pod();
    expect(cancelCombat(idle, 'c1')).toBe(idle);
  });
});

describe('applyCombat', () => {
  const NOTHING: CombatOutcome = { players: [], deaths: [] };

  test('only at the damage step, only for this fight, and only once', () => {
    const blocking = confirmed();
    expect(applyCombat(blocking, 'c1', NOTHING)).toBe(blocking);
    const damage = atDamage();
    expect(applyCombat(damage, 'nope', NOTHING)).toBe(damage);
    const done = applyCombat(damage, 'c1', { players: [{ seat: 1, life: -2 }], deaths: [] });
    expect(done.combat).toEqual({ id: 'c1', turn: 1, active: 0, step: 'done' });
    expect(done.players[1].life).toBe(38);
    expect(applyCombat(done, 'c1', { players: [{ seat: 1, life: -2 }], deaths: [] })).toBe(done); // not twice
  });

  test('each player is changed in one go: at 3 life, 4 damage and 2 gained leave him alive at 1', () => {
    const at3 = adjustLife(atDamage(), 1, -37);
    const done = applyCombat(at3, 'c1', { players: [{ seat: 1, life: -2 }, { seat: 0, life: 3 }], deaths: [] });
    expect(done.players[1]).toMatchObject({ life: 1, eliminated: false });
    expect(done.players[0].life).toBe(43);
  });

  test('commander damage goes on the gauge and is not taken off life a second time; poison is added', () => {
    let g = atDamage();
    g = { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, counters: { poison: 3 } } : p)) };
    const done = applyCombat(g, 'c1', {
      players: [{ seat: 1, life: -5, commander: { p0: 3 }, poison: 2 }],
      deaths: [],
    });
    expect(done.players[1].life).toBe(35);
    expect(done.players[1].commanderDamage).toEqual({ p0: 3 });
    expect(done.players[1].counters.poison).toBe(5); // a proliferate that landed in between survives
  });

  test('a dead card goes to its owner’s graveyard without what it wore on the battlefield', () => {
    const g = seat(atDamage(), 1, [onField('wall', { counters: { p1p1: 2 } })]);
    const done = applyCombat(g, 'c1', {
      players: [],
      deaths: [
        { seat: 0, unit: card('bear') },
        { seat: 1, unit: card('wall') },
      ],
    });
    expect(fieldCard(done, 0, 'bear')).toBeUndefined();
    expect(done.players[0].cards!.graveyard).toEqual([{ iid: 'bear', cardId: 'c-bear', name: 'bear' }]);
    expect(done.players[1].cards!.graveyard.map((c) => c.iid)).toEqual(['wall']);
    expect(fieldCard(done, 0, 'wolf')).toBeDefined();
  });

  test('a dead commander goes home and its next cast costs two more', () => {
    let g = atDamage();
    g = {
      ...g,
      players: g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, cmd: { bear: 1 } } } : p)),
    };
    const home = applyCombat(g, 'c1', { players: [], deaths: [{ seat: 0, unit: card('bear'), toCommand: true }] });
    expect(home.players[0].cards!.command.map((c) => c.iid)).toEqual(['bear']);
    expect(home.players[0].cards!.cmd).toEqual({ bear: 2 });
    expect(home.players[0].commanderDeaths).toBe(1);
    // without the tick it is an ordinary death: the graveyard, and no tax
    const buried = applyCombat(g, 'c1', { players: [], deaths: [{ seat: 0, unit: card('bear') }] });
    expect(buried.players[0].cards!.graveyard.map((c) => c.iid)).toEqual(['bear']);
    expect(buried.players[0].cards!.cmd).toEqual({ bear: 1 });
  });

  test('dead copies leave their stack, and the dead attackers take their tap with them', () => {
    const g = atDamage(); // five soldiers, three of them tapped attackers
    const done = applyCombat(g, 'c1', {
      players: [],
      deaths: [
        { seat: 0, unit: stack('soldiers'), n: 2, tapped: 2 },
        { seat: 1, unit: stack('saprolings'), n: 3 },
      ],
    });
    expect(item(done, 0, 'soldiers')).toMatchObject({ count: 3, tapped: 1 }); // the two at home still stand
    expect(item(done, 1, 'saprolings')).toBeUndefined(); // all three gone: so is the stack
  });

  test('a commander kept as a tile goes home too: the tile leaves and the seat’s tax goes up by one', () => {
    const g = seat(atDamage(), 3, null, [tokens('Kim’s commander', 1)]);
    const done = applyCombat(g, 'c1', {
      players: [],
      deaths: [{ seat: 3, unit: stack('Kim’s commander'), toCommand: true }],
    });
    expect(done.players[3].board).toEqual([]);
    expect(done.players[3].commanderDeaths).toBe(1);
    // a tile that is already gone raises nothing
    const twice = applyCombat(seat(g, 3, null, []), 'c1', {
      players: [],
      deaths: [{ seat: 3, unit: stack('Kim’s commander'), toCommand: true }],
    });
    expect(twice.players[3].commanderDeaths).toBe(0);
  });

  test('whatever has left since is skipped, and the rest still lands', () => {
    const g = seat(atDamage(), 0, [onField('wolf', { tapped: true })], []); // bear and soldiers left meanwhile
    const done = applyCombat(g, 'c1', {
      players: [{ seat: 1, life: -1 }],
      deaths: [
        { seat: 0, unit: card('bear') },
        { seat: 0, unit: stack('soldiers'), n: 2, tapped: 2 },
        { seat: 0, unit: card('wolf') },
      ],
    });
    expect(done.players[0].cards!.graveyard.map((c) => c.iid)).toEqual(['wolf']);
    expect(done.players[1].life).toBe(39);
    expect(done.combat!.step).toBe('done');
  });

  test('an outcome that makes no sense changes no life and breaks nothing, and the fight still ends', () => {
    const g = atDamage();
    for (const junk of [undefined, null, {}, { players: 'x', deaths: 7 }, { players: [null, { seat: 'a' }], deaths: [null, { seat: 0 }, { seat: 0, unit: { kind: 'x' } }] }]) {
      const done = applyCombat(g, 'c1', junk as never);
      expect(done.combat!.step).toBe('done');
      expect(done.players).toEqual(g.players);
    }
  });
});

describe('dropCombat', () => {
  test('takes the fight out of the state, and hands back the same state when there is none', () => {
    const g = confirmed();
    const dropped = dropCombat(g);
    expect('combat' in dropped).toBe(false);
    expect(dropped.players).toBe(g.players);
    const none = pod();
    expect(dropCombat(none)).toBe(none);
  });
});

describe('what a replay may land on (the guards’ questions)', () => {
  test('sameRecord: the very combat record this device saw, finished ones included', () => {
    const none = pod();
    const live = declared();
    const done = cancelCombat(live, 'c1');
    expect(sameRecord(none, pod())).toBe(true);
    expect(sameRecord(live, declared())).toBe(true);
    expect(sameRecord(none, live)).toBe(false);
    expect(sameRecord(live, done)).toBe(false); // same id, but it has finished since
    expect(sameRecord(done, cancelCombat(declared(), 'c1'))).toBe(true);
    expect(sameRecord(done, startCombat(done, { ...STAMP, id: 'c2' }))).toBe(false);
  });

  test('sameLiveCombat: the same fight, or none on both sides', () => {
    const live = declared();
    expect(sameLiveCombat(pod(), pod())).toBe(true);
    expect(sameLiveCombat(live, confirmed())).toBe(true); // its step may have moved
    expect(sameLiveCombat(pod(), live)).toBe(false);
    expect(sameLiveCombat(live, pod())).toBe(false);
    expect(sameLiveCombat(cancelCombat(live, 'c1'), pod())).toBe(true); // a finished one is none
    const other = startCombat(cancelCombat(live, 'c1'), { ...STAMP, id: 'c2' });
    expect(sameLiveCombat(other, live)).toBe(false);
  });

  test('sameStep: the same live fight at the same step', () => {
    expect(sameStep(declared(), started())).toBe(true); // picks differ, the step does not
    expect(sameStep(confirmed(), declared())).toBe(false);
    expect(sameStep(pod(), pod())).toBe(false); // no fight is no step
    expect(sameStep(finishBlocks(confirmed(), 'c1', 1), confirmed())).toBe(true); // still blockers
  });

  test('sameAttacks: the same declaration — units, targets and counts — at the same step', () => {
    const a = confirmed();
    expect(sameAttacks(a, confirmed())).toBe(true);
    expect(sameAttacks(setBlock(a, 'c1', 1, card('bear'), card('wall'), 1), a)).toBe(true); // blocks are not attacks
    expect(sameAttacks(finishBlocks(a, 'c1', 1), a)).toBe(true); // nor is whose turn it is to block
    expect(sameAttacks(atDamage(), a)).toBe(false); // but the step is
    // undo, then a different declaration under the same id
    let other = started();
    other = setAttack(other, 'c1', card('hawk'), 1, 1);
    other = setAttack(other, 'c1', card('wolf'), 2, 1);
    other = setAttack(other, 'c1', stack('soldiers'), 1, 3);
    expect(sameAttacks(confirmed(other), a)).toBe(false); // another unit
    expect(sameAttacks(confirmed(setAttack(declared(), 'c1', card('bear'), 2, 1)), a)).toBe(false); // another target
    expect(sameAttacks(confirmed(setAttack(declared(), 'c1', stack('soldiers'), 1, 2)), a)).toBe(false); // another count
    // the same picks made in another order are the same declaration
    let shuffled = started();
    shuffled = setAttack(shuffled, 'c1', stack('soldiers'), 1, 3);
    shuffled = setAttack(shuffled, 'c1', card('wolf'), 2, 1);
    shuffled = setAttack(shuffled, 'c1', card('bear'), 1, 1);
    expect(sameAttacks(confirmed(shuffled), a)).toBe(true);
    expect(sameAttacks(pod(), pod())).toBe(false);
  });

  test('sameDefender: the same player is up to block', () => {
    const sam = confirmed();
    expect(sameDefender(sam, confirmed())).toBe(true);
    expect(sameDefender(finishBlocks(sam, 'c1', 1), sam)).toBe(false);
    expect(sameDefender(atDamage(), atDamage())).toBe(true); // nobody, on both sides
  });

  test('sameBlocks: the same blockers on the same attacks, in the same order, and the same paper marks', () => {
    const blocked = setBlock(setBlock(confirmed(), 'c1', 1, card('bear'), card('wall'), 1), 'c1', 1, card('bear'), card('ogre'), 1);
    const again = setBlock(setBlock(confirmed(), 'c1', 1, card('bear'), card('wall'), 1), 'c1', 1, card('bear'), card('ogre'), 1);
    expect(sameBlocks(blocked, again)).toBe(true);
    expect(sameBlocks(blocked, confirmed())).toBe(false);
    const reversed = setBlock(setBlock(confirmed(), 'c1', 1, card('bear'), card('ogre'), 1), 'c1', 1, card('bear'), card('wall'), 1);
    expect(sameBlocks(blocked, reversed)).toBe(false); // the order decides who is hit first
    expect(sameBlocks(setBlocked(confirmed(), 'c1', 1, card('bear'), true), confirmed())).toBe(false);
    const two = setBlock(confirmed(), 'c1', 1, card('bear'), stack('saprolings'), 2);
    const one = setBlock(confirmed(), 'c1', 1, card('bear'), stack('saprolings'), 1);
    expect(sameBlocks(two, one)).toBe(false);
    expect(sameBlocks(atDamage(blocked), atDamage(again))).toBe(true);
  });
});

describe('the lines the feed gets', () => {
  test('an attack on one player counts the attackers', () => {
    let g = setAttack(started(), 'c1', card('bear'), 1, 1);
    expect(attackLine(g, liveCombat(g)!)).toBe('Nathan attacks Sam with 1 creature');
    g = setAttack(g, 'c1', stack('soldiers'), 1, 2);
    expect(attackLine(g, liveCombat(g)!)).toBe('Nathan attacks Sam with 3 creatures');
  });

  test('an attack on several players says how many go at each', () => {
    const g = declared();
    expect(attackLine(g, liveCombat(g)!)).toBe('Nathan attacks Sam (4) and Alex (1)');
    const three = setAttack(g, 'c1', card('hawk'), 3, 1);
    expect(attackLine(three, liveCombat(three)!)).toBe('Nathan attacks Sam (4), Alex (1) and Kim (1)');
  });

  test('a block counts the attackers that were stopped', () => {
    const g = confirmed();
    expect(blockLine(g, liveCombat(g)!, 1)).toBe("Sam doesn't block");
    const one = setBlock(g, 'c1', 1, card('bear'), card('wall'), 1);
    expect(blockLine(one, liveCombat(one)!, 1)).toBe('Sam blocks 1 attacker');
    // two blockers on one attacker stop one attacker; two saprolings stop two soldiers
    let more = setBlock(one, 'c1', 1, card('bear'), card('ogre'), 1);
    more = setBlock(more, 'c1', 1, stack('soldiers'), stack('saprolings'), 2);
    expect(blockLine(more, liveCombat(more)!, 1)).toBe('Sam blocks 3 attackers');
    expect(blockLine(more, liveCombat(more)!, 2)).toBe("Alex doesn't block");
    // a paper blocker stops the whole attack it is marked on
    const paper = setBlocked(g, 'c1', 1, stack('soldiers'), true);
    expect(blockLine(paper, liveCombat(paper)!, 1)).toBe('Sam blocks 3 attackers');
  });

  test('the result names who took what, and names the dead when there are three or fewer', () => {
    const g = atDamage();
    expect(
      outcomeLine(g, {
        players: [{ seat: 1, life: -5, commander: { p0: 3 } }],
        deaths: [{ seat: 1, unit: card('wall') }],
      }),
    ).toBe('Combat: Sam takes 5 (3 commander) · wall dies');
    expect(
      outcomeLine(g, {
        players: [
          { seat: 1, life: -2 },
          { seat: 2, life: -1 },
        ],
        deaths: [
          { seat: 1, unit: card('wall') },
          { seat: 0, unit: stack('soldiers'), n: 2, tapped: 2 },
        ],
      }),
    ).toBe('Combat: Sam takes 2 · Alex takes 1 · wall and soldiers ×2 die');
    expect(outcomeLine(g, { players: [], deaths: [] })).toBe('Combat: no damage');
  });

  test('more than three dead are counted, but a commander is always named', () => {
    let g = atDamage();
    g = {
      ...g,
      players: g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, cmd: { bear: 0 } } } : p)),
    };
    const many: CombatOutcome = {
      players: [],
      deaths: [
        { seat: 0, unit: stack('soldiers'), n: 3, tapped: 3 },
        { seat: 1, unit: card('wall') },
      ],
    };
    expect(outcomeLine(g, many)).toBe('Combat: 4 creatures die');
    expect(
      outcomeLine(g, { players: [], deaths: [...many.deaths, { seat: 0, unit: card('bear'), toCommand: true }] }),
    ).toBe('Combat: bear and 4 creatures die');
    // named even when its owner sends it to the graveyard instead
    expect(outcomeLine(g, { players: [], deaths: [...many.deaths, { seat: 0, unit: card('bear') }] })).toBe(
      'Combat: bear and 4 creatures die',
    );
  });

  test('poison, life gained and an infect commander each get their words', () => {
    const g = atDamage();
    expect(
      outcomeLine(g, {
        players: [
          { seat: 1, life: 0, commander: { p0: 4 }, poison: 4 },
          { seat: 0, life: 3 },
          { seat: 2, life: -4, poison: 1 },
        ],
        deaths: [],
      }),
    ).toBe('Combat: Sam takes 4 commander damage and gets 4 poison · Nathan gains 3 · Alex takes 4 and gets 1 poison');
    expect(outcomeLine(g, { players: [{ seat: 1, life: 0, poison: 11 }], deaths: [] })).toBe(
      'Combat: Sam gets 11 poison',
    );
  });

  test('outcomeDefeats says whom the result would defeat, without changing anything', () => {
    const g = adjustLife(atDamage(), 1, -37); // Sam at 3
    expect(outcomeDefeats(g, { players: [{ seat: 1, life: -2 }], deaths: [] })).toEqual([]);
    expect(outcomeDefeats(g, { players: [{ seat: 1, life: -3 }, { seat: 2, life: -1 }], deaths: [] })).toEqual([1]);
    expect(outcomeDefeats(g, { players: [{ seat: 2, life: -21, commander: { p0: 21 } }], deaths: [] })).toEqual([2]);
    expect(outcomeDefeats(g, { players: [{ seat: 2, life: 0, poison: 10 }], deaths: [] })).toEqual([2]);
    expect(g.players[1].life).toBe(3);
    expect(outcomeDefeats(g, null as never)).toEqual([]);
  });
});
