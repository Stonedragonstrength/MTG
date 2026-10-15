import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { findCardByName, getCardById } from '../data/scryfall';
import { playEntrance } from '../lib/sound';
import { useAppStore } from '../state/store';
import '../styles/entrance.css';

/** How long a commander holds the stage. */
export const ENTRANCE_MS = 2600;

interface Arrival {
  key: number;
  seat: number;
  cardId: string;
  name: string;
}

interface Props {
  /** The edge of the table a seat sits at: the moment faces the caster. */
  edgeOf: (seat: number) => string;
  flipped: (seat: number) => boolean;
}

/** A commander arriving on the battlefield gets a moment of its own: the
 * card, big, in front of the table for a breath, then it takes its place.
 * Read off the table, so every device at an online table sees it. Taps go
 * straight through it to the board. */
export default function CommanderEntrance({ edgeOf, flipped }: Props) {
  const game = useAppStore((s) => s.game);
  const soundOn = useAppStore((s) => s.settings.soundOn);
  // Where each commander was at the last look: on the battlefield or not.
  const seen = useRef<Map<string, boolean> | null>(null);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    if (!game) return;
    const now = new Map<string, boolean>();
    let came: Arrival | null = null;
    game.players.forEach((p, seat) => {
      const cards = p.cards;
      if (!cards?.cmd) return;
      for (const iid of Object.keys(cards.cmd)) {
        const card = cards.battlefield.find((c) => c.iid === iid);
        now.set(iid, !!card);
        if (card && seen.current?.get(iid) === false) came = { key: Date.now(), seat, cardId: card.cardId, name: card.name };
      }
    });
    seen.current = now;
    if (came) setArrival(came);
  }, [game]);

  useEffect(() => {
    if (!arrival) return;
    let live = true;
    setImage(null);
    void (async () => {
      const record = (await getCardById(arrival.cardId)) ?? (await findCardByName(arrival.name));
      if (live) setImage(record?.imageNormal ?? null);
    })().catch(() => {});
    if (soundOn) playEntrance();
    const t = window.setTimeout(() => setArrival(null), ENTRANCE_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // The moment is the arrival's; a sound setting changed meanwhile does not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival]);

  if (!arrival) return null;
  const style = (flipped(arrival.seat) ? { '--flip': '180deg' } : {}) as CSSProperties;
  return (
    <div className="cmd-entrance" data-testid="commander-entrance" aria-hidden="true" key={arrival.key}>
      <div className={`cmd-entrance-panel cmd-entrance-panel--${edgeOf(arrival.seat)}`} style={style}>
        <div className="cmd-entrance-dim" />
        <div className="cmd-entrance-rays" />
        <div className="cmd-entrance-ring" />
        {image && <img className="cmd-entrance-card" src={image} alt="" />}
        <div className="cmd-entrance-name">
          <span className="cmd-entrance-kicker">Commander</span>
          <span className="cmd-entrance-title">{arrival.name.split(' // ')[0]}</span>
        </div>
      </div>
    </div>
  );
}
