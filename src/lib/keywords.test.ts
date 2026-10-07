import { describe, expect, test } from 'vitest';
import {
  grantedKeywords,
  isSummoningSick,
  keywordAmount,
  keywordsOf,
  permanentTexts,
  sickCopies,
  toxicOf,
} from './keywords';
import type { BoardItem, CardRecord } from './types';

const sorted = (set: Set<string>) => [...set].sort();

// Rules text as Scryfall prints it.
const SERRA_ANGEL = 'Flying, vigilance';
const TYPHOID_RATS =
  'Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)';
const AKROMA =
  'Flying, first strike, vigilance, trample, haste, protection from black and from red';
const ATRAXA = 'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.';
const TYRRANAX_REX =
  "This spell can't be countered.\nTrample, ward {4}, haste\nToxic 4 (Players dealt combat damage by this creature also get four poison counters.)";
const GOBLIN_MOTIVATOR =
  '{T}: Target creature gains haste until end of turn. (It can attack and {T} this turn.)';
const SAMUT =
  'Flash\nDouble strike, vigilance, haste\nOther creatures you control have haste.\n{W}, {T}: Untap another target creature.';
const FERVOR =
  'Creatures you control have haste. (They can attack and {T} as soon as they come under your control.)';
const AKROMAS_MEMORIAL =
  'Creatures you control have flying, first strike, vigilance, trample, haste, and protection from black and from red.';
const GOBLIN_CHIEFTAIN =
  'Haste (This creature can attack and {T} as soon as it comes under your control.)\nOther Goblin creatures you control get +1/+1 and have haste.';
const CRYPTOLITH_RITE = 'Creatures you control have "{T}: Add one mana of any color."';
const LIGHTNING_GREAVES = 'Equipped creature has haste and shroud.\nEquip {0}';
const DELVER =
  'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.\n//\nFlying';
const KNIGHT_OF_GRACE =
  'First strike\nHexproof from black (This creature can’t be the target of black spells or abilities your opponents control.)\nKnight of Grace gets +1/+0 as long as any player controls a black permanent.';

