import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { findGlossaryTerms, parseRules } from './rulesParser';

const FIXTURE = [
  'Magic: The Gathering Comprehensive Rules',
  ' ',
  'Contents',
  ' ',
  '702. Keyword Abilities',
  ' ',
  'Glossary',
  ' ',
  'Credits',
  ' ',
  '702.19. Protection',
  ' ',
  '702.19a Protection is a static ability.',
  ' ',
  '702.19b A permanent or player with protection can’t be targeted by spells with the stated quality.',
  'It also can’t be targeted by abilities from a source with the stated quality.',
  ' ',
  'Glossary',
  ' ',
  'First Strike',
  'A keyword ability that lets a creature deal its combat damage before other creatures. See rule 702.7, “First Strike.”',
  ' ',
  'Flying',
  'A keyword ability that restricts how a creature may be blocked.',
  'See rule 702.9, “Flying.”',
  ' ',
  'Credits',
  ' ',
  'Original game design: Richard Garfield',
].join('\n');

describe('parseRules', () => {
  const { rules, glossary } = parseRules(FIXTURE);

  test('parses numbered rules including sub-letter rules', () => {
    const r = rules.find((x) => x.number === '702.19a');
    expect(r?.text).toBe('Protection is a static ability.');
    expect(rules.find((x) => x.number === '702.19')?.text).toBe('Protection');
  });

  test('continuation lines fold into the preceding rule', () => {
    const r = rules.find((x) => x.number === '702.19b');
    expect(r?.text).toContain('can’t be targeted by spells');
    expect(r?.text).toContain('abilities from a source');
  });

  test('parses glossary entries including multi-line definitions', () => {
    expect(glossary).toHaveLength(2);
    const flying = glossary.find((g) => g.term === 'Flying');
    expect(flying?.definition).toContain('restricts how a creature may be blocked');
    expect(flying?.definition).toContain('See rule 702.9');
  });

  test('glossary stops at Credits and skips the table of contents', () => {
    expect(glossary.some((g) => g.term.includes('Original game design'))).toBe(false);
    expect(glossary.some((g) => g.term === 'Credits')).toBe(false);
    expect(rules.some((r) => r.text === 'Keyword Abilities')).toBe(true);
  });
});

describe('findGlossaryTerms', () => {
  const terms = ['Flying', 'First Strike', 'First', 'Ward'];

  test('finds terms with correct offsets, preferring the longest match', () => {
    const text = 'Flying, first strike';
    const found = findGlossaryTerms(text, terms);
    expect(found).toEqual([
      { term: 'Flying', start: 0, end: 6 },
      { term: 'First Strike', start: 8, end: 20 },
    ]);
  });

  test('respects word boundaries: Warding does not match Ward', () => {
    expect(findGlossaryTerms('Warding spells cost more.', terms)).toEqual([]);
  });

  test('matches are case-insensitive but report source offsets', () => {
    const found = findGlossaryTerms('Target creature gains flying.', terms);
    expect(found).toEqual([{ term: 'Flying', start: 22, end: 28 }]);
  });
});

describe('real comprehensive rules file', () => {
  test('parses thousands of rules and hundreds of glossary entries', () => {
    const text = readFileSync(
      resolve(process.cwd(), 'public/rules/comprehensive-rules.txt'),
      'utf8',
    );
    const { rules, glossary } = parseRules(text);
    expect(rules.length).toBeGreaterThan(2000);
    expect(glossary.length).toBeGreaterThan(500);
    const deathtouch = glossary.find((g) => g.term === 'Deathtouch');
    expect(deathtouch?.definition).toMatch(/keyword ability/i);
  });
});
