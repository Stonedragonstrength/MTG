import { createBoardItem } from '../lib/board';
import { bestToken, type TokenWant } from '../lib/deckTokens';
import { effectOf, type SpellPrompt, type SpellTarget } from '../lib/spellEffects';
import type { CardRecord } from '../lib/types';
import { useAppStore } from '../state/store';

/** Carrying out what a card does, once somebody (or the card itself: a
 * trigger) has said so — shared by the cast banner and the trigger banner.
 * Each is one move at the table: one Undo. */

/** The token card a "make tokens" effect would put on the board, when this
 * device has one for it. */
export async function findTokenCard(want: TokenWant): Promise<CardRecord | undefined> {
  const { findCardsNamed } = await import('../data/scryfall');
  return bestToken(want, await findCardsNamed(want.name)) ?? undefined;
}

/** Does one effect for `seat`, in the name of the card `source` (with its
 * target, where it asked for one). False when there was nothing to do: no
 * token card for it, or a target that does not go with it. A search is not
 * done here — it is a list of its own. */
export function carryOutPrompt(
  seat: number,
  source: string,
  prompt: SpellPrompt,
  token: CardRecord | undefined,
  target?: SpellTarget,
): boolean {
  const store = useAppStore.getState();
  if (prompt.kind === 'search') return false;
  if (prompt.kind === 'draw') {
    store.drawCards(target?.seat ?? seat, prompt.n);
    return true;
  }
  if (prompt.kind === 'tokens') {
    if (!token) return false;
    // As a token chip does it: more of a token already on the board joins
    // its plain stack, otherwise a new stack arrives.
    const stack = store.game?.players[seat]?.board.find(
      (it) => it.cardId === token.id && it.zone === 'board' && Object.keys(it.counters).length === 0,
    );
    if (stack) store.changeCount(seat, stack.id, prompt.n);
    else store.addItem(seat, { ...createBoardItem(token, 'board'), count: prompt.n });
    return true;
  }
  const effect = effectOf(prompt, seat, target);
  if (!effect) return false;
  void store.castEffect(seat, source, effect);
  return true;
}
