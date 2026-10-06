import { describe, expect, test } from 'vitest';
import {
  appendFeed,
  bottomCards,
  buildSeatCards,
  commanderDied,
  draw,
  keepHand,
  millN,
  moveCard,
  mulberry32,
  mulligan,
  newIid,
  seedSeat,
  setCardCounter,
  setHandHeld,
  tapCard,
  untapAllCards,
} from './cards';
import { addCard, changeCardCount, createDeck, setCommander } from './deck';
import { createGame } from './game';
import type { CardRecord, Deck, GameConfig, GameState } from './types';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

function record(id: string, name: string, typeLine: string): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    colorIdentity: ['G'],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

function sampleDeck(): Deck {
  let d = setCommander(createDeck('Stompy'), record('c-cmd', 'Ashaya', 'Legendary Creature — Elemental'));
  d = addCard(d, record('c-forest', 'Forest', 'Basic Land — Forest'));
  d = changeCardCount(d, 'c-forest', 9); // 10 forests
  d = addCard(d, record('c-elves', 'Llanowar Elves', 'Creature — Elf Druid'));
  d = addCard(d, record('c-sol', 'Sol Ring', 'Artifact'));
  return d;
}

function seeded(): GameState {
  const g = createGame(config);
  return seedSeat(g, 0, buildSeatCards(sampleDeck(), 42));
}

describe('buildSeatCards', () => {
  test('explodes counts, commander to command, seven to hand, deterministic by seed', () => {
    const a = buildSeatCards(sampleDeck(), 42);
    const b = buildSeatCards(sampleDeck(), 42);
    const c = buildSeatCards(sampleDeck(), 7);
    expect(a.command).toHaveLength(1);
    expect(a.command[0].name).toBe('Ashaya');
    expect(a.hand).toHaveLength(7);
    expect(a.library).toHaveLength(5); // 12 nonCommander - 7 hand
    expect(a.mulligans).toBe(0);
    expect(a.deckName).toBe('Stompy');
    expect(a.hand.map((x) => x.cardId)).toEqual(b.hand.map((x) => x.cardId)); // same seed, same order
    expect(a.hand.map((x) => x.cardId)).not.toEqual(c.hand.map((x) => x.cardId));
    const all = [...a.library, ...a.hand];
    expect(new Set(all.map((x) => x.iid)).size).toBe(12); // unique instances
  });
});

describe('seedSeat', () => {
  test('installs once; a seat that already has cards is untouched', () => {
    const g = seeded();
    expect(g.players[0].cards?.hand).toHaveLength(7);
    const again = seedSeat(g, 0, buildSeatCards(sampleDeck(), 99));
    expect(again).toBe(g);
  });
});

describe('keepHand', () => {
  test('bottoms the picks and marks the hand kept', () => {
    const g = seeded();
    const iids = g.players[0].cards!.hand.slice(0, 2).map((c) => c.iid);
    const kept = keepHand(g, 0, iids);
    expect(kept.players[0].cards?.kept).toBe(true);
    expect(kept.players[0].cards?.hand).toHaveLength(5);
    expect(kept.players[0].cards?.library.slice(-2).map((c) => c.iid)).toEqual(iids);
  });

  test('keeping with no bottoms still marks kept, and kept is terminal', () => {
    const g = seeded();
    const kept = keepHand(g, 0, []);
    expect(kept.players[0].cards?.kept).toBe(true);
    expect(keepHand(kept, 0, [])).toBe(kept); // idempotent
    const iid = kept.players[0].cards!.hand[0].iid;
    expect(keepHand(kept, 0, [iid])).toBe(kept); // a replayed keep can't re-bottom
  });

  test('a failed bottoming marks nothing', () => {
    const g = seeded();
    expect(keepHand(g, 0, ['not-a-real-iid'])).toBe(g);
  });
});

describe('commanderDied from other zones', () => {
  test('returns a commander from the graveyard with the death counted', () => {
    const g = seeded();
    const cmd = g.players[0].cards!.command[0];
    const cast = moveCard(g, 0, cmd.iid, 'command', 'battlefield', { row: 'front' });
    const wiped = moveCard(cast, 0, cmd.iid, 'battlefield', 'graveyard');
    const back = commanderDied(wiped, 0, cmd.iid, 'graveyard');
    expect(back.players[0].cards?.command.some((c) => c.iid === cmd.iid)).toBe(true);
    expect(back.players[0].commanderDeaths).toBe(1);
  });
});

