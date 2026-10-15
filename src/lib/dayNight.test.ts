import { describe, expect, test } from 'vitest';
import { castsThisTurn, dayNightNeeds, turnedDayNight, withCasts } from './dayNight';
import { backId } from './faces';
import { createGame } from './game';
import type { CardInstance, CardRecord, GameState } from './types';

const base = (): GameState =>
  createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });

describe('counting the spells of a turn', () => {
  test('only the active player’s spells count, and a new turn starts from none', () => {
    let g = base();
    const moved = { ...g, monarchIdx: 0 };
    g = withCasts(g, moved, [0, 1, 0]);
    expect(castsThisTurn(g)).toBe(2);
    g = withCasts(g, { ...g, monarchIdx: 1 }, [0]);
    expect(castsThisTurn(g)).toBe(3);
    expect(castsThisTurn({ ...g, activePlayerIndex: 1 })).toBe(0);
  });

  test('a move that cast nothing of theirs comes back as it was', () => {
    const g = base();
    const next = { ...g, monarchIdx: 0 };
    expect(withCasts(g, next, [])).toBe(next);
    expect(withCasts(g, next, [1])).toBe(next);
  });
});

describe('turnedDayNight', () => {
  test('a day with no spells becomes night; one spell keeps it day', () => {
    const day = { ...base(), dayNight: 'day' as const };
    expect(turnedDayNight(day)).toBe('night');
    expect(turnedDayNight(withCasts(day, { ...day, monarchIdx: 0 }, [0]))).toBe('day');
  });

  test('a night with two spells becomes day; one keeps it night', () => {
    const night = { ...base(), dayNight: 'night' as const };
    const one = withCasts(night, { ...night, monarchIdx: 0 }, [0]);
    expect(turnedDayNight(one)).toBe('night');
    expect(turnedDayNight(withCasts(one, { ...one, monarchIdx: 1 }, [0]))).toBe('day');
  });

  test('neither stays neither', () => {
    expect(turnedDayNight(base())).toBeUndefined();
  });
});

const rec = (id: string, name: string, oracleText: string): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine: 'Creature — Human Werewolf',
  oracleText,
  manaCost: '',
  power: '2',
  toughness: '2',
  colors: ['R'],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
});
const RECORDS: Record<string, CardRecord> = {
  cathar: rec('cathar', 'Brutal Cathar', 'Daybound'),
  [backId('cathar')]: rec(backId('cathar'), 'Moonrage Brute', 'First strike\nNightbound'),
  bears: rec('bears', 'Grizzly Bears', ''),
};
const withCards = (g: GameState, battlefield: CardInstance[]): GameState => ({
  ...g,
  players: g.players.map((p, i) =>
    i === 1
      ? { ...p, cards: { library: [], hand: [], battlefield, graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'D' } }
      : p,
  ),
});

describe('dayNightNeeds', () => {
  test('a daybound permanent out while it is neither: it becomes day, nothing turns over', () => {
    const g = withCards(base(), [{ iid: 'c', cardId: 'cathar', name: 'Brutal Cathar' }]);
    expect(dayNightNeeds(g, RECORDS)).toEqual({ becomeDay: true, flips: [] });
  });

  test('night: the daybound face turns over', () => {
    const g = { ...withCards(base(), [{ iid: 'c', cardId: 'cathar', name: 'Brutal Cathar' }]), dayNight: 'night' as const };
    expect(dayNightNeeds(g, RECORDS)).toEqual({
      becomeDay: false,
      flips: [{ seat: 1, iid: 'c', name: 'Brutal Cathar', toBack: true }],
    });
  });

  test('day: the nightbound face turns back', () => {
    const g = { ...withCards(base(), [{ iid: 'c', cardId: backId('cathar'), name: 'Brutal Cathar' }]), dayNight: 'day' as const };
    expect(dayNightNeeds(g, RECORDS).flips).toEqual([{ seat: 1, iid: 'c', name: 'Brutal Cathar', toBack: false }]);
  });

  test('nothing to do on a table with no day/night cards', () => {
    const g = withCards(base(), [{ iid: 'b', cardId: 'bears', name: 'Grizzly Bears' }]);
    expect(dayNightNeeds(g, RECORDS)).toEqual({ becomeDay: false, flips: [] });
  });
});
