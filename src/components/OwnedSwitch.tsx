import { useAppStore } from '../state/store';

/** Whether this deck is made of cards its owner physically has. Only then
 * does adding to it also log to the Curation: a list typed, pasted or
 * suggested from somewhere else is a plan, not a collection. Off until
 * ticked, and remembered with the deck. */
export default function OwnedSwitch({ deckId }: { deckId: string }) {
  const owned = useAppStore((s) => !!s.decks.find((d) => d.id === deckId)?.owned);
  const saveDeck = useAppStore((s) => s.saveDeck);

  function set(next: boolean) {
    // The freshest deck: cards may be landing while the box is ticked.
    const deck = useAppStore.getState().decks.find((d) => d.id === deckId);
    if (deck) void saveDeck({ ...deck, owned: next });
  }

  return (
    <label className="owned-switch">
      <input type="checkbox" checked={owned} onChange={(e) => set(e.target.checked)} />
      <span>I own these cards — add them to my Curation too</span>
    </label>
  );
}