describe('setHandHeld', () => {
  test('marks the hand as phone-held and clears the field on release', () => {
    const g = seeded();
    const held = setHandHeld(g, 0, true);
    expect(held.players[0].cards?.handHeld).toBe(true);
    const released = setHandHeld(held, 0, false);
    expect(released.players[0].cards?.handHeld).toBeUndefined(); // omit, never write false
    expect('handHeld' in released.players[0].cards!).toBe(false);
  });

  test('no-ops when already in that state or the seat has no cards', () => {
    const g = seeded();
    expect(setHandHeld(g, 0, false)).toBe(g); // already un-held
    const held = setHandHeld(g, 0, true);
    expect(setHandHeld(held, 0, true)).toBe(held); // replay-safe
    expect(setHandHeld(g, 1, true)).toBe(g); // tracker seat
  });
});

describe('draw / mill / bottom', () => {
  test('draw moves the exact captured iids to hand', () => {
    const g = seeded();
    const top2 = g.players[0].cards!.library.slice(0, 2).map((c) => c.iid);
    const g2 = draw(g, 0, top2);
    expect(g2.players[0].cards!.hand).toHaveLength(9);
    expect(g2.players[0].cards!.library).toHaveLength(3);
    expect(g2.players[0].cards!.hand.slice(-2).map((c) => c.iid)).toEqual(top2);
  });

  test('a draw whose iid left the library is a no-op', () => {
    const g = seeded();
    expect(draw(g, 0, ['nope'])).toBe(g);
  });

  test('mill sends tops to the graveyard, last = top', () => {
    const g = seeded();
    const top = g.players[0].cards!.library[0].iid;
    const g2 = millN(g, 0, [top]);
    expect(g2.players[0].cards!.graveyard.at(-1)?.iid).toBe(top);
  });

  test('bottomCards sinks hand cards in order', () => {
    const g = seeded();
    const [h1, h2] = g.players[0].cards!.hand.slice(0, 2).map((c) => c.iid);
    const g2 = bottomCards(g, 0, [h1, h2]);
    const lib = g2.players[0].cards!.library;
    expect(lib.at(-2)?.iid).toBe(h1);
    expect(lib.at(-1)?.iid).toBe(h2);
    expect(g2.players[0].cards!.hand).toHaveLength(5);
  });
});

describe('moveCard + battlefield state', () => {
  test('playing, tapping, and killing strips battlefield-only fields on exit', () => {
    let g = seeded();
    const iid = g.players[0].cards!.hand[0].iid;
    g = moveCard(g, 0, iid, 'hand', 'battlefield', { row: 'front' });
    expect(g.players[0].cards!.battlefield[0].row).toBe('front');
    g = tapCard(g, 0, iid, true);
    expect(g.players[0].cards!.battlefield[0].tapped).toBe(true);
    g = setCardCounter(g, 0, iid, 'p1p1', 2);
    g = moveCard(g, 0, iid, 'battlefield', 'graveyard');
    const dead = g.players[0].cards!.graveyard.at(-1)!;
    expect(dead.iid).toBe(iid);
    expect(dead.tapped).toBeUndefined();
    expect(dead.counters).toBeUndefined();
    expect(dead.row).toBeUndefined();
  });

  test('tap sets an explicit direction; untap deletes the field instead of writing false', () => {
    let g = seeded();
    const iid = g.players[0].cards!.hand[0].iid;
    g = moveCard(g, 0, iid, 'hand', 'battlefield', { row: 'front' });
    g = tapCard(g, 0, iid, true);
    expect(g.players[0].cards!.battlefield[0].tapped).toBe(true);
    const same = tapCard(g, 0, iid, true); // already there: no-op, replay-safe
    expect(same).toBe(g);
    g = tapCard(g, 0, iid, false);
    expect('tapped' in g.players[0].cards!.battlefield[0]).toBe(false);
  });

  test('a same-zone battlefield move keeps tapped state and counters', () => {
    let g = seeded();
    const iid = g.players[0].cards!.hand[0].iid;
    g = moveCard(g, 0, iid, 'hand', 'battlefield', { row: 'front' });
    g = tapCard(g, 0, iid, true);
    g = setCardCounter(g, 0, iid, 'p1p1', 3);
    g = moveCard(g, 0, iid, 'battlefield', 'battlefield', { row: 'lands' });
    const card = g.players[0].cards!.battlefield.find((c) => c.iid === iid)!;
    expect(card.row).toBe('lands');
    expect(card.tapped).toBe(true);
    expect(card.counters?.p1p1).toBe(3);
  });

  test('moving to library top vs bottom lands at the right end', () => {
    let g = seeded();
    const iid = g.players[0].cards!.hand[0].iid;
    g = moveCard(g, 0, iid, 'hand', 'library', { pos: 'top' });
    expect(g.players[0].cards!.library[0].iid).toBe(iid);
    const iid2 = g.players[0].cards!.hand[0].iid;
    g = moveCard(g, 0, iid2, 'hand', 'library', { pos: 'bottom' });
    expect(g.players[0].cards!.library.at(-1)?.iid).toBe(iid2);
  });

  test('wrong source zone is a total no-op', () => {
    const g = seeded();
    const iid = g.players[0].cards!.hand[0].iid;
    expect(moveCard(g, 0, iid, 'graveyard', 'exile')).toBe(g);
  });

  test('untapAllCards readies the battlefield', () => {
    let g = seeded();
    const [a, b] = g.players[0].cards!.hand.slice(0, 2).map((c) => c.iid);
    g = moveCard(g, 0, a, 'hand', 'battlefield', { row: 'front' });
    g = moveCard(g, 0, b, 'hand', 'battlefield', { row: 'front' });
    g = tapCard(g, 0, a, true);
    g = tapCard(g, 0, b, true);
    g = untapAllCards(g, 0);
    expect(g.players[0].cards!.battlefield.some((c) => c.tapped)).toBe(false);
  });
});

