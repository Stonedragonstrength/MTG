import { useEffect, useState } from 'react';
import { cardManaValue, planDiscover, type CascadePlan } from '../lib/cascade';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useSettleTaps } from './useSettleTaps';

interface Props {
  playerIdx: number;
  /** Discover N: the most mana value the card it finds may have. Null when
   * the card works it out ("discover X, where X is…"): the sheet asks. */
  n: number | null;
  /** The card that discovers, for the title and the feed. */
  source: string;
  /** "Exile a creature card from your graveyard: Discover X, where X is the
   * mana value of the exiled card": the sheet asks for the card, and X is
   * its mana value. */
  pick?: 'creature';
  /** Carries the answer out in place of a plain discover — an ability's,
   * which pays its cost in the same move (store.activateAbility). `pick`:
   * the card picked to exile. */
  carryOut?: (plan: CascadePlan, take: 'cast' | 'hand', n: number, pick?: string) => Promise<void> | void;
  /** Closed: `did` when the discover was carried out. */
  onClose: (did: boolean) => void;
}

/** The X a "discover X" may be: one tap each. */
const XS = Array.from({ length: 13 }, (_, i) => i);
const NO_CARDS: CardInstance[] = [];

/** Discover N, the way a card asks for it: the cards are turned over from the
 * top of the library until a nonland card with mana value N or less — that
 * one big, the rest small, on their way to the bottom. Its player casts it
 * without paying its mana cost or puts it into their hand, and the rest go
 * to the bottom in a random order: one move at the table, one Undo
 * (store.discover). Closed without an answer, nothing has happened. */
export default function DiscoverSheet({ playerIdx, n, source, pick, carryOut, onClose }: Props) {
  // It opens under the finger that pressed the button.
  useSettleTaps();
  const discover = useAppStore((s) => s.discover);
  // The N it discovers for: the card's own, or the X its player names.
  const [value, setValue] = useState<number | null>(n);
  // The creature card it exiles to pay for itself, once picked.
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const graveyard = useAppStore((s) => (pick ? s.game?.players[playerIdx]?.cards?.graveyard : undefined)) ?? NO_CARDS;
  const graveRecords = useCardRecords(graveyard);
  // Read once N is known: the cards it turns over are the ones on top then.
  // undefined while reading; null when a card on the way cannot be read.
  const [plan, setPlan] = useState<CascadePlan | null | undefined>(undefined);
  useEffect(() => {
    if (value === null) return;
    let live = true;
    const library = useAppStore.getState().game?.players[playerIdx]?.cards?.library ?? [];
    void (async () => {
      const m = await import('../data/scryfall');
      const read = async (c: CardInstance) =>
        (await m.getCardById(c.cardId).catch(() => undefined)) ?? (await m.findCardByName(c.name).catch(() => undefined));
      const planned = await planDiscover(library, value, read).catch(() => null);
      if (live) setPlan(planned);
    })();
    return () => {
      live = false;
    };
  }, [playerIdx, value]);

  const exiled = plan?.exiled ?? [];
  const records = useCardRecords(exiled);
  const found = plan?.found ?? null;
  const misses = exiled.filter((c) => c.iid !== found?.iid);
  const title = `Discover ${value ?? 'X'} · ${source}`;

  if (pick && picked === null) {
    // Newest first, as the graveyard pile shows it.
    const creatures = [...graveyard].reverse().filter((c) => /\bCreature\b/.test(graveRecords[c.cardId]?.typeLine.split(' // ')[0] ?? ''));
    const reading = graveyard.some((c) => !(c.cardId in graveRecords));
    return (
      <Sheet title={title} onClose={() => onClose(false)} size="roomy">
        <p className="hint discover-hint">
          {creatures.length > 0
            ? 'Which creature card does it exile from your graveyard? X is its mana value.'
            : reading
              ? 'Reading your graveyard…'
              : 'No creature card in your graveyard to exile.'}
        </p>
        <ol className="discover-misses discover-picks" aria-label="creature cards">
          {creatures.map((c) => {
            const mv = cardManaValue(graveRecords[c.cardId]!);
            return (
              <li key={c.iid} className="find-card">
                <button
                  aria-label={`${c.name}, mana value ${mv}`}
                  onClick={() => {
                    setPicked(c.iid);
                    setValue(mv);
                  }}
                >
                  {graveRecords[c.cardId]?.imageNormal ? <img src={graveRecords[c.cardId]!.imageNormal!} alt="" loading="lazy" /> : null}
                  <span className="find-name">
                    {c.name} · {mv}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </Sheet>
    );
  }

  if (value === null)
    return (
      <Sheet title={title} onClose={() => onClose(false)} size="roomy">
        <p className="hint discover-hint">How much is X? The card says how to work it out.</p>
        <div className="discover-xs" role="group" aria-label="X">
          {XS.map((x) => (
            <button key={x} className="chip" onClick={() => setValue(x)}>
              {x}
            </button>
          ))}
        </div>
      </Sheet>
    );

  const answer = async (take: 'cast' | 'hand') => {
    if (!plan || busy) return;
    setBusy(true);
    const before = useAppStore.getState().game;
    if (carryOut) await carryOut(plan, take, value, picked ?? undefined);
    else discover(playerIdx, plan, take, value, source);
    // The library changed under it (a draw in between), or the cost can no
    // longer be paid: nothing happened.
    onClose(useAppStore.getState().game !== before);
  };

  const footer = !plan || exiled.length === 0 ? undefined : found ? (
    <>
      <button className="primary" onClick={() => void answer('cast')}>
        Cast {found.name}
      </button>
      <button onClick={() => void answer('hand')}>Put it into your hand</button>
    </>
  ) : (
    <button className="primary" onClick={() => void answer('hand')}>
      Shuffle them back
    </button>
  );

  return (
    <Sheet title={title} onClose={() => onClose(false)} size="roomy" footer={footer}>
      {plan === undefined ? (
        <p className="hint">Turning cards over…</p>
      ) : plan === null ? (
        <p className="hint">A card in the library could not be read — discover by hand.</p>
      ) : exiled.length === 0 ? (
        <p className="hint">The library is empty.</p>
      ) : (
        <>
          <p className="hint discover-hint">
            {found
              ? 'Cast it without paying its mana cost, or put it into your hand. The others go to the bottom in a random order.'
              : `No nonland card with mana value ${value} or less: every card goes back, to the bottom in a random order.`}
          </p>
          <div className="discover-cards">
            {found && (
              <figure className="discover-found">
                {records[found.cardId]?.imageNormal ? <img src={records[found.cardId]!.imageNormal!} alt="" /> : null}
                <figcaption>{found.name}</figcaption>
              </figure>
            )}
            {misses.length > 0 && (
              <div className="discover-rest">
                <p className="discover-label">{found ? 'To the bottom' : 'Turned over'}</p>
                <ol className="discover-misses" aria-label="turned over">
                  {misses.map((c) => (
                    <li key={c.iid} className="find-card">
                      {records[c.cardId]?.imageNormal ? <img src={records[c.cardId]!.imageNormal!} alt="" loading="lazy" /> : null}
                      <span className="find-name">{c.name}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
