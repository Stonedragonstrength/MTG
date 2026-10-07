import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { REVEAL_FRESH_MS } from '../lib/cards';
import type { Reveal } from '../lib/types';
import { useAppStore } from '../state/store';
import { shieldBoard } from './Sheet';
import { useCardRecords } from './useCardRecords';

/** How long it stays in view before it puts itself away. */
const SHOW_MS = 12_000;
const TICK_MS = 1000;
/** A tap this soon after it came up was aimed at the board it now covers. */
const SETTLE_MS = 350;
/** Up to five cards across; more wrap onto further rows. */
const PER_ROW = 5;

/** Reveals this device has put away, by id. Kept in the browser session as
 * well as in memory, so a reload does not show a young one a second time.
 * Where the session cannot store (or is a new one) only that is lost: the
 * two-minute limit still keeps old reveals from coming back. */
const SESSION_KEY = 'reveals-put-away';
const putAway = new Set<string>(rememberedInSession());

function rememberedInSession(): string[] {
  try {
    const ids: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function putReveal(id: string): void {
  putAway.add(id);
  try {
    // Only the latest reveal can ever come back, so a short tail is plenty.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...putAway].slice(-20)));
  } catch {
    // Memory alone will do.
  }
}

/** Test hook: a fresh page load — memory gone, the session's storage still there. */
export function _reloadRevealMemory(): void {
  putAway.clear();
  for (const id of rememberedInSession()) putAway.add(id);
}

interface PanelProps {
  reveal: Reveal;
  who: string;
  onDone: () => void;
}

function RevealPanel({ reveal, who, onDone }: PanelProps) {
  const records = useCardRecords(reveal.cards);

  // The tap that puts it away is often the first half of a double tap, and a
  // finger may be on its way when it times out: either way the board it was
  // covering sits out the next moment, as it does behind a closing sheet.
  useEffect(() => shieldBoard, []);

  // Every change at the table redraws this; only a NEW reveal restarts its clock.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    // Sheets lie over it (it sits under every backdrop), so its twelve
    // seconds only run while it can be seen: a player who reveals from a
    // look still gets to see it land once the look is done.
    const covered = () => document.querySelector('.modal-backdrop') !== null;
    let inView = 0;
    let wasCovered = covered();
    const timer = window.setInterval(() => {
      if (Date.now() - reveal.t >= REVEAL_FRESH_MS) {
        doneRef.current(); // went stale while it waited
        return;
      }
      const isCovered = covered();
      // A second counts only if nothing lay over it at either end of it, so
      // what a closing sheet uncovers stays up twelve seconds or a little
      // more, never less.
      if (!isCovered && !wasCovered) inView += TICK_MS;
      wasCovered = isCovered;
      if (inView >= SHOW_MS) doneRef.current();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [reveal.id, reveal.t]);

  // It comes up unannounced in the middle of the table, quite possibly under
  // a finger on its way to a card. A tap in its first moment (and a new
  // reveal starts a new one) is swallowed: it must not put away what nobody
  // has had the time to see.
  const up = useRef({ id: '', since: 0 });
  if (up.current.id !== reveal.id) up.current = { id: reveal.id, since: performance.now() };
  const tapped = () => {
    if (performance.now() - up.current.since >= SETTLE_MS) onDone();
  };

  const n = reveal.cards.length;
  const sizing = {
    '--reveal-cols': Math.min(n, PER_ROW),
    '--reveal-rows': Math.ceil(n / PER_ROW),
    // One card is shown big; a fan of them shares the room.
    '--reveal-max': n === 1 ? '280px' : n === 2 ? '220px' : '170px',
  } as CSSProperties;

  return (
    <div className="reveal-banner" role="status" title="Tap to put away" onClick={tapped}>
      <p className="reveal-title">
        <strong>{who}</strong> reveals
      </p>
      <p className="reveal-from">
        {reveal.from === 'hand' ? 'from their hand' : 'from the top of their library'}
      </p>
      <ul className="reveal-cards" style={sizing}>
        {reveal.cards.map((c, i) => {
          const art = records[c.cardId]?.imageNormal;
          return (
            // Two copies of one card are two cards: the place in the list is the key.
            <li key={i} className="reveal-card">
              {/* The name sits under the art: it shows while there is no image. */}
              <span className="reveal-name">{c.name}</span>
              {art && <img src={art} alt="" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Cards a player is showing the whole table, centred on every device at it
 * (the revealing one too) until tapped away or twelve seconds have passed.
 * Not a sheet: it claims no back press and lies under every sheet. */
export default function RevealBanner() {
  // Only the reveal and its player's name: the rest of the game changing is no reason to redraw.
  const reveal = useAppStore((s) => s.game?.reveal);
  const who = useAppStore((s) =>
    s.game?.reveal ? s.game.config.profiles[s.game.reveal.seat]?.name : undefined,
  );
  const [, redraw] = useState(0);
  if (!reveal) return null;
  // By this device's clock, read at render: a reveal first seen long after it
  // was made (a reload, a saved game picked up, a table rejoined) never shows.
  const fresh = !putAway.has(reveal.id) && Date.now() - reveal.t < REVEAL_FRESH_MS;
  if (!fresh) return null;
  return (
    <RevealPanel
      reveal={reveal}
      who={who ?? '?'}
      onDone={() => {
        putReveal(reveal.id);
        redraw((n) => n + 1);
      }}
    />
  );
}