describe('keywordsOf', () => {
  test('a keyword line gives up each of its keywords, in lower case', () => {
    expect(sorted(keywordsOf(SERRA_ANGEL))).toEqual(['flying', 'vigilance']);
    expect(sorted(keywordsOf('Haste'))).toEqual(['haste']);
    expect(sorted(keywordsOf('Double strike'))).toEqual(['double strike']);
    expect(sorted(keywordsOf('Flying, deathtouch, lifelink'))).toEqual([
      'deathtouch',
      'flying',
      'lifelink',
    ]);
  });

  test('the combat keywords are all read by their plain names', () => {
    const all =
      'Flying, first strike, double strike, trample, deathtouch, lifelink, reach, menace, defender, indestructible, hexproof, infect, vigilance, haste';
    expect(sorted(keywordsOf(all))).toEqual([
      'deathtouch',
      'defender',
      'double strike',
      'first strike',
      'flying',
      'haste',
      'hexproof',
      'indestructible',
      'infect',
      'lifelink',
      'menace',
      'reach',
      'trample',
      'vigilance',
    ]);
  });

  test('reminder text in parentheses is not rules text', () => {
    expect(sorted(keywordsOf(TYPHOID_RATS))).toEqual(['deathtouch']);
    expect(sorted(keywordsOf('({T}: Add {G}.)'))).toEqual([]); // a basic land
    // Giant Spider's reminder mentions flying; the Spider does not fly
    expect(sorted(keywordsOf('Reach (This creature can block creatures with flying.)'))).toEqual(['reach']);
  });

  test('every keyword line of a card counts, sentences between them do not', () => {
    expect(sorted(keywordsOf(ATRAXA))).toEqual(['deathtouch', 'flying', 'lifelink', 'vigilance']);
    expect(sorted(keywordsOf(TYRRANAX_REX))).toEqual(['haste', 'toxic', 'trample', 'ward']);
    expect(sorted(keywordsOf(SAMUT))).toEqual(['double strike', 'flash', 'haste', 'vigilance']);
  });

  test('a keyword with a number or a cost is kept under its bare name', () => {
    expect(sorted(keywordsOf('Toxic 2'))).toEqual(['toxic']);
    expect(sorted(keywordsOf('Ward {2}'))).toEqual(['ward']);
    expect(sorted(keywordsOf('Flying, lifelink, ward {2}'))).toEqual(['flying', 'lifelink', 'ward']);
    expect(sorted(keywordsOf('Annihilator 2'))).toEqual(['annihilator']);
    expect(sorted(keywordsOf('Flying; cycling {2}'))).toEqual(['cycling', 'flying']); // semicolons split too
    expect(sorted(keywordsOf('Kicker {2}{G} and/or {1}{U}'))).toEqual(['kicker']);
  });

  test('a cost after a dash belongs to its keyword', () => {
    expect(sorted(keywordsOf('Ward—Pay 2 life.'))).toEqual(['ward']);
    expect(sorted(keywordsOf('Flying, ward—Discard a card.'))).toEqual(['flying', 'ward']);
    expect(sorted(keywordsOf('Escape—{3}{B}{B}, Exile four other cards from your graveyard.'))).toEqual([
      'escape',
    ]);
  });

  test('protection keeps its list together', () => {
    expect(sorted(keywordsOf(AKROMA))).toEqual([
      'first strike',
      'flying',
      'haste',
      'protection',
      'trample',
      'vigilance',
    ]);
    expect(sorted(keywordsOf('Protection from white, from blue, and from black'))).toEqual(['protection']);
  });

  test('hexproof from one color is not hexproof', () => {
    const own = keywordsOf(KNIGHT_OF_GRACE);
    expect(own.has('first strike')).toBe(true);
    expect(own.has('hexproof')).toBe(false);
    expect(own.has('hexproof from')).toBe(true);
  });

  test('a sentence that only mentions a keyword does not count', () => {
    expect(keywordsOf('Target creature gains haste until end of turn.').size).toBe(0);
    expect(keywordsOf(GOBLIN_MOTIVATOR).has('haste')).toBe(false);
    expect(keywordsOf('Whenever this creature attacks, it gains flying until end of turn.').size).toBe(0);
    expect(keywordsOf('Flying creatures you control get +1/+1.').size).toBe(0);
    expect(keywordsOf(FERVOR).has('haste')).toBe(false); // it hands haste out; it has none
    expect(keywordsOf(LIGHTNING_GREAVES).has('haste')).toBe(false);
  });

  test('an ability word is not a keyword', () => {
    expect(keywordsOf('Landfall — Whenever a land you control enters, this creature gets +2/+2 until end of turn.').size).toBe(0);
    expect(keywordsOf('Choose one —\n• Target creature gains haste until end of turn.\n• Draw a card.').size).toBe(0);
  });

  test('a line that is not made only of keywords gives up nothing', () => {
    expect(keywordsOf('Haste, but only on your own turn').size).toBe(0);
    expect(keywordsOf('gains haste when it attacks').size).toBe(0);
  });

  test('a short instruction is a sentence, however much it looks like a keyword', () => {
    expect(keywordsOf('Scry 1.\nDraw a card.').size).toBe(0); // Opt
    expect(keywordsOf('Proliferate.').size).toBe(0);
  });

  test('the keywords a player ticked on a custom token read the same way', () => {
    expect(sorted(keywordsOf('Flying, First Strike, Haste'))).toEqual(['first strike', 'flying', 'haste']);
  });

  test('only the front face of a two-faced card is read', () => {
    expect(keywordsOf(DELVER).has('flying')).toBe(false); // the Aberration flies, the Delver does not
    expect(sorted(keywordsOf('Flying\n//\nFlying, haste'))).toEqual(['flying']);
  });

  test('no text, no keywords', () => {
    expect(keywordsOf('').size).toBe(0);
  });
});

