import { describe, expect, test } from 'vitest';
import { attachCard } from './cards';
import { readUnit } from './combatEngine';
import { createGame } from './game';
import { effectOf, modesToChoose, opponentsOf, planEffect, spellChoices, spellPrompts, type SpellEffect } from './spellEffects';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from './types';

const spell = (oracleText: string, typeLine = 'Instant') => ({ typeLine, oracleText });
const labels = (oracleText: string, x?: number) => spellPrompts(spell(oracleText), { x }).map((p) => p.label);

describe('reading a spell', () => {
  test('burn: the amount, and whether it asks for a target', () => {
    expect(labels('Lightning Bolt deals 3 damage to any target.')).toEqual(['Deal 3 damage…']);
    expect(labels('Shock deals 2 damage to any target.')).toEqual(['Deal 2 damage…']);
    const [bolt] = spellPrompts(spell('Lightning Bolt deals 3 damage to any target.'));
    expect(bolt).toMatchObject({ kind: 'damage', n: 3, pick: { players: 'any', kinds: ['creature'] } });
    expect(spellPrompts(spell('Flame Slash deals 4 damage to target creature.'))[0].pick).toEqual({
      players: null,
      kinds: ['creature'],
    });
    expect(spellPrompts(spell('Lava Spike deals 3 damage to target player or planeswalker.'))[0].pick).toEqual({
      players: 'any',
      kinds: [],
    });
    expect(spellPrompts(spell('Sizzle deals 3 damage to each opponent.'))).toMatchObject([
      { label: 'Deal 3 to each opponent', pick: null },
    ]);
    expect(spellPrompts(spell('Scorching Spear deals 1 damage to target opponent.'))[0].pick).toEqual({
      players: 'opponents',
      kinds: [],
    });
  });

  test('Lightning Helix is two things, in the order the card says them', () => {
    expect(labels('Lightning Helix deals 3 damage to any target and you gain 3 life.')).toEqual([
      'Deal 3 damage…',
      'Gain 3 life',
    ]);
  });

  test('life, both ways', () => {
    expect(labels('Target player draws two cards and loses 2 life.')).toEqual(['A player draws 2…']);
    expect(labels('You draw two cards and you lose 2 life.')).toEqual(['Draw 2', 'Lose 2 life']);
    expect(labels('Each opponent loses 2 life and you gain 2 life.')).toEqual(['Each opponent loses 2', 'Gain 2 life']);
    expect(spellPrompts(spell('Target opponent loses 3 life.'))).toMatchObject([
      { label: 'A player loses 3…', pick: { players: 'opponents', kinds: [] } },
    ]);
  });

  test('drawing is the caster’s unless the card names somebody else', () => {
    expect(labels('Draw two cards.')).toEqual(['Draw 2']); // Divination
    expect(labels('Counter target spell.\nDraw a card.')).toEqual(['Draw 1']);
    expect(labels('Each player draws two cards.')).toEqual([]);
    expect(labels('Destroy target creature. Its controller may draw a card.')).toEqual(['Destroy a creature…']);
  });

  test('tokens: what, and how many', () => {
    const [alarm] = spellPrompts(spell('Create two 1/1 white Soldier creature tokens.')); // Raise the Alarm
    expect(alarm).toMatchObject({
      kind: 'tokens',
      n: 2,
      label: 'Make 2 Soldiers',
      want: { name: 'Soldier', power: '1', toughness: '1', colors: ['W'] },
    });
    expect(labels('Create a Treasure token.')).toEqual(['Make a Treasure']);
    expect(labels('Create three 1/1 green Elf Warrior creature tokens.')).toEqual(['Make 3 Elf Warriors']);
    expect(labels('Create an 1/1 green Elf creature token, then create two 2/2 green Wolf creature tokens.')[0]).toBe(
      'Make an Elf',
    );
    // Somebody else's tokens are not the caster's to make (Beast Within).
    expect(labels('Destroy target permanent. Its controller creates a 3/3 green Beast creature token.')).toEqual([
      'Destroy a permanent…',
    ]);
  });

  test('removal: destroy, exile, back to hand, and what it may point at', () => {
    expect(spellPrompts(spell('Destroy target creature.'))).toMatchObject([
      { key: 'destroy:creature', label: 'Destroy a creature…', pick: { players: null, kinds: ['creature'] } },
    ]); // Murder
    expect(spellPrompts(spell('Destroy target creature or planeswalker.'))[0].pick!.kinds).toEqual([
      'creature',
      'planeswalker',
    ]); // Hero's Downfall
    expect(labels('Destroy target artifact or enchantment.')).toEqual(['Destroy an artifact or enchantment…']); // Naturalize
    expect(labels('Exile target creature. Its controller gains life equal to its power.')).toEqual([
      'Exile a creature…',
    ]); // Swords to Plowshares
    expect(labels("Return target creature to its owner's hand.")).toEqual(['Return to hand…']); // Unsummon
    expect(labels('Destroy target nonblack creature.')).toEqual(['Destroy a creature…']); // Doom Blade
    expect(spellPrompts(spell('Exile target nonland permanent.'))).toMatchObject([
      { label: 'Exile a nonland permanent…', pick: { kinds: ['nonland'] } },
    ]);
    expect(labels('Return target permanent to its owner’s hand.')).toEqual(['Return to hand…']);
    // A flicker is not removal.
    expect(labels('Exile target creature you control, then return that card to the battlefield.')).toEqual([]);
  });

  test('sweepers take one tap', () => {
    expect(spellPrompts(spell("Destroy all creatures. They can't be regenerated.", 'Sorcery'))).toMatchObject([
      { kind: 'sweep', how: 'destroy', label: 'Destroy all creatures', pick: null },
    ]); // Wrath of God
    expect(labels('Exile all creatures.')).toEqual(['Exile all creatures']);
    expect(labels('Destroy all creatures with power 4 or greater.')).toEqual([]);
  });

  test('+1/+1 counters on a creature', () => {
    expect(labels('Put two +1/+1 counters on target creature.')).toEqual(['Put 2 +1/+1 counters…']);
    expect(labels('Put a +1/+1 counter on target creature.')).toEqual(['Put a +1/+1 counter…']);
  });

  test('X is what the spell was cast for; an X nobody named offers nothing', () => {
    const blaze = 'Blaze deals X damage to any target.';
    expect(labels(blaze, 5)).toEqual(['Deal 5 damage…']);
    expect(labels(blaze)).toEqual([]);
    expect(labels(blaze, 0)).toEqual([]);
    expect(
      labels(
        'This spell costs {1} more to cast for each target beyond the first.\nFireball deals X damage divided evenly, rounded down, among any number of targets.',
        4,
      ),
    ).toEqual([]);
    expect(labels('Draw X cards, where X is the number of creatures you control.', 3)).toEqual([]);
  });

  test('what it does not understand has no button', () => {
    expect(
      labels(
        'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      ),
    ).toEqual(['Search library…']); // Cultivate: its search is a list of its own
    expect(labels('Counter target spell.')).toEqual([]);
    expect(labels('Tap target creature.')).toEqual([]);
    expect(labels('Target player discards two cards.')).toEqual([]);
    expect(labels('You gain 2 life for each creature you control.')).toEqual([]);
    expect(labels('Each player sacrifices a creature.')).toEqual([]);
    expect(spellPrompts(null)).toEqual([]);
    expect(spellPrompts(undefined)).toEqual([]);
  });

  test('a modal spell offers every mode it can read', () => {
    const abrade = 'Choose one —\n• Abrade deals 3 damage to target creature.\n• Destroy target artifact.';
    expect(labels(abrade)).toEqual(['Deal 3 damage…', 'Destroy an artifact…']);
  });

  test('each effect of a modal spell says which option it is; a plain spell’s say nothing', () => {
    const tactics =
      'Choose one —\n• Put a +1/+1 counter on target creature you control. It gains hexproof until end of turn.\n• Destroy target creature with power 4 or greater.';
    expect(spellPrompts(spell(tactics)).map((p) => [p.label, p.mode])).toEqual([
      ['Put a +1/+1 counter…', 0],
      ['Destroy a creature…', 1],
    ]);
    // Two effects in one option belong together.
    const charm = 'Choose one —\n• Destroy target artifact. You gain 2 life.\n• Draw two cards.';
    expect(spellPrompts(spell(charm)).map((p) => p.mode)).toEqual([0, 0, 1]);
    expect(spellPrompts(spell('Lightning Helix deals 3 damage to any target and you gain 3 life.')).map((p) => p.mode)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test('how many options a modal spell lets its caster take', () => {
    const modes = '\n• Destroy target artifact.\n• Draw two cards.\n• You gain 4 life.';
    expect(modesToChoose(spell(`Choose one —${modes}`))).toBe(1);
    expect(modesToChoose(spell(`Choose two —${modes}`))).toBe(2);
    expect(modesToChoose(spell(`Choose one or both —${modes}`))).toBe(2);
    expect(modesToChoose(spell(`Choose up to two —${modes}`))).toBe(2);
    // A trigger with options, on a permanent.
    expect(modesToChoose(spell(`Whenever this creature deals combat damage to a player, choose one —${modes}`))).toBe(1);
    // As many as the caster likes: nothing is closed off.
    expect(modesToChoose(spell(`Choose one or more —${modes}`))).toBeNull();
    expect(modesToChoose(spell(`Choose any number —${modes}`))).toBeNull();
    expect(
      modesToChoose(spell(`Choose one. If you control a commander as you cast this spell, you may choose both instead.${modes}`)),
    ).toBeNull();
    expect(modesToChoose(spell(`Choose one —${modes}\nEntwine {2} (Choose both if you pay the entwine cost.)`))).toBeNull();
    // No list of options: not a modal spell, whatever it asks its caster to choose.
    expect(modesToChoose(spell('Choose one of them. Destroy target creature.'))).toBeNull();
    expect(modesToChoose(spell('Draw two cards.'))).toBeNull();
    expect(modesToChoose(undefined)).toBeNull();
  });

  test('only the front face is read, reminder text is not, and four buttons are the most', () => {
    expect(
      spellPrompts({ typeLine: 'Instant // Land', oracleText: 'Draw two cards.\n//\nDestroy target creature.' }).map(
        (p) => p.label,
      ),
    ).toEqual(['Draw 2']);
    expect(labels('Draw a card. (Then you gain 3 life.)')).toEqual(['Draw 1']);
    expect(
      labels(
        'Choose two —\n• You gain 4 life.\n• Draw two cards.\n• Destroy target artifact.\n• Destroy target enchantment.\n• Exile target creature.',
      ),
    ).toHaveLength(4);
    // The same effect twice is one button.
    expect(labels('Draw a card. Then draw a card.')).toEqual(['Draw 1']);
  });
});

// ---- the table ----

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Samantha', avatarUrl: null, commanderName: null },
    { id: 'p2', name: 'Alex', avatarUrl: null, commanderName: null },
  ],
};

function rec(id: string, name: string, typeLine: string, oracleText = '', pt: string | null = null): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '{1}',
    power: pt,
    toughness: pt,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord | undefined> = {
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear', '', '2'),
  'c-giant': rec('c-giant', 'Hill Giant', 'Creature — Giant', '', '3'),
  'c-god': rec('c-god', 'Darksteel Colossus', 'Artifact Creature — Golem', 'Trample, indestructible', '11'),
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  'c-ring': rec('c-ring', 'Sol Ring', 'Artifact', '{T}: Add {C}{C}.'),
  'c-might': rec('c-might', "Giant's Might", 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2.'),
  'c-unread': undefined,
};

const card = (iid: string, cardId: string, name: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name,
  ...more,
});

const stack = (id: string, name: string, count: number, more: Partial<BoardItem> = {}): BoardItem => ({
  id,
  cardId: null,
  name,
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

/** Nathan: a bear and Giant's Might. Samantha: a giant, a colossus, a
 * forest, a Sol Ring, a card nobody can read, three soldiers and a
 * treasure. Alex: nothing. */
function table(): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: seat([card('bear', 'c-bear', 'Grizzly Bears'), card('might', 'c-might', "Giant's Might")]),
  };
  g.players[1] = {
    ...g.players[1],
    board: [
      stack('soldiers', 'Soldier', 3),
      stack('treasure', 'Treasure', 1, { typeLine: 'Token Artifact — Treasure', basePower: null, baseToughness: null }),
    ],
    cards: seat([
      card('giant', 'c-giant', 'Hill Giant'),
      card('god', 'c-god', 'Darksteel Colossus'),
      card('forest', 'c-forest', 'Forest', { row: 'lands' }),
      card('ring', 'c-ring', 'Sol Ring'),
      card('unread', 'c-unread', 'Mystery Card'),
    ]),
  };
  return g;
}

const plan = (g: GameState, effect: SpellEffect, name = 'Lightning Bolt') => planEffect(g, 0, name, effect, RECORDS);
const field = (g: GameState, s: number) => g.players[s].cards!.battlefield.map((c) => c.iid);
const prompt = (text: string) => spellPrompts(spell(text))[0];

describe('what a prompt can point at', () => {
  const names = (g: GameState, s: number, text: string) =>
    spellChoices(g, s, prompt(text), 0, RECORDS).map((c) => [c.name, c.size, c.fate].filter(Boolean).join(' | '));

  test('any target: the player first, then the creatures, each with what the damage does to it', () => {
    const g = table();
    expect(names(g, 1, 'Bolt deals 3 damage to any target.')).toEqual([
      'Samantha · 40 life',
      'Hill Giant | 3/3 | dies',
      'Darksteel Colossus | 11/11 | survives',
      'Mystery Card', // not read: offered, and nothing is said about it
      'Soldier ×3 | 1/1 | dies',
    ]);
    expect(names(g, 0, 'Shock deals 2 damage to any target.')).toEqual(['Nathan · 40 life', 'Grizzly Bears | 2/2 | dies']);
    expect(names(g, 0, 'Zap deals 1 damage to any target.')[1]).toBe('Grizzly Bears | 2/2 | survives');
  });

  test('an opponent-only effect never offers the caster, nor a player who is out', () => {
    const g = table();
    const text = 'Target opponent loses 3 life.';
    expect(names(g, 0, text)).toEqual([]);
    expect(names(g, 1, text)).toEqual(['Samantha · 40 life']);
    g.players[2] = { ...g.players[2], eliminated: true };
    expect(names(g, 2, text)).toEqual([]);
  });

  test('removal offers the kinds the card names', () => {
    const g = table();
    expect(names(g, 1, 'Destroy target artifact or enchantment.')).toEqual([
      'Darksteel Colossus | 11/11',
      'Sol Ring',
      'Mystery Card',
      'Treasure',
    ]);
    expect(names(g, 1, 'Destroy target land.')).toEqual(['Forest', 'Mystery Card']);
    expect(names(g, 1, 'Exile target nonland permanent.')).not.toContain('Forest');
    expect(names(g, 1, 'Exile target permanent.')).toHaveLength(7);
    expect(names(g, 0, 'Destroy target enchantment.')).toEqual(["Giant's Might"]);
  });

  test('counters go on a creature; of the stacks only one that stands alone', () => {
    const g = table();
    const text = 'Put two +1/+1 counters on target creature.';
    expect(names(g, 1, text)).toEqual(['Hill Giant | 3/3', 'Darksteel Colossus | 11/11', 'Mystery Card']);
    g.players[1] = { ...g.players[1], board: [stack('lone', 'Soldier', 1)] };
    expect(names(g, 1, text)).toContain('Soldier | 1/1');
  });

  test('a one-tap prompt has no list', () => {
    expect(spellChoices(table(), 1, prompt('Draw two cards.'), 0, RECORDS)).toEqual([]);
  });
});

describe('turning a prompt into an effect', () => {
  test('with its target, or by itself', () => {
    const giant = { seat: 1, kind: 'card' as const, id: 'giant' };
    const sam = { seat: 1, kind: 'player' as const };
    expect(effectOf(prompt('Bolt deals 3 damage to any target.'), 0, sam)).toEqual({ kind: 'damage', n: 3, on: sam });
    expect(effectOf(prompt('Bolt deals 3 damage to any target.'), 0)).toBeNull();
    expect(effectOf(prompt('Sizzle deals 3 damage to each opponent.'), 0)).toEqual({
      kind: 'damage',
      n: 3,
      on: 'opponents',
    });
    expect(effectOf(prompt('You gain 3 life.'), 2)).toEqual({ kind: 'life', n: 3, gain: true, on: 2 });
    expect(effectOf(prompt('Target player loses 2 life.'), 0, sam)).toEqual({ kind: 'life', n: 2, gain: false, on: 1 });
    expect(effectOf(prompt('Destroy target creature.'), 0, giant)).toEqual({ kind: 'remove', how: 'destroy', on: giant });
    expect(effectOf(prompt('Destroy target creature.'), 0, sam)).toBeNull();
    expect(effectOf(prompt('Exile all creatures.'), 0)).toEqual({ kind: 'sweep', how: 'exile' });
    expect(effectOf(prompt('Put a +1/+1 counter on target creature.'), 0, giant)).toEqual({
      kind: 'counters',
      n: 1,
      on: giant,
    });
    expect(effectOf(prompt('Draw two cards.'), 0)).toBeNull(); // the table draws
  });
});

describe('applying an effect', () => {
  test('damage to a player comes off their life', () => {
    const g = table();
    const p = plan(g, { kind: 'damage', n: 3, on: { seat: 1, kind: 'player' } })!;
    expect(p.text).toBe('Nathan’s Lightning Bolt deals 3 to Samantha');
    const after = p.apply(g);
    expect(after.players[1].life).toBe(37);
    expect(after.players[0].life).toBe(40);
  });

  test('damage to each opponent skips the caster and whoever is out', () => {
    const g = table();
    g.players[2] = { ...g.players[2], eliminated: true };
    expect(opponentsOf(g, 0)).toEqual([1]);
    const p = plan(g, { kind: 'damage', n: 2, on: 'opponents' }, 'Sizzle')!;
    expect(p.text).toBe('Nathan’s Sizzle deals 2 to each opponent');
    expect(p.apply(g).players.map((x) => x.life)).toEqual([40, 38, 40]);
  });

  test('enough damage kills a creature: the card goes to its graveyard', () => {
    const g = table();
    const on = { seat: 1, kind: 'card' as const, id: 'giant' };
    const p = plan(g, { kind: 'damage', n: 3, on })!;
    expect(p.text).toBe('Nathan’s Lightning Bolt deals 3 to Samantha’s Hill Giant (3/3), which dies');
    const after = p.apply(g);
    expect(field(after, 1)).not.toContain('giant');
    expect(after.players[1].cards!.graveyard.map((c) => c.iid)).toEqual(['giant']);
    // Gone meanwhile: the replay does nothing, and its guard says so first.
    expect(p.guard(after)).toBe(false);
    expect(p.apply(after)).toBe(after);
  });

  test('too little damage changes nothing on the table: only the line is said', () => {
    const g = table();
    const on = { seat: 1, kind: 'card' as const, id: 'giant' };
    const p = plan(g, { kind: 'damage', n: 2, on }, 'Shock')!;
    expect(p.text).toBe('Nathan’s Shock deals 2 to Samantha’s Hill Giant (3/3)');
    const after = p.apply(g);
    expect(after).not.toBe(g); // a feed-only op still has to count as one
    expect(after.players).toBe(g.players);
  });

  test('+1/+1 counters are part of its size', () => {
    const g = table();
    g.players[0].cards!.battlefield[0] = { ...g.players[0].cards!.battlefield[0], counters: { p1p1: 2 } };
    const p = plan(g, { kind: 'damage', n: 3, on: { seat: 0, kind: 'card', id: 'bear' } })!;
    expect(p.text).toBe('Nathan’s Lightning Bolt deals 3 to Nathan’s Grizzly Bears (4/4)');
    expect(field(p.apply(g), 0)).toContain('bear');
  });

  test('an indestructible creature and one the app cannot read never die by themselves', () => {
    const g = table();
    const god = plan(g, { kind: 'damage', n: 20, on: { seat: 1, kind: 'card', id: 'god' } })!;
    expect(god.text).toBe('Nathan’s Lightning Bolt deals 20 to Samantha’s Darksteel Colossus (11/11)');
    expect(field(god.apply(g), 1)).toContain('god');
    const unread = plan(g, { kind: 'damage', n: 20, on: { seat: 1, kind: 'card', id: 'unread' } })!;
    expect(unread.text).toBe('Nathan’s Lightning Bolt deals 20 to Samantha’s Mystery Card');
    expect(field(unread.apply(g), 1)).toContain('unread');
  });

  test('a token that dies is one copy off its stack', () => {
    const g = table();
    const p = plan(g, { kind: 'damage', n: 3, on: { seat: 1, kind: 'stack', id: 'soldiers' } })!;
    expect(p.text).toBe('Nathan’s Lightning Bolt deals 3 to Samantha’s Soldier (1/1), which dies');
    expect(p.apply(g).players[1].board.find((it) => it.id === 'soldiers')!.count).toBe(2);
  });

  test('life gained and lost', () => {
    const g = table();
    const gain = plan(g, { kind: 'life', n: 3, gain: true, on: 0 }, 'Lightning Helix')!;
    expect(gain.text).toBe('Nathan gains 3 life from Lightning Helix');
    expect(gain.apply(g).players[0].life).toBe(43);
    const lose = plan(g, { kind: 'life', n: 2, gain: false, on: 0 }, 'Sign in Blood')!;
    expect(lose.text).toBe('Nathan loses 2 life to Sign in Blood');
    expect(lose.apply(g).players[0].life).toBe(38);
    const drain = plan(g, { kind: 'life', n: 2, gain: false, on: 'opponents' }, 'Exsanguinate')!;
    expect(drain.text).toBe('Nathan’s Exsanguinate takes 2 life from each opponent');
    expect(drain.apply(g).players.map((x) => x.life)).toEqual([40, 38, 38]);
    const one = plan(g, { kind: 'life', n: 4, gain: false, on: 2 }, 'Bump in the Night')!;
    expect(one.text).toBe('Nathan’s Bump in the Night takes 4 life from Alex');
    expect(one.apply(g).players[2].life).toBe(36);
  });

  test('destroy, exile and bounce send a card where each says', () => {
    const g = table();
    const on = { seat: 1, kind: 'card' as const, id: 'giant' };
    const murder = plan(g, { kind: 'remove', how: 'destroy', on }, 'Murder')!;
    expect(murder.text).toBe('Nathan’s Murder destroys Samantha’s Hill Giant');
    expect(murder.apply(g).players[1].cards!.graveyard.map((c) => c.iid)).toEqual(['giant']);
    const swords = plan(g, { kind: 'remove', how: 'exile', on }, 'Swords to Plowshares')!;
    expect(swords.text).toBe('Nathan’s Swords to Plowshares exiles Samantha’s Hill Giant');
    expect(swords.apply(g).players[1].cards!.exile.map((c) => c.iid)).toEqual(['giant']);
    const unsummon = plan(g, { kind: 'remove', how: 'bounce', on }, 'Unsummon')!;
    expect(unsummon.text).toBe('Nathan’s Unsummon returns Samantha’s Hill Giant to hand');
    expect(unsummon.apply(g).players[1].cards!.hand.map((c) => c.iid)).toEqual(['giant']);
    // A token that leaves is one copy gone, wherever a card would have gone.
    const token = plan(g, { kind: 'remove', how: 'bounce', on: { seat: 1, kind: 'stack', id: 'treasure' } }, 'Unsummon')!;
    expect(token.apply(g).players[1].board.map((it) => it.id)).toEqual(['soldiers']);
  });

  test('a creature that leaves lets go of what was on it', () => {
    const g = attachCard(table(), 0, 'might', { seat: 0, kind: 'card', id: 'bear' }, 2);
    expect(g.players[0].cards!.battlefield.find((c) => c.iid === 'might')!.on).toBeDefined();
    const after = plan(g, { kind: 'remove', how: 'destroy', on: { seat: 0, kind: 'card', id: 'bear' } }, 'Murder')!.apply(g);
    expect(after.players[0].cards!.battlefield.find((c) => c.iid === 'might')!.on).toBeUndefined();
  });

  test('a sweeper takes every creature the app can see, in one go, and counts them', () => {
    const g = table();
    const wrath = plan(g, { kind: 'sweep', how: 'destroy' }, 'Wrath of God')!;
    // The bear, the giant and three soldiers; not the indestructible one.
    expect(wrath.text).toBe('Nathan’s Wrath of God destroys all creatures (5)');
    const after = wrath.apply(g);
    expect(field(after, 0)).toEqual(['might']);
    expect(field(after, 1)).toEqual(['god', 'forest', 'ring', 'unread']);
    expect(after.players[1].board.map((it) => it.id)).toEqual(['treasure']);
    expect(after.players[1].cards!.graveyard.map((c) => c.iid)).toEqual(['giant']);
    expect(wrath.apply(after)).toBe(after); // nothing left of it to take

    const exile = plan(g, { kind: 'sweep', how: 'exile' }, 'Farewell')!;
    expect(exile.text).toBe('Nathan’s Farewell exiles all creatures (6)');
    expect(exile.apply(g).players[1].cards!.exile.map((c) => c.iid)).toEqual(['giant', 'god']);
  });

  test('a sweeper with no creature to take does nothing at all', () => {
    const g = createGame(config);
    expect(plan(g, { kind: 'sweep', how: 'destroy' }, 'Wrath of God')).toBeNull();
  });

  test('counters are added to what is there when it lands', () => {
    const g = table();
    const on = { seat: 1, kind: 'card' as const, id: 'giant' };
    const p = plan(g, { kind: 'counters', n: 2, on }, 'Burst of Strength')!;
    expect(p.text).toBe('Nathan’s Burst of Strength puts 2 +1/+1 counters on Samantha’s Hill Giant');
    const once = p.apply(g);
    expect(once.players[1].cards!.battlefield[0].counters).toEqual({ p1p1: 2 });
    expect(p.apply(once).players[1].cards!.battlefield[0].counters).toEqual({ p1p1: 4 });
    const lone = plan(g, { kind: 'counters', n: 1, on: { seat: 1, kind: 'stack', id: 'treasure' } }, 'Burst')!;
    expect(lone.text).toBe('Nathan’s Burst puts a +1/+1 counter on Samantha’s Treasure');
    expect(lone.apply(g).players[1].board[1].counters).toEqual({ p1p1: 1 });
  });

  test('a target that is not on the table has no plan', () => {
    const g = table();
    const gone = { seat: 1, kind: 'card' as const, id: 'nope' };
    expect(plan(g, { kind: 'damage', n: 3, on: gone })).toBeNull();
    expect(plan(g, { kind: 'remove', how: 'destroy', on: gone })).toBeNull();
    expect(plan(g, { kind: 'counters', n: 1, on: gone })).toBeNull();
    expect(plan(g, { kind: 'damage', n: 3, on: { seat: 9, kind: 'player' } })).toBeNull();
    expect(plan(g, { kind: 'damage', n: 0, on: { seat: 1, kind: 'player' } })).toBeNull();
  });
});

describe('until end of turn', () => {
  test('a creature getting bigger, smaller, or a keyword, for the turn: one creature is picked, the team is one tap', () => {
    expect(spellPrompts(spell('Target creature gets +3/+3 until end of turn.'))).toMatchObject([
      { kind: 'pump', label: '+3/+3…', power: 3, toughness: 3, keywords: [], team: false, pick: { players: null, kinds: ['creature'] } },
    ]); // Giant Growth
    expect(labels('Target creature gets +2/+0 and gains first strike until end of turn.')).toEqual(['+2/+0 and first strike…']);
    expect(labels('Target creature you control gains hexproof and indestructible until end of turn.')).toEqual([
      'Hexproof and indestructible…',
    ]);
    expect(spellPrompts(spell('Target creature gets -2/-2 until end of turn.'))[0]).toMatchObject({ power: -2, toughness: -2 }); // Disfigure
    expect(spellPrompts(spell('Creatures you control get +3/+3 and gain trample until end of turn.'))).toMatchObject([
      { label: 'Your creatures +3/+3 and trample', pick: null, team: true, other: false, keywords: ['trample'] },
    ]); // Overrun
    expect(spellPrompts(spell('Other creatures you control get +1/+1 until end of turn.'))[0]).toMatchObject({ team: true, other: true });
    expect(labels('Target creature gets +X/+X until end of turn.', 4)).toEqual(['+4/+4…']);
    expect(labels('Target creature gets +X/+X until end of turn.')).toEqual([]); // nobody named X
    expect(labels('Target creature gets +1/+1 until end of turn for each creature you control.')).toEqual([]);
  });

  test('Giant Growth: the creature is +3/+3 for the turn, and its fight says so', () => {
    const g = table();
    const on = { seat: 0, kind: 'card' as const, id: 'bear' };
    const p = plan(g, { kind: 'pump', power: 3, toughness: 3, keywords: [], on }, 'Giant Growth')!;
    expect(p.text).toBe('Nathan’s Giant Growth gives Nathan’s Grizzly Bears +3/+3 until end of turn');
    const after = p.apply(g);
    const bear = readUnit(after, 0, { kind: 'card', id: 'bear' }, RECORDS);
    expect([bear?.power, bear?.toughness]).toEqual([5, 5]);
    // Two of them this turn add up; keywords join.
    const twice = plan(after, { kind: 'pump', power: 1, toughness: 0, keywords: ['trample'], on })!.apply(after);
    const big = readUnit(twice, 0, { kind: 'card', id: 'bear' }, RECORDS);
    expect([big?.power, big?.toughness, big?.granted]).toEqual([6, 5, ['trample']]);
    // The turn passes: it was until end of turn.
    const next = { ...twice, turnNumber: twice.turnNumber + 1, activePlayerIndex: 1 };
    const later = readUnit(next, 0, { kind: 'card', id: 'bear' }, RECORDS);
    expect([later?.power, later?.toughness, later?.granted]).toEqual([2, 2, []]);
  });

  test('a shrink to 0 toughness kills — even what is indestructible — and the list says so first', () => {
    const g = table();
    const p = plan(g, { kind: 'pump', power: -2, toughness: -2, keywords: [], on: { seat: 0, kind: 'card', id: 'bear' } }, 'Disfigure')!;
    expect(p.text).toBe('Nathan’s Disfigure gives Nathan’s Grizzly Bears -2/-2 until end of turn, which dies');
    expect(p.apply(g).players[0].cards!.graveyard.map((c) => c.iid)).toEqual(['bear']);
    const giant = plan(g, { kind: 'pump', power: -2, toughness: -2, keywords: [], on: { seat: 1, kind: 'card', id: 'giant' } })!;
    expect(field(giant.apply(g), 1)).toContain('giant'); // 3/3 → 1/1
    const god = plan(g, { kind: 'pump', power: -11, toughness: -11, keywords: [], on: { seat: 1, kind: 'card', id: 'god' } })!;
    expect(field(god.apply(g), 1)).not.toContain('god'); // 0 toughness is no damage: indestructible does not help
    const disfigure = spellPrompts(spell('Target creature gets -2/-2 until end of turn.'))[0];
    const rows = spellChoices(g, 1, disfigure, 0, RECORDS).map((r) => [r.name, r.fate]);
    expect(rows).toContainEqual(['Hill Giant', 'survives']);
    expect(spellChoices(g, 0, disfigure, 0, RECORDS).map((r) => [r.name, r.fate])).toContainEqual(['Grizzly Bears', 'dies']);
  });

  test('Overrun: every creature of the caster’s, cards and every copy of a stack — not the lands, not anybody else’s', () => {
    const g = table();
    g.players[0] = { ...g.players[0], board: [stack('elves', 'Elf', 2)] };
    const p = plan(g, { kind: 'pump', power: 3, toughness: 3, keywords: ['trample'], on: 'team' }, 'Overrun')!;
    expect(p.text).toBe('Nathan’s Overrun: creatures Nathan controls get +3/+3 and trample until end of turn');
    const after = p.apply(g);
    const bear = readUnit(after, 0, { kind: 'card', id: 'bear' }, RECORDS);
    expect([bear?.power, bear?.granted]).toEqual([5, ['trample']]);
    const elves = readUnit(after, 0, { kind: 'stack', id: 'elves' }, RECORDS);
    expect([elves?.power, elves?.toughness, elves?.granted]).toEqual([4, 4, ['trample']]);
    expect(readUnit(after, 1, { kind: 'card', id: 'giant' }, RECORDS)?.power).toBe(3);
  });

  test('"other creatures you control" leaves out the card that said so', () => {
    const g = table();
    const p = plan(g, { kind: 'pump', power: 1, toughness: 1, keywords: [], on: 'team', except: 'bear' })!;
    expect(p).toBeNull(); // the bear is Nathan's only creature
  });

  test('a card leaving the battlefield sheds its boost', () => {
    const g = table();
    const pumped = plan(g, { kind: 'pump', power: 3, toughness: 3, keywords: [], on: { seat: 0, kind: 'card', id: 'bear' } })!.apply(g);
    const gone = plan(pumped, { kind: 'remove', how: 'bounce', on: { seat: 0, kind: 'card', id: 'bear' } })!.apply(pumped);
    expect(gone.players[0].cards!.hand.find((c) => c.iid === 'bear')).not.toHaveProperty('boost');
  });
});
