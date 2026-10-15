import type { Deck, DeckCard } from './types';

/** The deck (commanders aside) shuffled, one entry per copy: what a sample
 * hand is drawn from. */
export function shuffledDeck(deck: Deck, rand: () => number = Math.random): DeckCard[] {
  const cards = deck.cards.flatMap((c) => Array.from({ length: Math.max(0, Math.floor(c.count)) }, () => c));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** A land by its front face ("Sorcery // Land" is a spell in the hand). */
export const isLandLine = (typeLine: string) => /\bLand\b/.test(typeLine.split(' // ')[0]);