describe('toxic', () => {
  test('the number rides along', () => {
    expect(toxicOf('Toxic 2')).toBe(2);
    expect(toxicOf(TYRRANAX_REX)).toBe(4);
    expect(toxicOf('Flying, toxic 1')).toBe(1);
  });

  test('a card without toxic has none', () => {
    expect(toxicOf(SERRA_ANGEL)).toBe(0);
    expect(toxicOf('')).toBe(0);
    // a creature that hands toxic out does not have it
    expect(toxicOf('Other creatures you control have toxic 1.')).toBe(0);
  });

  test('other numbered keywords read the same way', () => {
    expect(keywordAmount('Annihilator 2', 'annihilator')).toBe(2);
    expect(keywordAmount('Ward {2}', 'ward')).toBe(0); // a cost is not a number
    expect(keywordAmount('Flying', 'toxic')).toBe(0);
  });
});

describe('grantedKeywords', () => {
  test('"Creatures you control have …" hands the keyword to the seat', () => {
    expect(sorted(grantedKeywords([FERVOR]))).toEqual(['haste']);
    expect(sorted(grantedKeywords(['Creatures you control have haste.']))).toEqual(['haste']);
  });

  test('"other" is read as everyone, and a list gives up every keyword', () => {
    expect(sorted(grantedKeywords(['Other creatures you control have trample and haste.']))).toEqual([
      'haste',
      'trample',
    ]);
    expect(sorted(grantedKeywords([SAMUT]))).toEqual(['haste']);
    expect(sorted(grantedKeywords([AKROMAS_MEMORIAL]))).toEqual([
      'first strike',
      'flying',
      'haste',
      'protection',
      'trample',
      'vigilance',
    ]);
  });

  test('a boost in the same sentence does not hide the keyword', () => {
    expect(sorted(grantedKeywords(['Creatures you control get +1/+1 and have haste.']))).toEqual(['haste']);
    expect(sorted(grantedKeywords(['Other creatures you control get +2/+2 and have trample.']))).toEqual([
      'trample',
    ]);
  });

  test('"All creatures have haste" covers the seat too', () => {
    expect(sorted(grantedKeywords(['All creatures have haste.']))).toEqual(['haste']);
  });

  test('a condition in front is taken on trust', () => {
    expect(
      sorted(grantedKeywords(['As long as you control a Mountain, creatures you control have haste.'])),
    ).toEqual(['haste']);
  });

  test('every permanent of the seat is read', () => {
    expect(sorted(grantedKeywords([SERRA_ANGEL, 'Creatures you control have trample.', FERVOR]))).toEqual([
      'haste',
      'trample',
    ]);
  });

  test('what only some creatures get is not handed to all of them', () => {
    expect(grantedKeywords([GOBLIN_CHIEFTAIN]).size).toBe(0); // Goblins only
    expect(grantedKeywords(['Nontoken creatures you control have haste.']).size).toBe(0);
    expect(grantedKeywords(['Attacking creatures you control have trample.']).size).toBe(0);
    expect(grantedKeywords([LIGHTNING_GREAVES]).size).toBe(0); // one creature, and not known which
    expect(grantedKeywords(['Creature tokens you control have haste.']).size).toBe(0);
  });

  test('a keyword a card has, or lends for a turn, is not a standing grant', () => {
    expect(grantedKeywords(['Haste']).size).toBe(0);
    expect(grantedKeywords([GOBLIN_MOTIVATOR]).size).toBe(0);
    expect(grantedKeywords(['Creatures you control gain haste until end of turn.']).size).toBe(0);
    expect(grantedKeywords(['{2}{R}: Creatures you control have haste until end of turn.']).size).toBe(0);
    // an ability you pay for is a loan, however it is worded
    expect(grantedKeywords(['{1}{R}, {T}: Until end of turn, creatures you control have haste.']).size).toBe(0);
  });

  test('an ability in quotes is not a keyword', () => {
    expect(grantedKeywords([CRYPTOLITH_RITE]).size).toBe(0);
  });

  test('no permanents, no grants', () => {
    expect(grantedKeywords([]).size).toBe(0);
  });
});

