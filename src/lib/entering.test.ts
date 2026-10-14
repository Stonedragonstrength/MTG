import { expect, test } from 'vitest';
import { countersWords, entryCounters, isSaga, missingCounters } from './entering';

const card = (name: string, oracleText: string, typeLine = 'Creature — Test') => ({ name, oracleText, typeLine });

test('"enters with two +1/+1 counters on it": the card itself, by any of its names', () => {
  expect(entryCounters(card('Spike Feeder', 'This creature enters with two +1/+1 counters on it.'))).toEqual({ p1p1: 2 });
  expect(entryCounters(card('Yorvo, Lord of Garenbrig', 'Yorvo enters with four +1/+1 counters on it.'))).toEqual({ p1p1: 4 });
  expect(entryCounters(card('Daghatar the Adamant', 'Daghatar enters with four +1/+1 counters on it.'))).toEqual({ p1p1: 4 });
  expect(entryCounters(card('Old Card', 'Old Card enters the battlefield with a +1/+1 counter on it.'))).toEqual({ p1p1: 1 });
});

test('other kinds of counters, -1/-1 counters, and a land that enters tapped with them', () => {
  expect(entryCounters(card('Sickle Ripper', 'This creature enters with two -1/-1 counters on it.'))).toEqual({ m1m1: 2 });
  expect(entryCounters(card('Vivid Crag', 'This land enters tapped with two charge counters on it.', 'Land'))).toEqual({ charge: 2 });
  expect(entryCounters(card('Rigo, Streetwise Mentor', 'Rigo enters with a shield counter on it. (If it would be dealt damage or destroyed, remove a shield counter from it instead.)'))).toEqual({ shield: 1 });
});

test('a number the table would have to work out is left to its player', () => {
  expect(entryCounters(card('Hydra', 'This creature enters with X +1/+1 counters on it.'))).toEqual({});
  expect(entryCounters(card('Avatar', 'This creature enters with a +1/+1 counter on it for each other creature you control.'))).toEqual({});
  expect(entryCounters(card('Kavu', 'If this creature was kicked, it enters with four +1/+1 counters on it.'))).toEqual({});
  expect(entryCounters(card('Turtle', 'Patient Turtle enters with two +1/+1 counters on it if you didn’t go first this game.'))).toEqual({});
  expect(entryCounters(card('Mimic', 'Each other creature you control of the chosen type enters with an additional +1/+1 counter on it.'))).toEqual({});
  // Bloodthirst asks what happened this turn: its reminder text is not read.
  expect(entryCounters(card('Carnage Wurm', 'Bloodthirst 3 (If an opponent was dealt damage this turn, this creature enters with three +1/+1 counters on it.)'))).toEqual({});
});

test('keywords that bring counters: Vanishing, Fading, Modular, Graft — and a Saga its first lore counter', () => {
  expect(entryCounters(card('Keldon Marauders', 'Vanishing 2 (This creature enters with two time counters on it. At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it.)'))).toEqual({ time: 2 });
  expect(entryCounters(card('Blastoderm', 'Shroud\nFading 3 (This creature enters with three fade counters on it.)'))).toEqual({ fade: 3 });
  expect(entryCounters(card('Arcbound Ravager', 'Sacrifice an artifact: Put a +1/+1 counter on this creature.\nModular 1 (This creature enters with a +1/+1 counter on it.)'))).toEqual({ p1p1: 1 });
  expect(entryCounters(card('Cytoplast Root-Kin', 'Graft 4 (This creature enters with four +1/+1 counters on it.)'))).toEqual({ p1p1: 4 });
  const benalia = card('History of Benalia', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI, II — Create a 2/2 white Knight creature token with vigilance.\nIII — Knights you control get +2/+1 until end of turn.', 'Enchantment — Saga');
  expect(isSaga(benalia)).toBe(true);
  expect(entryCounters(benalia)).toEqual({ lore: 1 });
  // Read as the face that is up: the creature on Fable's back is no Saga.
  expect(isSaga({ ...benalia, typeLine: 'Enchantment Creature — Goblin Shaman // Enchantment — Saga' })).toBe(false);
});

test('what an arrival still needs, and how the feed says counters', () => {
  expect(missingCounters({ p1p1: 2, lore: 1 }, { p1p1: 1 })).toEqual({ lore: 1 });
  expect(missingCounters({ p1p1: 2 }, undefined)).toEqual({ p1p1: 2 });
  expect(countersWords({ p1p1: 2, lore: 1 })).toBe('two +1/+1 counters and a lore counter');
  expect(countersWords({ m1m1: 1 })).toBe('a -1/-1 counter');
});