describe('commander + mulligan', () => {
  test('commanderDied returns it to command and raises the tax', () => {
    let g = seeded();
    const cmd = g.players[0].cards!.command[0].iid;
    g = moveCard(g, 0, cmd, 'command', 'battlefield', { row: 'front' });
    g = commanderDied(g, 0, cmd);
    expect(g.players[0].cards!.command[0].iid).toBe(cmd);
    expect(g.players[0].commanderDeaths).toBe(1);
  });

  test('mulligan reshuffles hand into library, draws seven, counts up', () => {
    const g = seeded();
    const g2 = mulligan(g, 0, 7);
    expect(g2.players[0].cards!.hand).toHaveLength(7);
    expect(g2.players[0].cards!.library).toHaveLength(5);
    expect(g2.players[0].cards!.mulligans).toBe(1);
    const g3 = mulligan(g, 0, 7);
    expect(g3.players[0].cards!.hand.map((c) => c.iid)).toEqual(
      g2.players[0].cards!.hand.map((c) => c.iid),
    ); // seed-deterministic
  });
});

describe('feed + utilities', () => {
  test('appendFeed dedups by id and caps at 30', () => {
    let g = seeded();
    for (let i = 0; i < 35; i++) g = appendFeed(g, { id: `e${i}`, t: i, text: `line ${i}` });
    g = appendFeed(g, { id: 'e34', t: 99, text: 'dupe' });
    expect(g.feed).toHaveLength(30);
    expect(g.feed!.at(-1)?.text).toBe('line 34');
  });

  test('mulberry32 is deterministic; newIid is unique-ish', () => {
    const r1 = mulberry32(5);
    const r2 = mulberry32(5);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    const ids = new Set(Array.from({ length: 200 }, () => newIid()));
    expect(ids.size).toBe(200);
    expect(newIid()).toMatch(/^[a-z0-9]{10}$/);
  });

  test('four full seats serialize well under the egress budget', () => {
    let big = createDeck('Big');
    big = setCommander(big, record('c-cmd', 'Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'));
    for (let i = 0; i < 99; i++) {
      big = addCard(big, record(`c-${i}`, `Card Number ${i} With A Longish Name`, 'Creature — Beast'));
    }
    let g = createGame({
      ...config,
      profiles: [
        { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
        { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
        { id: 'p2', name: 'C', avatarUrl: null, commanderName: null },
        { id: 'p3', name: 'D', avatarUrl: null, commanderName: null },
      ],
    });
    for (let seat = 0; seat < 4; seat++) g = seedSeat(g, seat, buildSeatCards(big, seat));
    expect(JSON.stringify(g).length).toBeLessThan(150_000);
  });
});
