import { describe, expect, test } from 'vitest';
import { edhrecUrl } from './edhrec';

describe('edhrecUrl', () => {
  test('commanders go to the commander page', () => {
    expect(edhrecUrl('Ragavan, Nimble Pilferer', true)).toBe(
      'https://edhrec.com/commanders/ragavan-nimble-pilferer',
    );
  });

  test('other cards go to the card page', () => {
    expect(edhrecUrl('Sol Ring', false)).toBe('https://edhrec.com/cards/sol-ring');
  });

  test('apostrophes and diacritics are stripped', () => {
    expect(edhrecUrl("Teferi's Protection", false)).toBe(
      'https://edhrec.com/cards/teferis-protection',
    );
    expect(edhrecUrl('Lim-Dûl the Necromancer', true)).toBe(
      'https://edhrec.com/commanders/lim-dul-the-necromancer',
    );
  });

  test('double-faced names use the front face', () => {
    expect(edhrecUrl('Delver of Secrets // Insectile Aberration', false)).toBe(
      'https://edhrec.com/cards/delver-of-secrets',
    );
  });
});
