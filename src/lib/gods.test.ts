import { describe, expect, test } from 'vitest';
import { sizeAround } from './anthems';
import { tappedToAttack } from './attackDraft';
import { readUnit, type CardRecords } from './combatEngine';
import { createGame } from './game';
import { devotionTo, godNeed, godsOf, godWords } from './gods';
import { planEffect, spellChoices, spellPrompts } from './spellEffects';
import { firedBy, type Happening } from './triggers';
import type { CardInstance, CardRecord, GameConfig, GameState } from './types';

function rec(
  id: string,
  name: string,
  typeLine: string,
  manaCost: string,
  oracleText: string,
  power: string | null = null,
  toughness: string | null = null,
): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost,
    power,
    toughness,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const NYLEA = rec(
  'nylea',
  'Nylea, God of the Hunt',
  'Legendary Enchantment Creature — God',
  '{3}{G}',
  "Indestructible\nAs long as your devotion to green is less than five, Nylea isn't a creature. (Each {G} in the mana costs of permanents you control counts toward your devotion to green.)\nOther creatures you control have trample.\n{3}{G}: Target creature gets +2/+2 until end of turn.",
  '6',
  '6',
);
const PHENAX = rec(
  'phenax',
  'Phenax, God of Deception',
  'Legendary Enchantment Creature — God',
  '{3}{U}{B}',
  "Indestructible\nAs long as your devotion to blue and black is less than seven, Phenax isn't a creature.\nCreatures you control have \"{T}: Target player mills X cards, where X is this creature's toughness.\"",
  '4',
  '7',
);
const TRIAD = rec(
  'triad',
  'The Warring Triad',
  'Legendary Artifact Creature — Phyrexian Construct',
  '{3}{R}{G}',
  "Flying, trample, haste\nAs long as there are fewer than eight cards in your graveyard, The Warring Triad isn't a creature.",
  '5',
  '5',
);
const BALOTH = rec('baloth', 'Leatherback Baloth', 'Creature — Beast', '{G}{G}{G}', '', '4', '5');
const ELVES = rec('elves', 'Llanowar Elves', 'Creature — Elf Druid', '{G}', '{T}: Add {G}.', '1', '1');
const GUILDMAGE = rec('guildmage', 'Dimir Guildmage', 'Creature — Human Wizard', '{U/B}{U/B}', '', '2', '2');
const ANTHEM = rec('anthem', 'Glorious Anthem', 'Enchantment', '{1}{W}{W}', 'Creatures you control get +1/+1.');
const WARDEN = rec('warden', 'Soul Warden', 'Creature — Human Cleric', '{W}', 'Whenever another creature enters, you gain 1 life.', '1', '1');

const RECORDS: CardRecords = Object.fromEntries(
  [NYLEA, PHENAX, TRIAD, BALOTH, ELVES, GUILDMAGE, ANTHEM, WARDEN].map((r) => [r.id, r]),
);

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: ['Nathan', 'Sam'].map((name, i) => ({ id: `p${i}`, name, avatarUrl: null, commanderName: null })),
};

/** Seat 0 holds these cards (iid = card id unless given "iid:cardId"); seat 1 a bear. */
function table(ids: string[], more: { graveyard?: number; wear?: Record<string, Partial<CardInstance>> } = {}): GameState {
  const base = createGame(config);
  const cards = (list: string[]): CardInstance[] =>
    list.map((spec) => {
      const [iid, cardId = iid] = spec.split(':');
      return { iid, cardId, name: RECORDS[cardId]?.name ?? cardId, row: 'front' as const, ...more.wear?.[iid] };
    });
  const seat = (battlefield: CardInstance[], graveyard = 0) => ({
    library: [],
    hand: [],
    battlefield,
    graveyard: Array.from({ length: graveyard }, (_, i) => ({ iid: `gy${i}`, cardId: 'elves', name: 'Llanowar Elves' })),
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Test',
  });
  return {
    ...base,
    players: base.players.map((p, i) => ({
      ...p,
      board: [],
      cards: i === 0 ? seat(cards(ids), more.graveyard) : seat(cards(['b1:baloth'])),
    })),
  };
}

const card = (id: string) => ({ kind: 'card' as const, id });

describe('what a god needs', () => {
  test('the gods, the two-color gods, The Warring Triad and Arvinox are read; a plain creature is not', () => {
    expect(godNeed(NYLEA.oracleText)).toEqual({ kind: 'devotion', colors: ['G'], needs: 5 });
    expect(godNeed(PHENAX.oracleText)).toEqual({ kind: 'devotion', colors: ['U', 'B'], needs: 7 });
    expect(godNeed(TRIAD.oracleText)).toEqual({ kind: 'graveyard', needs: 8 });
    expect(godNeed("Flying\nArvinox isn't a creature unless you control three or more permanents you don't own.")).toEqual({
      kind: 'stolen',
      needs: 3,
    });
    expect(godNeed(BALOTH.oracleText)).toBeNull();
    expect(godNeed('Whenever an opponent casts a creature spell, this creature isn\'t a creature until end of turn.')).toBeNull();
  });

  test('a hybrid symbol counts once toward a two-color devotion, and toward each of its colors', () => {
    expect(devotionTo([['{U/B}{U/B}', 1]], ['U', 'B'])).toBe(2);
    expect(devotionTo([['{U/B}{U/B}', 1]], ['U'])).toBe(2);
    expect(devotionTo([['{3}{U}{B}', 1]], ['U', 'B'])).toBe(2);
    expect(devotionTo([['{2/G}{G/P}{R}', 2]], ['G'])).toBe(4);
  });
});

