import { describe, expect, test } from 'vitest';
import { abilitiesOf } from './abilities';
import { equipWays } from './equip';
import { castCosts, extraCosts, extraTimes, maxX, planAnyFace, planPayment, priceExtras, sourcesFor, sourcesFrom, type ManaSource } from './pay';
import { tally, tallyWords } from './payWith';
import { spendAllows, spendOnCard, type SpendOn } from './spendOnly';
import type { CardInstance, CardRecord } from './types';

function rec(id: string, typeLine: string, manaCost: string, oracleText: string): CardRecord {
  return {
    id,
    name: id,
    nameLower: id,
    typeLine,
    oracleText,
    manaCost,
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const LANDS = [
  rec('Forest', 'Basic Land — Forest', '', '({T}: Add {G}.)'),
  rec('Mountain', 'Basic Land — Mountain', '', '({T}: Add {R}.)'),
  rec('Wastes', 'Basic Land', '', '{T}: Add {C}.'),
  rec('Ancient Ziggurat', 'Land', '', '{T}: Add one mana of any color. Spend this mana only to cast a creature spell.'),
  rec(
    'Cavern of Souls',
    'Land',
    '',
    'As Cavern of Souls enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.',
  ),
  rec('Pillar of the Paruns', 'Land', '', '{T}: Add one mana of any color. Spend this mana only to cast a multicolored spell.'),
  rec(
    'Eldrazi Temple',
    'Land',
    '',
    '{T}: Add {C}.\n{T}: Add {C}{C}. Spend this mana only to cast colorless Eldrazi spells or activate abilities of colorless Eldrazi.',
  ),
  rec('Mishra\'s Workshop', 'Land', '', '{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells.'),
  rec('Secret Base', 'Land', '', '{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color. Spend this mana only to cast a spell that shares a watermark with this land.'),
  rec('Elfhame Druid', 'Creature — Elf Druid', '{1}{G}', '{T}: Add {G}.\n{T}: Add {G}{G}. Spend this mana only to cast kicked spells.'),
];
const RECORDS: Record<string, CardRecord> = Object.fromEntries(LANDS.map((r) => [r.id, r]));

const BOLT = rec('Lightning Bolt', 'Instant', '{R}', 'Lightning Bolt deals 3 damage to any target.');
const BEAR = rec('Grizzly Bears', 'Creature — Bear', '{1}{G}', '');
const SEER = rec('Thought-Knot Seer', 'Creature — Eldrazi', '{3}{C}', '');
const STONE = rec('Mind Stone', 'Artifact', '{2}', '{T}: Add {C}.');
const ROOT = rec('Rootborn Defenses', 'Instant', '{2}{W}', '');
const GUILD = rec('Fires of Yavimaya', 'Enchantment', '{1}{R}{G}', '');
const RUINATION = rec('Ruination Guide', 'Creature — Eldrazi Drone', '{2}{U}', 'Devoid (This card has no color.)\nIngest');
const GIANT = rec('Bonecrusher Giant', 'Creature — Giant // Instant — Adventure', '{2}{R} // {1}{R}', 'Whenever…\n//\nStomp deals 2 damage to any target.');

/** The seat's battlefield: one untapped card of each name. */
function table(...names: string[]): ManaSource[] {
  const battlefield: CardInstance[] = names.map((name, i) => ({ iid: `${name}#${i}`, cardId: name, name, row: 'lands' }));
  return sourcesFrom(battlefield, RECORDS, []);
}

const cast = (record: CardRecord) => castCosts(record, 'hand')[0];
const tapped = (plan: ReturnType<typeof planPayment>) => Object.keys(plan?.spend ?? {}).map((k) => k.split('#')[0]).sort();

describe('the words after "Spend this mana only"', () => {
  const on = (record: CardRecord, more: Partial<SpendOn> = {}) => spendOnCard(record, 'cast', 0, { from: 'hand', ...more });

  test('a creature spell, a multicolored spell, artifact spells, colorless Eldrazi', () => {
    expect(spendAllows('to cast a creature spell', on(BEAR))).toBe(true);
    expect(spendAllows('to cast a creature spell', on(BOLT))).toBe(false);
    expect(spendAllows('to cast a multicolored spell', on(GUILD))).toBe(true);
    expect(spendAllows('to cast a multicolored spell', on(BEAR))).toBe(false);
    expect(spendAllows('to cast artifact spells', on(STONE))).toBe(true);
    expect(spendAllows('to cast artifact spells', on(BEAR))).toBe(false);
    const eldrazi = 'to cast colorless Eldrazi spells or activate abilities of colorless Eldrazi';
    expect(spendAllows(eldrazi, on(SEER))).toBe(true);
    expect(spendAllows(eldrazi, on(RUINATION))).toBe(true); // devoid: colorless
    expect(spendAllows(eldrazi, on(STONE))).toBe(false);
    expect(spendAllows(eldrazi, spendOnCard(SEER, 'ability'))).toBe(true);
  });

  test('the chosen creature type is not kept: a creature maybe, never a Bolt', () => {
    const cavern = "to cast a creature spell of the chosen type, and that spell can't be countered";
    expect(spendAllows(cavern, on(BEAR))).toBeNull();
    expect(spendAllows(cavern, on(BOLT))).toBe(false);
    expect(spendAllows('to cast monocolored spells of that color', on(GUILD))).toBe(false);
  });

  test('lists of kinds, noncreature, mana value, {X}, the commander, kicked', () => {
    expect(spendAllows('to cast instant and sorcery spells', on(BOLT))).toBe(true);
    expect(spendAllows('to cast Vampire, Cleric, and/or Demon spells', on(rec('v', 'Creature — Vampire Cleric', '{B}', '')))).toBe(true);
    expect(spendAllows('to cast noncreature spells', on(BEAR))).toBe(false);
    expect(spendAllows('to cast noncreature spells', on(STONE))).toBe(true);
    const big = 'to cast creature spells with mana value 4 or greater or creature spells with {X} in their mana costs';
    expect(spendAllows(big, on(SEER))).toBe(true);
    expect(spendAllows(big, on(BEAR))).toBe(false);
    expect(spendAllows(big, on(rec('h', 'Creature — Hydra', '{X}{G}', '')))).toBe(true);
    expect(spendAllows('on costs that contain {X}', on(rec('f', 'Sorcery', '{X}{R}', '')))).toBe(true);
    expect(spendAllows('to cast your commander', on(BEAR))).toBe(false);
    expect(spendAllows('to cast your commander', on(BEAR, { from: 'command', commander: true }))).toBe(true);
    expect(spendAllows('to cast kicked spells', on(BOLT))).toBe(false);
    expect(spendAllows('to cast kicked spells', on(BOLT, { kicked: true }))).toBe(true);
  });

  test('abilities: any, of artifacts, equip; never a spell', () => {
    const ability = spendOnCard(STONE, 'ability');
    expect(spendAllows('to activate abilities', ability)).toBe(true);
    expect(spendAllows('to activate abilities', on(STONE))).toBe(false);
    expect(spendAllows('to cast artifact spells or activate abilities of artifacts', ability)).toBe(true);
    expect(spendAllows('to activate abilities of artifacts', spendOnCard(BEAR, 'ability'))).toBe(false);
    const equip = 'to cast an Equipment spell or activate an equip ability';
    expect(spendAllows(equip, spendOnCard(STONE, 'ability', 0, { equip: true }))).toBe(true);
    expect(spendAllows(equip, ability)).toBe(false);
  });

  test('what the app cannot read is null; what is never a payment here is false', () => {
    expect(spendAllows('to cast a spell that shares a watermark with this land', on(BOLT))).toBeNull();
    expect(spendAllows('to cast spells you don\'t own', on(BOLT))).toBeNull();
    expect(spendAllows('to turn permanents face up', on(BEAR))).toBe(false);
    expect(spendAllows('to pay cumulative upkeep costs', on(BEAR))).toBe(false);
    expect(spendAllows('to pay cumulative upkeep costs', { act: 'upkeep', typeLine: '', colors: [], manaValue: 0 })).toBe(true);
  });

  test('an adventure is paid as the half cast: the creature, or the instant', () => {
    const [giant, stomp] = castCosts(GIANT, 'hand');
    expect(giant.on).toMatchObject({ act: 'cast', typeLine: 'Creature — Giant', colors: ['R'], manaValue: 3 });
    expect(stomp.on).toMatchObject({ typeLine: 'Instant — Adventure', manaValue: 2 });
  });
});

describe('paying with mana kept for some spells', () => {
  test('a source keeps the words, and what it makes for anything else', () => {
    const [ziggurat, cavern, temple] = table('Ancient Ziggurat', 'Cavern of Souls', 'Eldrazi Temple');
    expect(ziggurat).toMatchObject({ produces: ['any'], amount: 1, only: 'to cast a creature spell' });
    expect(ziggurat.free).toBeUndefined();
    expect(cavern).toMatchObject({ produces: ['C', 'any'], amount: 1, free: { produces: ['C'], amount: 1 } });
    expect(temple).toMatchObject({ produces: ['C'], amount: 2, free: { produces: ['C'], amount: 1 } });
    expect(table('Forest')[0].only).toBeUndefined();
  });

  test('Ancient Ziggurat pays for a creature, never for a Lightning Bolt', () => {
    expect(planPayment(cast(BOLT), table('Ancient Ziggurat'))).toBeNull();
    expect(tapped(planPayment(cast(BOLT), table('Ancient Ziggurat', 'Mountain')))).toEqual(['Mountain']);
    // For the Bears it goes first: its mana is good for nothing else.
    expect(tapped(planPayment(cast(BEAR), table('Forest', 'Forest', 'Ancient Ziggurat')))).toEqual(['Ancient Ziggurat', 'Forest']);
  });

  test('Cavern of Souls is a colorless land for anything but a creature', () => {
    expect(planPayment(cast(BOLT), table('Cavern of Souls'))).toBeNull();
    expect(planPayment(cast(rec('Ornithopter', 'Artifact Creature — Thopter', '{1}', '')), table('Cavern of Souls'))).not.toBeNull();
    expect(planPayment(cast(rec('Duress', 'Sorcery', '{B}', '')), table('Cavern of Souls'))).toBeNull();
    expect(planPayment(cast(rec('Llanowar Elves', 'Creature — Elf Druid', '{G}', '')), table('Cavern of Souls'))).not.toBeNull();
    // Which type it named is not known: for a creature it pays only when nothing else does.
    expect(tapped(planPayment(cast(BEAR), table('Cavern of Souls', 'Forest', 'Ancient Ziggurat')))).toEqual(['Ancient Ziggurat', 'Forest']);
  });

  test('Pillar of the Paruns pays a multicolored spell only', () => {
    expect(planPayment(cast(GUILD), table('Pillar of the Paruns', 'Pillar of the Paruns', 'Wastes'))).not.toBeNull();
    expect(planPayment(cast(BEAR), table('Pillar of the Paruns', 'Wastes'))).toBeNull();
    // Rootborn Defenses is white only: the Pillar sits out.
    expect(planPayment(cast(ROOT), table('Pillar of the Paruns', 'Pillar of the Paruns', 'Pillar of the Paruns'))).toBeNull();
  });

  test('Eldrazi Temple makes two for an Eldrazi, one for anything else', () => {
    expect(planPayment(cast(SEER), table('Eldrazi Temple', 'Wastes', 'Wastes'))).not.toBeNull();
    expect(planPayment(cast(SEER), table('Wastes', 'Wastes', 'Wastes'))).toBeNull();
    expect(planPayment(cast(STONE), table('Eldrazi Temple'))).toBeNull();
    expect(planPayment(cast(STONE), table('Eldrazi Temple', 'Wastes'))).not.toBeNull();
  });

  test('Mishra\'s Workshop pays artifacts; X counts only what it may pay', () => {
    expect(planPayment(cast(STONE), table("Mishra's Workshop"))).not.toBeNull();
    expect(planPayment(cast(BEAR), table("Mishra's Workshop", 'Forest'))).toBeNull();
    const fireball = castCosts(rec('Fireball', 'Sorcery', '{X}{R}', ''), 'hand')[0];
    expect(maxX(fireball, table("Mishra's Workshop", 'Mountain', 'Mountain'))).toBe(1);
  });

  test('an adventure creature takes the creature-only mana; its instant half does not', () => {
    const sources = table('Ancient Ziggurat', 'Ancient Ziggurat', 'Mountain');
    const [giant, stomp] = castCosts(GIANT, 'hand');
    expect(planPayment(giant, sources)).not.toBeNull();
    expect(planPayment(stomp, table('Ancient Ziggurat', 'Ancient Ziggurat'))).toBeNull();
    expect(planAnyFace(castCosts(GIANT, 'hand'), table('Ancient Ziggurat', 'Ancient Ziggurat', 'Mountain'))).not.toBeNull();
  });

  test('words the app cannot read still pay — after everything else', () => {
    expect(planPayment(cast(BOLT), table('Secret Base'))).not.toBeNull();
    expect(tapped(planPayment(cast(STONE), table('Secret Base', 'Wastes', 'Wastes')))).toEqual(['Wastes', 'Wastes']);
  });

  test('a kicked spell may use Elfhame Druid\'s two', () => {
    const kicker = rec('Gift of Growth', 'Instant', '{1}{G}', 'Kicker {2}\nTarget creature gets +2/+2 until end of turn. If this spell was kicked, that creature gets +4/+4 instead.');
    const extras = extraCosts(kicker);
    const plain = priceExtras(castCosts(kicker, 'hand'), extras, extraTimes(extras, [0]))[0];
    const kicked = priceExtras(castCosts(kicker, 'hand'), extras, extraTimes(extras, [1]))[0];
    expect(kicked.on?.kicked).toBe(true);
    const sources = table('Elfhame Druid', 'Forest', 'Wastes');
    expect(planPayment(plain, sources)).not.toBeNull();
    // Kicked it costs four: the Druid's two, the Forest and the Wastes.
    expect(planPayment(kicked, sources)).not.toBeNull();
    // A four-mana spell that is not kicked gets only one from the Druid.
    expect(planPayment(cast(rec('Big', 'Sorcery', '{3}{G}', '')), sources)).toBeNull();
  });

  test('a tapped Cavern floats only what it makes for anything', () => {
    const battlefield: CardInstance[] = [{ iid: 'c', cardId: 'Cavern of Souls', name: 'Cavern of Souls', row: 'lands', tapped: true }];
    const [cavern] = sourcesFrom(battlefield, RECORDS, []);
    expect(cavern).toMatchObject({ floating: true, amount: 1 });
    expect(sourcesFor([cavern], cast(BOLT).on)).toEqual([{ key: 'c', kind: 'virtual', produces: ['C'], amount: 1, floating: true }]);
  });

  test('Pay with: a lit Ziggurat does not pay for a Bolt', () => {
    const lit = table('Ancient Ziggurat');
    const t = tally(cast(BOLT), lit);
    expect(t).toMatchObject({ of: 1, paid: 0, plan: null });
    expect(tallyWords(cast(BOLT), t)).toBe('1 more to go · still needs red');
    expect(tally(cast(rec('Llanowar Elves', 'Creature — Elf Druid', '{G}', '')), lit).plan).not.toBeNull();
  });

  test('abilities and equip costs say what they pay for', () => {
    const golem = rec('Eldrazi Thing', 'Creature — Eldrazi', '{6}', '{C}: Eldrazi Thing gets +1/+0 until end of turn.');
    const [ability] = abilitiesOf(golem);
    expect(ability?.cost.on).toMatchObject({ act: 'ability', typeLine: 'Creature — Eldrazi', colors: [] });
    const [way] = equipWays(rec('Bonesplitter', 'Artifact — Equipment', '{1}', 'Equipped creature gets +2/+0.\nEquip {1}'));
    expect(way.cost.on).toMatchObject({ act: 'ability', equip: true });
  });
});
