import { describe, expect, test } from 'vitest';
import {
  appendFeed,
  arrangeTop,
  bottomCards,
  buildSeatCards,
  commanderDied,
  commanderTax,
  draw,
  isCommander,
  keepHand,
  millN,
  moveCard,
  mulberry32,
  mulligan,
  newIid,
  seedSeat,
  setCardCounter,
  setHandHeld,
  spendMana,
  tapCard,
  untapAllCards,
} from './cards';
import { addCard, changeCardCount, createDeck, setCommander, setPartner } from './deck';
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

describe('partner commanders', () => {
  function pairDeck(): Deck {
    const thrasios = record('c-thrasios', 'Thrasios', 'Legendary Creature — Merfolk');
    const tymna = record('c-tymna', 'Tymna', 'Legendary Creature — Human');
    let d = setPartner(setCommander(createDeck('Pair'), thrasios), tymna);
    d = addCard(d, record('c-forest', 'Forest', 'Basic Land — Forest'));
    d = changeCardCount(d, 'c-forest', 9);
    return d;
  }
  const pairGame = () => seedSeat(createGame(config), 0, buildSeatCards(pairDeck(), 42));

  test('both commanders start in the command zone, each with a clean tax record', () => {
    const cards = buildSeatCards(pairDeck(), 42);
    expect(cards.command.map((c) => c.name)).toEqual(['Thrasios', 'Tymna']);
    expect(cards.cmd).toEqual({ [cards.command[0].iid]: 0, [cards.command[1].iid]: 0 });
  });

  test('a single commander is tracked the same way', () => {
    const cards = buildSeatCards(sampleDeck(), 42);
    expect(cards.cmd).toEqual({ [cards.command[0].iid]: 0 });
  });

  test('each commander pays its own tax', () => {
    const g = pairGame();
    const [thrasios, tymna] = g.players[0].cards!.command;
    const cast = moveCard(g, 0, thrasios.iid, 'command', 'battlefield', { row: 'front' });
    const died = commanderDied(cast, 0, thrasios.iid);
    expect(commanderTax(died.players[0], thrasios.iid)).toBe(2);
    expect(commanderTax(died.players[0], tymna.iid)).toBe(0); // untouched by its partner's death
    expect(died.players[0].commanderDeaths).toBe(1); // the tracker's total still counts
  });

  test('knows which cards are commanders, wherever they are', () => {
    const g = pairGame();
    const seat = g.players[0].cards!;
    expect(isCommander(seat, seat.command[1].iid)).toBe(true);
    expect(isCommander(seat, seat.hand[0].iid)).toBe(false);
  });

  test('a seat dealt before commanders were tracked falls back to the old rules', () => {
    const g = pairGame();
    const { cmd: _cmd, ...legacy } = g.players[0].cards!;
    const player = { ...g.players[0], cards: legacy, commanderDeaths: 2 };
    expect(isCommander(legacy, legacy.command[0].iid)).toBeNull(); // unknown: callers use the old rule
    expect(commanderTax(player, legacy.command[0].iid)).toBe(4); // shared counter, as before
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

describe('arrangeTop (scry, surveil, look-and-pick)', () => {
  const top3 = (g: GameState) => g.players[0].cards!.library.slice(0, 3).map((c) => c.iid);

  test('puts the looked-at cards where told: reordered on top, bottom, hand', () => {
    const g = seeded(); // five cards in the library
    const [a, b, c] = top3(g);
    const untouched = g.players[0].cards!.library.slice(3).map((x) => x.iid);
    const next = arrangeTop(g, 0, [a, b, c], { top: [c], bottom: [a], graveyard: [], hand: [b] });
    const seat = next.players[0].cards!;
    expect(seat.library.map((x) => x.iid)).toEqual([c, ...untouched, a]); // c on top, a at the very bottom
    expect(seat.hand.at(-1)!.iid).toBe(b);
    expect(seat.hand).toHaveLength(8);
  });

  test('surveil: cards sent to the graveyard land there in the order given', () => {
    const g = seeded();
    const [a, b, c] = top3(g);
    const next = arrangeTop(g, 0, [a, b, c], { top: [b], bottom: [], graveyard: [c, a], hand: [] });
    expect(next.players[0].cards!.graveyard.map((x) => x.iid)).toEqual([c, a]);
    expect(next.players[0].cards!.library[0].iid).toBe(b);
  });

  test('a plan must account for exactly the cards that were looked at', () => {
    const g = seeded();
    const [a, b, c] = top3(g);
    expect(arrangeTop(g, 0, [a, b, c], { top: [a, b], bottom: [], graveyard: [], hand: [] })).toBe(g); // one missing
    expect(arrangeTop(g, 0, [a, b], { top: [a, b, c], bottom: [], graveyard: [], hand: [] })).toBe(g); // one extra
    expect(arrangeTop(g, 0, [a, b], { top: [a, a], bottom: [], graveyard: [], hand: [] })).toBe(g); // one twice
  });

  test('is off entirely if a looked-at card has left the library since', () => {
    const g = seeded();
    const [a, b, c] = top3(g);
    const drawn = draw(g, 0, [a]); // someone drew the top card meanwhile
    expect(arrangeTop(drawn, 0, [a, b, c], { top: [a, b, c], bottom: [], graveyard: [], hand: [] })).toBe(
      drawn,
    );
  });

  test('what is still on top after a draw can be arranged on its own', () => {
    const g = seeded();
    const [a, b, c] = top3(g);
    const drawn = draw(g, 0, [a]);
    const next = arrangeTop(drawn, 0, [b, c], { top: [c, b], bottom: [], graveyard: [], hand: [] });
    expect(next.players[0].cards!.library.slice(0, 2).map((x) => x.iid)).toEqual([c, b]);
  });

  test('is off if the cards are no longer on top: a shuffle got in between', () => {
    const g = seeded();
    const [a, b] = top3(g);
    const lib = g.players[0].cards!.library;
    const buried: GameState = {
      ...g,
      players: g.players.map((p, i) =>
        i === 0 ? { ...p, cards: { ...p.cards!, library: [...lib.slice(2), ...lib.slice(0, 2)] } } : p,
      ),
    };
    expect(arrangeTop(buried, 0, [a, b], { top: [b, a], bottom: [], graveyard: [], hand: [] })).toBe(buried);
  });
});

describe('spendMana', () => {
  function withLand(): { g: GameState; iid: string } {
    const g = seeded();
    const iid = g.players[0].cards!.hand[0].iid;
    return { g: moveCard(g, 0, iid, 'hand', 'battlefield', { row: 'lands' }), iid };
  }
  const card = (g: GameState, iid: string) =>
    g.players[0].cards!.battlefield.find((c) => c.iid === iid)!;

  test('taps a fresh card and records the units it paid', () => {
    const { g, iid } = withLand();
    const paid = spendMana(g, 0, iid, 1);
    expect(card(paid, iid)).toMatchObject({ tapped: true, spent: 1 });
  });

  test('draws down a card that was already tapped by hand', () => {
    const { g, iid } = withLand();
    const floating = tapCard(g, 0, iid, true); // manual tap: nothing spent yet
    expect(card(floating, iid).spent).toBeUndefined();
    const once = spendMana(floating, 0, iid, 1);
    expect(card(spendMana(once, 0, iid, 1), iid).spent).toBe(2);
  });

  test('untapping or leaving the battlefield forgets the spend', () => {
    const { g, iid } = withLand();
    const paid = spendMana(g, 0, iid, 1);
    expect(card(tapCard(paid, 0, iid, false), iid).spent).toBeUndefined();
    expect(card(untapAllCards(paid, 0), iid).spent).toBeUndefined();
    const bounced = moveCard(paid, 0, iid, 'battlefield', 'hand');
    expect(bounced.players[0].cards!.hand.find((c) => c.iid === iid)).not.toHaveProperty('spent');
  });

  test('no-ops on a card that is not on the battlefield', () => {
    const g = seeded();
    expect(spendMana(g, 0, 'nope', 1)).toBe(g);
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