describe('a god on the table', () => {
  test('Nylea is no creature at devotion 4 and a creature at 5', () => {
    const asleep = table(['nylea', 'baloth']); // {G} + {G}{G}{G}
    const unit = readUnit(asleep, 0, card('nylea'), RECORDS)!;
    expect(unit).toMatchObject({ creature: false, canAttack: 0, canBlock: 0 });
    expect(godWords(godsOf(asleep, 0, RECORDS).get('card:nylea')!)).toBe('devotion to green 4 of 5');

    const awake = table(['nylea', 'baloth', 'elves']);
    expect(readUnit(awake, 0, card('nylea'), RECORDS)).toMatchObject({ creature: true, canAttack: 1, canBlock: 1 });
    expect(godsOf(awake, 0, RECORDS).get('card:nylea')).toMatchObject({ now: 5, creature: true });
  });

  test('Phenax counts blue and black together, a hybrid once', () => {
    // Phenax 2, two Guildmages 2 each: 6 of 7.
    const g = table(['phenax', 'g1:guildmage', 'g2:guildmage']);
    expect(godsOf(g, 0, RECORDS).get('card:phenax')).toMatchObject({ now: 6, creature: false });
    const more = table(['phenax', 'g1:guildmage', 'g2:guildmage', 'g3:guildmage']);
    expect(godsOf(more, 0, RECORDS).get('card:phenax')).toMatchObject({ now: 8, creature: true });
  });

  test('The Warring Triad wakes with eight cards in the graveyard', () => {
    expect(readUnit(table(['triad'], { graveyard: 7 }), 0, card('triad'), RECORDS)!.creature).toBe(false);
    expect(readUnit(table(['triad'], { graveyard: 8 }), 0, card('triad'), RECORDS)!.creature).toBe(true);
  });

  test('another seat’s devotion is not hers', () => {
    // Seat 1's Baloth gives seat 0 nothing.
    expect(godsOf(table(['nylea']), 0, RECORDS).get('card:nylea')!.now).toBe(1);
  });

  test('no anthem reaches a god that is no creature', () => {
    const g = table(['nylea', 'baloth', 'anthem']);
    expect(sizeAround(g, { seat: 0, kind: 'card', id: 'nylea' }, RECORDS)).toEqual({ power: 0, toughness: 0 });
    expect(sizeAround(g, { seat: 0, kind: 'card', id: 'baloth' }, RECORDS)).toEqual({ power: 1, toughness: 1 });
  });

  test('a tapped god below her devotion is not offered as an attacker', () => {
    const tapped = { tapped: true };
    const asleep = table(['nylea', 'baloth'], { wear: { nylea: tapped, baloth: tapped } });
    expect(tappedToAttack(asleep, RECORDS).map((p) => p.unit.id)).toEqual(['baloth']);
    const awake = table(['nylea', 'baloth', 'elves'], { wear: { nylea: tapped, baloth: tapped } });
    expect(tappedToAttack(awake, RECORDS).map((p) => p.unit.id)).toEqual(['nylea', 'baloth']);
  });
});

describe('spells and triggers', () => {
  const prompt = (text: string) => spellPrompts(rec('s', 'Spell', 'Instant', '', text))[0];

  test('"target creature" leaves a sleeping god out; "target enchantment" takes her', () => {
    const g = table(['nylea', 'baloth']);
    const names = (text: string) => spellChoices(g, 0, prompt(text), 1, RECORDS).map((c) => c.name);
    expect(names('Destroy target creature.')).toEqual(['Leatherback Baloth']);
    expect(names('Destroy target enchantment.')).toEqual(['Nylea, God of the Hunt']);
    const awake = table(['nylea', 'baloth', 'elves']);
    expect(spellChoices(awake, 0, prompt('Destroy target creature.'), 1, RECORDS).map((c) => c.name)).toContain(
      'Nylea, God of the Hunt',
    );
  });

  test('"exile all creatures" leaves a sleeping god where she is', () => {
    const g = table(['nylea', 'baloth']);
    const plan = planEffect(g, 1, 'Farewell', { kind: 'sweep', how: 'exile' }, RECORDS)!;
    expect(plan.text).toMatch(/\(2\)$/); // the Baloths of both seats
    const after = plan.apply(g);
    expect(after.players[0].cards!.battlefield.map((c) => c.iid)).toEqual(['nylea']);
  });

  test('a god entering below her devotion does not set off "whenever another creature enters"', () => {
    const enters: Happening = {
      kind: 'enters',
      things: [{ seat: 0, kind: 'card', id: 'nylea', cardId: 'nylea', name: NYLEA.name, n: 1 }],
    };
    expect(firedBy(table(['warden', 'nylea', 'baloth']), enters, RECORDS)).toEqual([]);
    expect(firedBy(table(['warden', 'nylea', 'baloth', 'elves']), enters, RECORDS)).toHaveLength(1);
  });
});