function rec(typeLine: string, oracleText = ''): CardRecord {
  return {
    id: 'c',
    name: 'Card',
    nameLower: 'card',
    typeLine,
    oracleText,
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

describe('isSummoningSick', () => {
  const fresh = { sick: true as const };
  const bear = rec('Creature — Bear');

  test('a creature that only just arrived is', () => {
    expect(isSummoningSick(fresh, bear, [])).toBe(true);
  });

  test('a creature that has been there since its turn began is not', () => {
    expect(isSummoningSick({}, bear, [])).toBe(false);
  });

  test('a card whose record is not read yet never is', () => {
    expect(isSummoningSick(fresh, undefined, [])).toBe(false);
    expect(isSummoningSick(fresh, null, [])).toBe(false);
  });

  test('lands, rocks and enchantments never are, however fresh', () => {
    expect(isSummoningSick(fresh, rec('Basic Land — Forest', '({T}: Add {G}.)'), [])).toBe(false);
    expect(isSummoningSick(fresh, rec('Artifact', '{T}: Add {C}{C}.'), [])).toBe(false);
    expect(isSummoningSick(fresh, rec('Enchantment', FERVOR), [])).toBe(false);
    expect(isSummoningSick(fresh, rec('Legendary Planeswalker — Jace'), [])).toBe(false);
  });

  test('an artifact creature and a creature land are creatures', () => {
    expect(isSummoningSick(fresh, rec('Artifact Creature — Thopter', 'Flying'), [])).toBe(true);
    expect(isSummoningSick(fresh, rec('Land Creature — Forest Dryad'), [])).toBe(true);
  });

  test('haste of its own cures it', () => {
    expect(isSummoningSick(fresh, rec('Creature — Goblin', 'Haste'), [])).toBe(false);
    expect(isSummoningSick(fresh, rec('Legendary Creature — Dinosaur', TYRRANAX_REX), [])).toBe(false);
  });

  test('haste handed out by another of the seat’s permanents cures it', () => {
    expect(isSummoningSick(fresh, bear, [FERVOR])).toBe(false);
    expect(isSummoningSick(fresh, bear, [SAMUT])).toBe(false);
    expect(isSummoningSick(fresh, bear, ['Creatures you control have trample.'])).toBe(true);
  });

  test('a creature that only talks about haste still is', () => {
    expect(isSummoningSick(fresh, rec('Creature — Goblin', GOBLIN_MOTIVATOR), [])).toBe(true);
  });

  test('a two-faced card is judged by its front', () => {
    // a Saga that turns into a creature later is not a creature when it arrives
    expect(isSummoningSick(fresh, rec('Enchantment — Saga // Enchantment Creature — Goblin Shaman'), [])).toBe(false);
    expect(isSummoningSick(fresh, rec('Creature — Human Wizard // Creature — Human Insect', DELVER), [])).toBe(true);
  });
});

function stack(over: Partial<BoardItem>): BoardItem {
  return {
    id: 'tok',
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
    ...over,
  };
}

describe('sickCopies', () => {
  test('counts the copies of a stack that only just arrived', () => {
    expect(sickCopies(stack({ sick: 2 }), [])).toBe(2);
    expect(sickCopies(stack({}), [])).toBe(0);
  });

  test('a stack with haste, its own or handed to it, has none', () => {
    expect(sickCopies(stack({ sick: 3, oracleText: 'Haste' }), [])).toBe(0);
    expect(sickCopies(stack({ sick: 3, oracleText: 'Flying, Haste' }), [])).toBe(0); // a custom token
    expect(sickCopies(stack({ sick: 3 }), [FERVOR])).toBe(0);
    expect(sickCopies(stack({ sick: 3, oracleText: 'Flying' }), [])).toBe(3);
  });
});

describe('permanentTexts', () => {
  test('gathers the rules text of a seat’s read cards and of its stacks', () => {
    const records = {
      'c-fervor': rec('Enchantment', FERVOR),
      'c-bear': rec('Creature — Bear'), // no text: nothing to gather
      'c-lost': null, // a miss
    };
    const battlefield = [
      { iid: 'a', cardId: 'c-fervor', name: 'Fervor' },
      { iid: 'b', cardId: 'c-bear', name: 'Grizzly Bears' },
      { iid: 'c', cardId: 'c-lost', name: 'Lost' },
      { iid: 'd', cardId: 'c-pending', name: 'Pending' }, // not read yet
    ];
    expect(permanentTexts(battlefield, records, [stack({ oracleText: 'Flying' }), stack({})])).toEqual([
      FERVOR,
      'Flying',
    ]);
  });
});
