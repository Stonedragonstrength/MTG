import { describe, expect, test } from 'vitest';
import {
  combatGrants,
  grantedKeywords,
  isSummoningSick,
  keywordAmount,
  keywordsOf,
  permanentTexts,
  sickCopies,
  tapsAsThoughHasty,
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

// The cards combat is held to, word for word as the card database stores them
// (a two-faced card: both faces, joined by a line of "//").
const ATRAXA_FULL =
  'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)';
const BANESLAYER_ANGEL = 'Flying, first strike, lifelink, protection from Demons and from Dragons';
const VAMPIRE_NIGHTHAWK =
  'Flying\nDeathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nLifelink (Damage dealt by this creature also causes you to gain that much life.)';
const ZETALPA = 'Flying, double strike, vigilance, trample, indestructible';
const BLIGHTSTEEL =
  'Trample, infect, indestructible\nIf Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner\'s library instead.';
const ABOMINATION_OF_LLANOWAR =
  "Vigilance; menace (This creature can't be blocked except by two or more creatures.)\nAbomination of Llanowar's power and toughness are each equal to the number of Elves you control plus the number of Elf cards in your graveyard.";
const WALL_OF_OMENS = 'Defender\nWhen this creature enters, draw a card.';
const GARRUKS_UPRISING =
  "When this enchantment enters, if you control a creature with power 4 or greater, draw a card.\nCreatures you control have trample. (Each of those creatures can deal excess combat damage to the player or planeswalker it's attacking.)\nWhenever a creature you control with power 4 or greater enters, draw a card.";
const WHIP_OF_EREBOS =
  'Creatures you control have lifelink.\n{2}{B}{B}, {T}: Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else. Activate only as a sorcery.';
const TRUE_CONVICTION = 'Creatures you control have double strike and lifelink.';
const ELDRAZI_MONUMENT =
  "Creatures you control get +1/+1 and have flying and indestructible.\nAt the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice this artifact.";
const ARCHETYPE_OF_COURAGE =
  "Creatures you control have first strike.\nCreatures your opponents control lose first strike and can't have or gain first strike.";
const AVACYN = 'Flying, vigilance, indestructible\nOther permanents you control have indestructible.';
const NYLEA =
  "Indestructible\nAs long as your devotion to green is less than five, Nylea isn't a creature. (Each {G} in the mana costs of permanents you control counts toward your devotion to green.)\nOther creatures you control have trample.\n{3}{G}: Target creature gets +2/+2 until end of turn.";
const ZAGRAS =
  'This spell costs {1} less to cast for each creature in your party.\nFlying, deathtouch, haste\nOther creatures you control have deathtouch.\nWhenever a creature you control deals combat damage to a planeswalker, destroy that planeswalker.';
const OHRAN_FROSTFANG =
  'Attacking creatures you control have deathtouch.\nWhenever a creature you control deals combat damage to a player, draw a card.';
const BERSERKERS_ONSLAUGHT = 'Attacking creatures you control have double strike.';
const GRUUL_WAR_CHANT = 'Attacking creatures you control get +1/+0 and have menace.';
const JETMIR =
  'Creatures you control get +1/+0 and have vigilance as long as you control three or more creatures.\nCreatures you control also get +1/+0 and have trample as long as you control six or more creatures.\nCreatures you control also get +1/+0 and have double strike as long as you control nine or more creatures.';
const ANGELIC_FIELD_MARSHAL =
  'Flying\nLieutenant — As long as you control your commander, this creature gets +2/+2 and creatures you control have vigilance.';
const BRAWN =
  'Trample\nAs long as this card is in your graveyard and you control a Forest, creatures you control have trample.';
const KWENDE = 'Double strike\nCreatures you control with first strike have double strike.';
const HALVAR =
  "Creatures you control that are enchanted or equipped have double strike.\nAt the beginning of each combat, you may attach target Aura or Equipment attached to a creature you control to target creature you control.\n//\nEquipped creature gets +2/+0 and has vigilance.\nWhenever equipped creature dies, return it to its owner's hand.\nEquip {1}{W}";
const SHALAI =
  'Flying\nYou, planeswalkers you control, and other creatures you control have hexproof.\n{4}{G}{G}: Put a +1/+1 counter on each creature you control.';
const INTANGIBLE_VIRTUE = 'Creature tokens you control get +1/+1 and have vigilance.';
const ALWAYS_WATCHING = 'Nontoken creatures you control get +1/+1 and have vigilance.';
const ESIKA =
  'Vigilance\n{T}: Add one mana of any color.\nOther legendary creatures you control have vigilance and "{T}: Add one mana of any color."\n//\nAt the beginning of your upkeep, reveal cards from the top of your library until you reveal a creature or planeswalker card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.';
const ABZAN_FALCONER =
  'Outlast {W} ({W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.)\nEach creature you control with a +1/+1 counter on it has flying.';
const ODRIC =
  'At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike. The same is true for flying, deathtouch, double strike, haste, hexproof, indestructible, lifelink, menace, reach, skulk, trample, and vigilance.';
const BLOODLINE_KEEPER =
  'Flying\n{T}: Create a 2/2 black Vampire creature token with flying.\n{B}: Transform this creature. Activate only if you control five or more Vampires.\n//\nFlying\nOther Vampire creatures you control get +2/+2.\n{T}: Create a 2/2 black Vampire creature token with flying.';
const WESTVALE_ABBEY =
  '{T}: Add {C}.\n{5}, {T}, Pay 1 life: Create a 1/1 white and black Human Cleric creature token.\n{5}, {T}, Sacrifice five creatures: Transform this land, then untap it.\n//\nFlying, lifelink, indestructible, haste';
const BRUTAL_CATHAR =
  'Whenever this creature enters or transforms into Brutal Cathar, exile target creature an opponent controls until this creature leaves the battlefield.\nDaybound (If a player casts no spells during their own turn, it becomes night next turn.)\n//\nFirst strike\nWard—Pay 3 life.\nNightbound (If a player casts at least two spells during their own turn, it becomes day next turn.)';
const ELUSIVE_TORMENTOR =
  "{1}, Discard a card: Transform this creature.\n//\nHexproof, indestructible\nThis creature can't block and can't be blocked.\nWhenever this creature attacks and isn't blocked, you may pay {2}{B}. If you do, transform it.";
const LUDEVICS_TEST_SUBJECT =
  'Defender\n{1}{U}: Put a hatchling counter on this creature. Then if there are five or more hatchling counters on it, remove all of them and transform it.\n//\nTrample';
// A creature that levels up, and a Class: what stands under a level is not there yet.
const STUDENT_OF_WARFARE =
  'Level up {W} ({W}: Put a level counter on this. Level up only as a sorcery.)\nLEVEL 2-6\n3/3\nFirst strike\nLEVEL 7+\n4/4\nDouble strike';
const ROGUE_CLASS =
  "(Gain the next level as a sorcery to add its ability.)\nWhenever a creature you control deals combat damage to a player, exile the top card of that player's library face down. You may look at it for as long as it remains exiled.\n{1}{U}{B}: Level 2\nCreatures you control have menace.\n{2}{U}{B}: Level 3\nYou may play cards exiled with Rogue Class, and you may spend mana as though it were mana of any color to cast those spells.";

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

  // ---- held to the combat rules: real lines, exactly as the card database stores them ----

  test('real keyword lines give up every keyword: Atraxa, Akroma, Baneslayer Angel, Vampire Nighthawk', () => {
    expect(sorted(keywordsOf(ATRAXA_FULL))).toEqual(['deathtouch', 'flying', 'lifelink', 'vigilance']);
    expect(sorted(keywordsOf(AKROMA))).toEqual([
      'first strike',
      'flying',
      'haste',
      'protection',
      'trample',
      'vigilance',
    ]);
    // a line that ends in "protection from …" still gives up first strike and lifelink
    expect(sorted(keywordsOf(BANESLAYER_ANGEL))).toEqual(['first strike', 'flying', 'lifelink', 'protection']);
    // three one-word lines, two of them with reminder text
    expect(sorted(keywordsOf(VAMPIRE_NIGHTHAWK))).toEqual(['deathtouch', 'flying', 'lifelink']);
    expect(sorted(keywordsOf(ZETALPA))).toEqual(['double strike', 'flying', 'indestructible', 'trample', 'vigilance']);
    expect(sorted(keywordsOf(BLIGHTSTEEL))).toEqual(['indestructible', 'infect', 'trample']);
    expect(sorted(keywordsOf(ABOMINATION_OF_LLANOWAR))).toEqual(['menace', 'vigilance']); // a semicolon list
    expect(keywordsOf(WALL_OF_OMENS).has('defender')).toBe(true);
  });

  test('a sentence is never a keyword line, however many keywords it lists: Odric gets nothing', () => {
    expect(keywordsOf(ODRIC).size).toBe(0);
    expect(keywordsOf(NYLEA).has('trample')).toBe(false); // she hands it out; she has only indestructible
    expect(sorted(keywordsOf(NYLEA))).toEqual(['indestructible']);
    expect(keywordsOf(OHRAN_FROSTFANG).size).toBe(0);
    expect(keywordsOf(WHIP_OF_EREBOS).size).toBe(0);
  });

  test('a two-faced card has only what its front face says', () => {
    expect(sorted(keywordsOf(BLOODLINE_KEEPER))).toEqual(['flying']);
    expect(keywordsOf(WESTVALE_ABBEY).size).toBe(0); // the Demon on its back flies, lifelinks and never dies
    const cathar = keywordsOf(BRUTAL_CATHAR);
    expect(cathar.has('first strike')).toBe(false); // that is the Moonrage Brute
    expect(cathar.has('ward')).toBe(false);
    expect(sorted(cathar)).toEqual(['daybound']);
    expect(keywordsOf(ELUSIVE_TORMENTOR).size).toBe(0); // no indestructible from the Mist
    expect(sorted(keywordsOf(LUDEVICS_TEST_SUBJECT))).toEqual(['defender']); // no trample from the Abomination
  });

  test('a custom token’s chips: a bare Ward and a word the app does not know sink nothing', () => {
    expect(sorted(keywordsOf('Lifelink, Deathtouch, Ward'))).toEqual(['deathtouch', 'lifelink', 'ward']);
    expect(sorted(keywordsOf('Double Strike, Trample, Indestructible'))).toEqual([
      'double strike',
      'indestructible',
      'trample',
    ]);
    const mixed = keywordsOf('Flying, banding, lifelink');
    expect(mixed.has('flying')).toBe(true);
    expect(mixed.has('lifelink')).toBe(true);
  });

  test('a level the creature has not reached is not read', () => {
    const student = keywordsOf(STUDENT_OF_WARFARE);
    expect(student.has('first strike')).toBe(false); // that is level 2
    expect(student.has('double strike')).toBe(false); // and that is level 7
    expect(sorted(student)).toEqual(['level up']);
    expect(sorted(keywordsOf('Flying\nLevel up {1}\nLEVEL 1-3\n2/3\nFlying, vigilance'))).toEqual([
      'flying',
      'level up',
    ]);
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

  // ---- combatGrants: the strict reading a fight is worked out from ----
  // (grantedKeywords above stays generous: it only ever answers "may this attack?")

  /** A seat whose permanents carry these texts; the keywords a plain bear of that seat is handed. */
  const handedBy = (...texts: string[]) =>
    sorted(combatGrants(texts.map((text, i) => ({ key: `p${i}`, text }))).to('bear'));

  test('combat grants: real standing grants are read off whole lines of the front face', () => {
    expect(handedBy(GARRUKS_UPRISING)).toEqual(['trample']);
    expect(handedBy(WHIP_OF_EREBOS)).toEqual(['lifelink']);
    expect(handedBy(TRUE_CONVICTION)).toEqual(['double strike', 'lifelink']);
    expect(handedBy(AKROMAS_MEMORIAL)).toEqual([
      'first strike',
      'flying',
      'haste',
      'protection',
      'trample',
      'vigilance',
    ]);
    expect(handedBy(ARCHETYPE_OF_COURAGE)).toEqual(['first strike']);
    expect(handedBy(FERVOR)).toEqual(['haste']);
    expect(handedBy(SERRA_ANGEL, WHIP_OF_EREBOS, GARRUKS_UPRISING)).toEqual(['lifelink', 'trample']); // every permanent
  });

  test('combat grants: a keyword handed out beside a boost is still handed out', () => {
    // The +1/+1 itself is not read (sizes are printed size plus counters), the keywords are.
    expect(handedBy(ELDRAZI_MONUMENT)).toEqual(['flying', 'indestructible']);
  });

  test('combat grants: "Other" leaves out the very permanent that says it — by instance, not by name', () => {
    const nylea = combatGrants([
      { key: 'nylea', text: NYLEA },
      { key: 'bear', text: '' },
    ]);
    expect(nylea.to('bear').has('trample')).toBe(true);
    expect(nylea.to('nylea').has('trample')).toBe(false); // one Nylea does not grant herself trample
    // two of the same card hand it to each other
    const two = combatGrants([
      { key: 'nylea-1', text: NYLEA },
      { key: 'nylea-2', text: NYLEA },
    ]);
    expect(two.to('nylea-1').has('trample')).toBe(true);
    expect(two.to('nylea-2').has('trample')).toBe(true);
    // "Other permanents you control have indestructible."
    const avacyn = combatGrants([{ key: 'avacyn', text: AVACYN }]);
    expect(sorted(avacyn.to('bear'))).toEqual(['indestructible']);
    expect(avacyn.to('avacyn').size).toBe(0); // her own is printed on her
    expect(sorted(combatGrants([{ key: 'zagras', text: ZAGRAS }]).to('bear'))).toEqual(['deathtouch']);
  });

  test('combat grants: the copies of one stack are each other’s "other"', () => {
    const text = 'Other creatures you control have trample.';
    expect(combatGrants([{ key: 'tok', text, copies: 3 }]).to('tok').has('trample')).toBe(true);
    expect(combatGrants([{ key: 'tok', text, copies: 1 }]).to('tok').has('trample')).toBe(false);
    expect(combatGrants([{ key: 'tok', text }]).to('tok').has('trample')).toBe(false); // one copy unless told
  });

  test('combat grants: what only attackers, only some creatures or only sometimes get is not read', () => {
    for (const text of [
      OHRAN_FROSTFANG, // "Attacking creatures you control have deathtouch."
      BERSERKERS_ONSLAUGHT,
      GRUUL_WAR_CHANT,
      JETMIR, // "…as long as you control three or more creatures."
      ANGELIC_FIELD_MARSHAL, // "Lieutenant — As long as you control your commander, …"
      BRAWN, // only from the graveyard
      KWENDE, // "Creatures you control with first strike have double strike."
      HALVAR,
      SHALAI,
      INTANGIBLE_VIRTUE, // tokens only
      ALWAYS_WATCHING, // nontoken only
      ESIKA, // legendary creatures only, and an ability in quotes
      ABZAN_FALCONER,
      GOBLIN_CHIEFTAIN,
      LIGHTNING_GREAVES,
      CRYPTOLITH_RITE,
      ODRIC,
      'All creatures have haste.', // Concordant Crossroads: fine for "may it attack", not for a fight
      'As long as you control a Mountain, creatures you control have first strike.',
      'Creatures you control have first strike as long as it is your turn.',
      'Creatures you control have flying and first strike as long as you control an Island.',
      'During your turn, creatures you control have first strike.',
    ]) {
      expect(handedBy(text), text).toEqual([]);
    }
  });

  test('combat grants: an ability, a loan for a turn or a quote is not a standing grant', () => {
    expect(handedBy('{2}{R}: Creatures you control have trample until end of turn.')).toEqual([]);
    expect(handedBy('Creatures you control gain trample until end of turn.')).toEqual([]);
    expect(handedBy('Creatures you control have trample until end of turn.')).toEqual([]);
    expect(handedBy(GOBLIN_MOTIVATOR)).toEqual([]);
    expect(handedBy('Trample')).toEqual([]); // a keyword it has is not one it hands out
    // two sentences on one line: not the whole line, not read
    expect(handedBy('Creatures you control have trample. Draw a card.')).toEqual([]);
    expect(handedBy('When this enters, creatures you control have trample.')).toEqual([]);
  });

  test('combat grants: the back face hands out nothing while the front is up', () => {
    expect(handedBy('Flying\n//\nCreatures you control have trample.')).toEqual([]);
    expect(handedBy(BLOODLINE_KEEPER)).toEqual([]);
    expect(handedBy('Creatures you control have trample.\n//\nCreatures you control have lifelink.')).toEqual([
      'trample',
    ]);
  });

  test('combat grants: a level that has not been reached hands out nothing', () => {
    // A Class card: what stands under "…: Level 2" is not there until the level is paid for.
    expect(handedBy(ROGUE_CLASS)).toEqual([]);
    expect(handedBy('Creatures you control have lifelink.\n{1}{W}: Level 2\nCreatures you control have trample.')).toEqual([
      'lifelink',
    ]);
    // A creature that levels up: the same for what stands under "LEVEL 2-4".
    expect(handedBy('Level up {2}{W}\nLEVEL 2-4\n3/6\nOther creatures you control have vigilance.')).toEqual([]);
  });

  test('combat grants: each listed word is judged on its own, and one that is no keyword sinks nothing', () => {
    expect(handedBy('Creatures you control have trample and a certain something about them.')).toEqual(['trample']);
    const mixed = handedBy('Other creatures you control have flying, frobnication, and lifelink.');
    expect(mixed).toContain('flying');
    expect(mixed).toContain('lifelink');
    // "…and protection from black and from red": the second half is no keyword of its own
    expect(handedBy(AKROMAS_MEMORIAL)).not.toContain('from red');
  });

  test('combat grants: a numbered keyword keeps its number, added up over everything that hands it out', () => {
    const grants = combatGrants([
      { key: 'a', text: 'Creatures you control have toxic 1.' },
      { key: 'b', text: 'Other creatures you control have toxic 2.' },
    ]);
    expect(grants.to('bear').has('toxic')).toBe(true);
    expect(grants.amount('bear', 'toxic')).toBe(3);
    expect(grants.amount('b', 'toxic')).toBe(1); // not its own "other"
    expect(grants.amount('bear', 'trample')).toBe(0);
    expect(combatGrants([]).to('bear').size).toBe(0);
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

describe('abilities used as though the creature had haste', () => {
  // Thousand-Year Elixir and Tyvar, Jubilant Brawler word it the same way.
  const ELIXIR =
    'You may activate abilities of creatures you control as though those creatures had haste.\n{1}, {T}: Untap target creature.';

  test('the sentence is read, on any of the seat’s permanents', () => {
    expect(tapsAsThoughHasty([ELIXIR])).toBe(true);
    expect(tapsAsThoughHasty(['Flying', ELIXIR])).toBe(true);
    expect(tapsAsThoughHasty(['You may activate abilities of creatures you control as though they had haste.'])).toBe(true);
  });

  test('nothing else reads as it', () => {
    expect(tapsAsThoughHasty([])).toBe(false);
    expect(tapsAsThoughHasty(['Creatures you control have haste.'])).toBe(false); // that is a grant
    expect(tapsAsThoughHasty(['Target creature gains haste until end of turn.'])).toBe(false);
  });

  test('it is no grant of haste: those creatures still cannot attack', () => {
    expect(grantedKeywords([ELIXIR]).size).toBe(0);
    expect(isSummoningSick({ sick: true }, { typeLine: 'Creature — Elf Druid', oracleText: '{T}: Add {G}.' }, [ELIXIR])).toBe(true);
  });
});
